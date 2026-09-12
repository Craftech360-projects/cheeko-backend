"""Downloading a card_content payload onto the SD mimic.

Two things must hold and are easy to get wrong: the wrapped key goes into
manifest.jsn and the plain key never does, and a plaintext pack must still work
so the rollout does not need a flag day.
"""
import json
import os
import shutil
import tempfile
import threading
from unittest import mock

# Stands in for the firmware build constant; must be set before client imports.
SECRET_HEX = "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf"
os.environ["CONTENT_WRAP_SECRET"] = SECRET_HEX

import client_crypto
from client_storage import DeviceStore

K = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
MP3 = b"ID3" + b"\x00" * 500
PNGBIN = b"\x19\x12" + b"\x00" * 300


def _client(tmp):
    from client import TestClient
    c = TestClient(device_mac="00:16:3e:7a:11:c6")
    c.store = DeviceStore(base_dir=tmp, mac="00:16:3e:7a:11:c6")
    return c


def _fake_get(body):
    resp = mock.Mock()
    resp.content = body
    resp.raise_for_status = mock.Mock()
    return mock.Mock(return_value=resp)


def test_sealed_pack_is_stored_as_ciphertext_with_a_wrapped_key():
    tmp = tempfile.mkdtemp()
    try:
        c = _client(tmp)
        nonce_w = os.urandom(8)
        wrapped = client_crypto.wrap_pack_key(bytes.fromhex(SECRET_HEX), K, nonce_w)
        payload = {
            "type": "card_content", "rfid_uid": "AABBCCDD",
            "skill_id": "story01", "skill_name": "Jungle", "version": 2,
            "audio": [{"index": 1, "url": "https://cdn/a.mp3"}],
            "images": [{"index": 1, "url": "https://cdn/a.bin"}],
            "encryption": {"v": 1, "key": wrapped.hex(), "nonce": nonce_w.hex()},
        }
        with mock.patch("client.requests.get", _fake_get(client_crypto.seal(MP3, K))):
            result = c.download_card_content(payload)

        assert result["sealed"] is True
        skill = c.store.skill_dir("story01")
        on_disk = open(os.path.join(skill, "audio", "01.mp3"), "rb").read()
        assert client_crypto.parse_header(on_disk) is not None      # stored sealed
        assert client_crypto.unseal(on_disk, K) == MP3

        manifest = json.load(open(os.path.join(skill, "manifest.jsn")))
        assert manifest["enc"] == {"v": 1, "key": wrapped.hex(), "nonce": nonce_w.hex()}
        assert K.hex() not in json.dumps(manifest)                  # plain key never on disk
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_plaintext_pack_still_downloads_and_has_no_enc_block():
    tmp = tempfile.mkdtemp()
    try:
        c = _client(tmp)
        payload = {
            "type": "card_content", "rfid_uid": "AABBCCDD",
            "skill_id": "old01", "skill_name": "Legacy", "version": 1,
            "audio": [{"index": 1, "url": "https://cdn/a.mp3"}], "images": [],
        }
        with mock.patch("client.requests.get", _fake_get(MP3)):
            result = c.download_card_content(payload)
        assert result["sealed"] is False
        manifest = json.load(open(os.path.join(c.store.skill_dir("old01"), "manifest.jsn")))
        assert "enc" not in manifest
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_grouped_stories_land_in_s01_directories():
    tmp = tempfile.mkdtemp()
    try:
        c = _client(tmp)
        payload = {
            "type": "card_content", "rfid_uid": "AABBCCDD",
            "skill_id": "grp01", "skill_name": "Stories", "version": 1,
            "stories": [{"index": 1, "title": "One",
                         "audio": [{"index": 1, "url": "https://cdn/a.mp3"}],
                         "images": [{"index": 1, "url": "https://cdn/a.bin"}]}],
        }
        with mock.patch("client.requests.get", _fake_get(MP3)):
            c.download_card_content(payload)
        skill = c.store.skill_dir("grp01")
        assert os.path.exists(os.path.join(skill, "s01", "audio", "01.mp3"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_manifest_is_written_last():
    """It is the completion marker. A pack whose manifest exists but whose audio
    does not would be treated as downloaded and would play silence."""
    tmp = tempfile.mkdtemp()
    try:
        c = _client(tmp)
        payload = {"type": "card_content", "rfid_uid": "A", "skill_id": "fail01",
                   "skill_name": "X", "version": 1,
                   "audio": [{"index": 1, "url": "https://cdn/a.mp3"}], "images": []}
        with mock.patch("client.requests.get", side_effect=Exception("network down")):
            try:
                c.download_card_content(payload)
            except Exception:
                pass
        assert not os.path.exists(os.path.join(c.store.skill_dir("fail01"), "manifest.jsn"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_on_mqtt_message_queues_card_content_before_download_finishes():
    """Regression test for the ordering bug: a caller doing send-then-wait on
    mqtt_message_queue must see the card_content payload arrive immediately,
    not only after the (possibly many-second) download completes. The
    download's own completion must be observable separately, via
    card_pack_download_done.
    """
    import client as client_mod

    tmp = tempfile.mkdtemp()
    try:
        c = _client(tmp)
        c.auto_download_packs = True

        # Drain any stale state from other tests/runs sharing these module globals.
        while not client_mod.mqtt_message_queue.empty():
            client_mod.mqtt_message_queue.get_nowait()
        client_mod.card_pack_download_done.set()  # start "done" so clear() below is observable

        download_may_proceed = threading.Event()

        def slow_get(url, timeout=60):
            download_may_proceed.wait(timeout=5)  # simulate a slow multi-file download
            resp = mock.Mock()
            resp.content = MP3
            resp.raise_for_status = mock.Mock()
            return resp

        payload = {
            "type": "card_content", "rfid_uid": "AABBCCDD",
            "skill_id": "slow01", "skill_name": "Slow", "version": 1,
            "audio": [{"index": 1, "url": "https://cdn/a.mp3"}], "images": [],
        }
        msg = mock.Mock()
        msg.payload = json.dumps(payload).encode()
        msg.topic = "devices/p2p/test"

        with mock.patch("client.requests.get", side_effect=slow_get):
            t = threading.Thread(target=c.on_mqtt_message, args=(None, None, msg))
            t.start()
            try:
                # The payload must reach the queue right away...
                queued = client_mod.mqtt_message_queue.get(timeout=2)
                assert queued["type"] == "card_content"
                assert queued["skill_id"] == "slow01"
                # ...well before the download (still blocked on our event) is done.
                assert not client_mod.card_pack_download_done.is_set()
            finally:
                download_may_proceed.set()
                t.join(timeout=5)
                assert not t.is_alive()

        # Once the callback thread returns, completion must be signalled.
        assert client_mod.card_pack_download_done.is_set()
        manifest_path = os.path.join(c.store.skill_dir("slow01"), "manifest.jsn")
        assert os.path.exists(manifest_path)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_an_unknown_device_still_gets_a_usable_pack():
    """v1 has no registration step and no per-device state: a client the server
    has never seen downloads and plays a sealed pack on its first tap. This is
    the regression that would silently undo the whole point of v1."""
    tmp = tempfile.mkdtemp()
    try:
        c = _client(tmp)
        nonce_w = os.urandom(8)
        wrapped = client_crypto.wrap_pack_key(bytes.fromhex(SECRET_HEX), K, nonce_w)
        payload = {
            "type": "card_content", "rfid_uid": "AABBCCDD",
            "skill_id": "new01", "skill_name": "First tap", "version": 1,
            "audio": [{"index": 1, "url": "https://cdn/a.mp3"}], "images": [],
            "encryption": {"v": 1, "key": wrapped.hex(), "nonce": nonce_w.hex()},
        }
        with mock.patch("client.requests.get", _fake_get(client_crypto.seal(MP3, K))):
            result = c.download_card_content(payload)

        assert result["sealed"] is True and result["files"]
        assert c.skill_key("new01") == K
        assert c.play_skill("new01") == {"played": 1, "failed": 0}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"{name}: OK")
