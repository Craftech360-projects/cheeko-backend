"""Room name and dispatch metadata, the two things the gateway hands a worker."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

VOICES = ("beacon", "cinder", "marin", "stone", "vesper")  # aster is refused for this account
DEFAULT_CHARACTER = "Cheeko"

_ROOM = re.compile(r"^[^_]+_([0-9A-Fa-f]{12})_([a-z_]+)$")  # <session uuid>_<MAC>_<type>


def parse_room_name(room: str) -> tuple[str | None, str | None]:
    m = _ROOM.match(room or "")
    if not m:
        return None, None
    raw, kind = m.group(1).upper(), m.group(2)
    return ":".join(raw[i:i + 2] for i in range(0, 12, 2)), kind


@dataclass(frozen=True)
class SessionMeta:
    device_mac: str | None
    character: str
    character_id: str
    child_name: str
    child_age: int
    child_gender: str
    child_interests: str
    parent_rule: str
    language: str
    voice: str
    accent: str
    sample_rate: int


def parse_dispatch_metadata(raw: str | None, room: str) -> SessionMeta:
    try:
        data = json.loads(raw) if raw else {}
        if not isinstance(data, dict):
            data = {}
    except ValueError:
        data = {}
    child = data.get("child_profile") or {}
    if not isinstance(child, dict):
        child = {}
    live = data.get("gptlive") or {}
    if not isinstance(live, dict):
        live = {}
    try:
        age = int(child.get("age") or 0)
    except (TypeError, ValueError):
        age = 0
    voice = str(live.get("voice") or "").lower()
    mac, _ = parse_room_name(room)
    return SessionMeta(
        device_mac=mac,
        character=str(data.get("character") or DEFAULT_CHARACTER).strip() or DEFAULT_CHARACTER,
        character_id=str(data.get("character_id") or "").strip(),
        child_name=str(child.get("name") or "").strip(),
        child_age=age,
        child_gender=str(child.get("gender") or "").strip(),
        child_interests=str(child.get("interests") or "").strip(),
        parent_rule=str(child.get("parent_rule") or "").strip(),
        language=str(data.get("session_language_name") or data.get("language") or "English").strip() or "English",
        voice=voice if voice in VOICES else "marin",
        accent="indian" if live.get("accent") == "indian" else "default",
        sample_rate=24000 if live.get("rate") == 24000 else 16000,
    )
