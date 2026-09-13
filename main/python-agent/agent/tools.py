"""Backend tools every character gets, and the per-character tool set."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from livekit.agents import function_tool

from .quiz import memo_type_for, quiz_tools


@function_tool(name="get_time_date")
async def get_time_date(timezone: str = "Asia/Kolkata") -> str:
    """Get the current date and time.

    Args:
        timezone: IANA timezone name, default India Standard Time.
    """
    try:
        now = datetime.now(ZoneInfo(timezone))
    except Exception:
        timezone, now = "Asia/Kolkata", datetime.now(ZoneInfo("Asia/Kolkata"))
    return now.strftime("%A, %d %B %Y, %I:%M %p") + f" ({timezone})"


def remember_child_fact(workspace: Path):
    @function_tool(name="remember_child_fact")
    async def _remember(fact: str) -> str:
        """Remember one durable fact about the child for future sessions: a pet's name, a favourite, a family member.

        Args:
            fact: The fact, as one short sentence.
        """
        fact = " ".join((fact or "").split())
        if not fact:
            return "error: fact is required"
        memory = Path(workspace) / "memory" / "MEMORY.md"
        memory.parent.mkdir(parents=True, exist_ok=True)
        with memory.open("a", encoding="utf-8") as f:
            f.write(f"- {datetime.now().strftime('%Y-%m-%d')}: {fact}\n")
        return "remembered: " + fact

    return _remember


def tools_for(character: str, workspace: Path, quiz_tracker) -> list:
    tools = [get_time_date, remember_child_fact(workspace)]
    if quiz_tracker is not None and memo_type_for(character):
        tools += quiz_tools(quiz_tracker)
    return tools
