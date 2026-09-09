"""Playback from the SD mimic: the chunked decrypt the toy does, and the two
failure modes that must never be silent.
"""
import json
import os
import shutil
import tempfile

import client_crypto
from client_storage import DeviceStore

K = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + bytes(range(256)) * 30   # > one 2048 chunk
LVGL = b"\x19\x12\x00\x00" + b"\x28\x01\xf0\x00" + b"\x50\x02\x00\x00" + b"\x00" * 500


def _client_with_pack(tmp, sealed=True, wrong_secret=False):
    from client import TestClient
    c = TestClient(device_mac="00:16:3e:7a:11:c6")
    c.store = DeviceStore(base_dir=tmp, mac="00:16:3e:7a:11:c6")
    skill = c.store.skill_dir("story01")
    os.makedirs(os.path.join(skill, "audio"), exist_ok=True)
    os.makedirs(os.path.join(skill, "images"), exist_ok=True)

    manifest = {"skill_id": "story01", "skill_name": "Jungle", "version": 2}
    if sealed:
        nonce_w = os.urandom(8)
        secret = os.urandom(32) if wrong_secret else c.store.secret()
        wrapped = client_crypto.wrap_pack_key(secret, K, nonce_w)
        manifest["enc"] = {"v": 2, "key": wrapped.hex(), "nonce": nonce_w.hex()}
        audio, image = client_crypto.seal(MP3, K), client_crypto.seal(LVGL, K)
    else:
        audio, image = MP3, LVGL

    open(os.path.join(skill, "audio", "01.mp3"), "wb").write(audio)
    open(os.path.join(skill, "images", "01.bin"), "wb").write(image)
    json.dump(manifest, open(os.path.join(skill, "manifest.jsn"), "w"))
    return c


def test_sealed_pack_decrypts_to_a_valid_mp3_across_chunk_boundaries():
    tmp = tempfile.mkdtemp()
    try:
        c = _client_with_pack(tmp)
        key = c.skill_key("story01")
        assert key == K
        data = c.read_skill_file(os.path.join(c.store.skill_dir("story01"), "audio", "01.mp3"), key)
        assert data == MP3
        assert data[:3] == b"ID3"
        result = c.play_skill("story01")
        assert result == {"played": 2, "failed": 0}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_plaintext_pack_plays_with_no_key():
    tmp = tempfile.mkdtemp()
    try:
        c = _client_with_pack(tmp, sealed=False)
        assert c.skill_key("story01") is None
        assert c.play_skill("story01") == {"played": 2, "failed": 0}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_wrong_secret_fails_loudly_and_never_returns_ciphertext():
    tmp = tempfile.mkdtemp()
    try:
        c = _client_with_pack(tmp, wrong_secret=True)
        result = c.play_skill("story01")
        assert result["played"] == 0 and result["failed"] == 2
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_sealed_file_with_no_key_raises_rather_than_returning_ciphertext():
    tmp = tempfile.mkdtemp()
    try:
        c = _client_with_pack(tmp)
        path = os.path.join(c.store.skill_dir("story01"), "audio", "01.mp3")
        try:
            c.read_skill_file(path, None)
            assert False, "expected RuntimeError"
        except RuntimeError as exc:
            assert "sealed" in str(exc).lower()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_rotating_the_secret_kills_the_pack_the_way_an_nvs_erase_would():
    tmp = tempfile.mkdtemp()
    try:
        c = _client_with_pack(tmp)
        assert c.play_skill("story01")["played"] == 2
        c.store.rotate_secret()
        assert c.play_skill("story01")["failed"] == 2
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"{name}: OK")
