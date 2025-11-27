import re
from pathlib import Path
from datetime import datetime
import shutil

# === CONFIGURATION ===
new_ip = "10.92.50.132"
old_ip = "192.168.1.168"

# List of files you want to modify
file_paths = [
    r"C:\Users\Acer\Cheeko-esp32-server\main\mqtt-gateway\config\mqtt.json",
    r"C:\Users\Acer\Cheeko-esp32-server\main\livekit-server\.env",
    r"C:\Users\Acer\Cheeko-esp32-server\main\mqtt-gateway\.env",
    r"C:\Users\Acer\Cheeko-esp32-server\main\livekit-server\config.yaml"
]


def replace_in_file(path: Path, old_ip: str, new_ip: str):
    pattern = re.compile(rf'(?<!\d){re.escape(old_ip)}(?!\d)')

    if not path.exists():
        print(f"❌ File not found: {path}")
        return

    text = path.read_text(encoding="utf-8", errors="ignore")
    matches = list(pattern.finditer(text))

    if not matches:
        print(f"➡ No matches in {path}")
        return

    # Create backup
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    backup_path = path.with_suffix(path.suffix + f".bak.{ts}")
    shutil.copy2(path, backup_path)

    # Replace IPs
    new_text = pattern.sub(new_ip, text)
    path.write_text(new_text, encoding="utf-8")

    print(
        f"✅ Replaced {len(matches)} occurrence(s) in {path} (backup: {backup_path})")


def main():
    for f in file_paths:
        replace_in_file(Path(f), old_ip, new_ip)


if __name__ == "__main__":
    main()
