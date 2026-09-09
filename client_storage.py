"""On-disk stand-ins for the toy's NVS and SD card.

client_state/
  nvs.json                                  {"dev_secret": {"<mac>": "<64 hex>"}}
  sdcard/cheeko/skills/<skill_id>/manifest.jsn
  sdcard/cheeko/skills/<skill_id>/audio/01.mp3
  sdcard/cheeko/skills/<skill_id>/images/01.bin

Paths and filenames match the firmware exactly (8.3 names, "manifest.jsn" not
"manifest.json"), so a directory produced here could be copied onto a real card.
"""
import json
import os
import secrets


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
