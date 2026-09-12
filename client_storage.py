"""On-disk stand-in for the toy's SD card.

client_state/
  sdcard/cheeko/skills/<skill_id>/manifest.jsn
  sdcard/cheeko/skills/<skill_id>/audio/01.mp3
  sdcard/cheeko/skills/<skill_id>/images/01.bin
  sdcard/cheeko/apps/<app_id>/...

Paths and filenames match the firmware exactly (8.3 names, "manifest.jsn" not
"manifest.json"), so a directory produced here could be copied onto a real card.

Content encryption v1 keeps no key material on the device outside the firmware
image, so there is no NVS mimic here any more: no dev_secret, no secret.fp, no
pending flag. Those were v1's predecessor (v2, deferred 2026-09-10); see
main/manager-api-node/docs/sd-content-encryption.md section 6.
"""
import logging
import os

logger = logging.getLogger(__name__)


class DeviceStore:
    def __init__(self, base_dir: str = "client_state", mac: str = ""):
        self.base_dir = base_dir
        self.mac = mac
        os.makedirs(base_dir, exist_ok=True)

    def sd_root(self) -> str:
        path = os.path.join(self.base_dir, "sdcard", "cheeko")
        os.makedirs(path, exist_ok=True)
        return path

    def skill_dir(self, skill_id: str) -> str:
        path = os.path.join(self.sd_root(), "skills", skill_id)
        os.makedirs(path, exist_ok=True)
        return path
