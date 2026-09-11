"""The client's stand-ins for NVS and the SD card.

The toy keeps its content secret in NVS namespace "cheeko" key "dev_secret" and
its packs under /sdcard/cheeko/skills/<id>/. This module is the same shape on
disk so the client's manifest.jsn is what the firmware will later parse.
"""
import json
import os
import shutil
import tempfile

from client_storage import DeviceStore

MAC = "00:16:3e:7a:11:c6"


def _store():
    d = tempfile.mkdtemp()
    return DeviceStore(base_dir=d, mac=MAC), d


def test_secret_is_generated_once_and_persists():
    store, d = _store()
    try:
        first = store.secret_hex()
        assert len(first) == 64 and int(first, 16) >= 0
        assert store.secret_hex() == first
        # a fresh object over the same directory reads the stored value
        assert DeviceStore(base_dir=d, mac=MAC).secret_hex() == first
        assert store.secret() == bytes.fromhex(first)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_two_macs_get_different_secrets():
    store, d = _store()
    try:
        other = DeviceStore(base_dir=d, mac="00:16:3e:7a:11:c7")
        assert store.secret_hex() != other.secret_hex()
        saved = json.load(open(os.path.join(d, "nvs.json")))
        assert len(saved["dev_secret"]) == 2
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_rotate_changes_the_secret():
    store, d = _store()
    try:
        before = store.secret_hex()
        after = store.rotate_secret()
        assert after != before
        assert store.secret_hex() == after
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_skill_dir_layout_matches_the_toy():
    store, d = _store()
    try:
        path = store.skill_dir("story01")
        assert path.replace("\\", "/").endswith("sdcard/cheeko/skills/story01")
        assert os.path.isdir(path)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_reconcile_first_run_records_fingerprint_without_wiping():
    """An existing card from before this check existed (or a genuine first
    run) must not be treated as a rotation -- there is nothing to compare
    against yet."""
    store, d = _store()
    try:
        skill = store.skill_dir("story01")
        manifest = os.path.join(skill, "manifest.jsn")
        open(manifest, "w").write("{}")

        wiped = store.reconcile_secret()

        assert wiped is False
        assert os.path.exists(manifest)
        assert os.path.exists(os.path.join(store.sd_root(), "secret.fp"))
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_reconcile_is_a_noop_when_the_secret_is_unchanged():
    store, d = _store()
    try:
        skill = store.skill_dir("story01")
        manifest = os.path.join(skill, "manifest.jsn")
        open(manifest, "w").write("{}")
        store.reconcile_secret()  # records the baseline fingerprint

        wiped = store.reconcile_secret()

        assert wiped is False
        assert os.path.exists(manifest)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_reconcile_wipes_skills_when_the_secret_changed():
    store, d = _store()
    try:
        skill = store.skill_dir("story01")
        manifest = os.path.join(skill, "manifest.jsn")
        open(manifest, "w").write("{}")
        store.reconcile_secret()  # records the baseline fingerprint

        store.rotate_secret()
        wiped = store.reconcile_secret()

        assert wiped is True
        assert not os.path.exists(manifest)
        assert os.listdir(os.path.join(store.sd_root(), "skills")) == []
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_secret_itself_is_never_written_to_the_fingerprint_file():
    store, d = _store()
    try:
        store.reconcile_secret()
        fp_path = os.path.join(store.sd_root(), "secret.fp")
        contents = open(fp_path).read().strip()

        assert store.secret_hex() not in contents
        assert contents == store.secret_fingerprint()
        assert len(contents) == 8
    finally:
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"{name}: OK")
