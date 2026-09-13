"""An ephemeral per-session workspace of .md files, hydrated like picoclaw does it.

AGENT.md = scaffold with the manager persona at <!-- PERSONA --> and the language at
<!-- LANGUAGE -->; SOUL.md = the manager soul; USER.md = the child profile; memory/state
holds the MEMO files restored from the manager. The system prompt is read back from
these files, so what the model sees is exactly what is on disk.
"""
from __future__ import annotations

import re
import shutil
from dataclasses import dataclass
from pathlib import Path

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "workspace-template"
PERSONA_PLACEHOLDER = "<!-- PERSONA -->"
LANGUAGE_PLACEHOLDER = "<!-- LANGUAGE -->"

IDENTITY = """# Cheeko

You are the character described in AGENT.md and SOUL.md, talking with a child.
USER.md describes the child. memory/MEMORY.md holds what you remembered about them."""

_SAFE = re.compile(r"[^A-Za-z0-9_.-]+")


@dataclass(frozen=True)
class Persona:
    system_prompt: str
    soul: str
    greeting: str
    language: str


def persona_from_manager(data: dict | None, meta) -> Persona:
    data = data if isinstance(data, dict) else {}
    system_prompt = str(data.get("systemPrompt") or "").strip()
    if not system_prompt:
        system_prompt = f"You are {meta.character}, a warm, playful and safe AI friend for a child."
    return Persona(
        system_prompt=system_prompt,
        soul=str(data.get("soul") or "").strip(),
        greeting=str(data.get("greetingPrompt") or "").strip(),
        language=str(data.get("language") or "").strip() or meta.language,
    )


def _inject_persona(scaffold: str, persona: str) -> str:
    persona = persona.strip()
    if PERSONA_PLACEHOLDER in scaffold:
        return scaffold.replace(PERSONA_PLACEHOLDER, persona)
    return persona + "\n\n" + scaffold if persona else scaffold


def render_user_md(meta) -> str:
    fields = [("Name", meta.child_name), ("Gender", meta.child_gender), ("Interests", meta.child_interests),
              ("Primary language", meta.language)]
    if meta.child_age > 0:
        fields.insert(1, ("Age", f"{meta.child_age} years old"))
    fields.append(("Timezone", "Asia/Kolkata"))
    if meta.parent_rule:
        fields.append(("Parent rule", meta.parent_rule))
    lines = ["# User", "", "## User Information", ""]
    lines += [f"- {label}: {value}" for label, value in fields if value]
    return "\n".join(lines) + "\n"


def hydrate_workspace(root: Path, room: str, persona: Persona, meta, memos: list[dict]) -> Path:
    ws = root / (_SAFE.sub("_", room) or "room")
    (ws / "memory" / "state").mkdir(parents=True, exist_ok=True)
    scaffold = (TEMPLATE_DIR / "AGENT.md").read_text(encoding="utf-8")
    agent_md = _inject_persona(scaffold, persona.system_prompt).replace(LANGUAGE_PLACEHOLDER, meta.language)
    (ws / "AGENT.md").write_text(agent_md, encoding="utf-8")
    soul = persona.soul or (TEMPLATE_DIR / "SOUL.md").read_text(encoding="utf-8")
    (ws / "SOUL.md").write_text(soul, encoding="utf-8")
    (ws / "USER.md").write_text(render_user_md(meta), encoding="utf-8")
    memory = ws / "memory" / "MEMORY.md"
    if not memory.exists():
        memory.write_text("# Memory\n", encoding="utf-8")
    for state in memos:
        kind = _SAFE.sub("_", str(state.get("state_type") or "")).strip("_")
        memo = str(state.get("memo") or "").strip()
        if kind and memo:
            (ws / "memory" / "state" / f"{kind}.md").write_text(memo + "\n", encoding="utf-8")
    return ws


def _section(ws: Path, name: str) -> str:
    path = ws / name
    if not path.exists():
        return ""
    body = path.read_text(encoding="utf-8").strip()
    return f"## {name}\n\n{body}" if body else ""


def build_system_prompt(workspace: Path) -> str:
    parts = [IDENTITY] + [s for s in (_section(workspace, n) for n in ("AGENT.md", "SOUL.md", "USER.md")) if s]
    return "\n\n---\n\n".join(parts)


def remove_workspace(workspace: Path) -> None:
    shutil.rmtree(workspace, ignore_errors=True)
