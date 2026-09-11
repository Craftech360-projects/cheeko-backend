"""On-disk stand-ins for the toy's NVS and SD card.

client_state/
  nvs.json                                  {"dev_secret": {"<mac>": "<64 hex>"}}
  sdcard/cheeko/secret.fp                   first 8 hex chars of SHA-256(secret)
  sdcard/cheeko/skills/<skill_id>/manifest.jsn
  sdcard/cheeko/skills/<skill_id>/audio/01.mp3
  sdcard/cheeko/skills/<skill_id>/images/01.bin

Paths and filenames match the firmware exactly (8.3 names, "manifest.jsn" not
"manifest.json"), so a directory produced here could be copied onto a real card.
"""
import hashlib
import json
import logging
import os
import secrets
import shutil
from typing import Optional

logger = logging.getLogger(__name__)


class DeviceStore:
    def __init__(self, base_dir: str = "client_state", mac: str = ""):
        self.base_dir = base_dir
        self.mac = mac
        self._nvs_path = os.path.join(base_dir, "nvs.json")
        os.makedirs(base_dir, exist_ok=True)

    def _read_nvs(self) -> dict:
        try:
            with open(self._nvs_path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (FileNotFoundError, ValueError):
            return {}

    def _write_nvs(self, data: dict) -> None:
        with open(self._nvs_path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)

    def secret_hex(self) -> str:
        nvs = self._read_nvs()
        stored = nvs.get("dev_secret", {}).get(self.mac)
        if stored and len(stored) == 64:
            return stored
        return self._store_secret(secrets.token_hex(32))

    def _store_secret(self, value: str) -> str:
        nvs = self._read_nvs()
        nvs.setdefault("dev_secret", {})[self.mac] = value
        self._write_nvs(nvs)
        return value

    def secret(self) -> bytes:
        return bytes.fromhex(self.secret_hex())

    def rotate_secret(self) -> str:
        """Mimics an NVS erase: the old wrapped keys on the card become dead."""
        return self._store_secret(secrets.token_hex(32))

    def sd_root(self) -> str:
        path = os.path.join(self.base_dir, "sdcard", "cheeko")
        os.makedirs(path, exist_ok=True)
        return path

    def skill_dir(self, skill_id: str) -> str:
        path = os.path.join(self.sd_root(), "skills", skill_id)
        os.makedirs(path, exist_ok=True)
        return path

    def secret_fingerprint(self) -> str:
        """First 8 hex chars of SHA-256(secret). Safe to keep on the SD mimic --
        unlike the secret itself, it does not let anyone rewrap a key."""
        return hashlib.sha256(self.secret()).hexdigest()[:8]

    def _fingerprint_path(self) -> str:
        return os.path.join(self.sd_root(), "secret.fp")

    def _read_fingerprint(self) -> Optional[str]:
        try:
            with open(self._fingerprint_path(), "r", encoding="utf-8") as fh:
                value = fh.read().strip()
        except FileNotFoundError:
            return None
        return value or None

    def _write_fingerprint(self, fingerprint: str) -> None:
        with open(self._fingerprint_path(), "w", encoding="utf-8") as fh:
            fh.write(fingerprint)

    def _pending_path(self) -> str:
        return os.path.join(self.sd_root(), "secret.pending")

    def registration_pending(self) -> bool:
        """True if a rotation was detected whose new secret has not yet been
        confirmed registered with the server. Persisted on the SD mimic (not
        just in memory) so a reboot between the rotation and the successful
        registration does not lose track of it."""
        return os.path.exists(self._pending_path())

    def mark_registration_pending(self) -> None:
        """Set when the server may hold a different secret than ours: a
        rotation, or content whose key unwrapped but did not decode."""
        with open(self._pending_path(), "w", encoding="utf-8") as fh:
            fh.write(self.secret_fingerprint())

    def mark_registration_complete(self) -> None:
        """Call only after the server has confirmed the new secret. Clearing
        this on anything less (e.g. just attempting a download) would let a
        pack silently get wrapped under the secret the server still holds."""
        try:
            os.remove(self._pending_path())
        except FileNotFoundError:
            pass

    def reconcile_secret(self) -> bool:
        """Detect that NVS was erased (secret regenerated) since the SD mimic
        was last written, and if so wipe downloaded content so the next tap
        re-downloads instead of failing to decrypt.

        No fingerprint on the card yet means an existing card from before this
        check existed, or a genuine first run -- not evidence of a rotation,
        so the current fingerprint is recorded without wiping anything.

        Returns True if a wipe happened.
        """
        current = self.secret_fingerprint()
        stored = self._read_fingerprint()
        if stored is None:
            self._write_fingerprint(current)
            return False
        if stored == current:
            return False

        skills_dir = os.path.join(self.sd_root(), "skills")
        shutil.rmtree(skills_dir, ignore_errors=True)
        os.makedirs(skills_dir, exist_ok=True)
        self._write_fingerprint(current)
        # The server still holds the OLD secret until told otherwise, so the
        # next download would come back wrapped under it -- undecryptable by
        # this device's new secret. Mark that pending until a registration
        # actually succeeds; see registration_pending()/mark_registration_complete().
        self.mark_registration_pending()
        logger.warning(
            "[SECRET] device secret changed (fingerprint %s -> %s) -- NVS was "
            "likely erased. Wiped %s; every wrapped pack key on the card was "
            "dead, so the next tap will re-download cleanly.",
            stored, current, skills_dir,
        )
        return True
