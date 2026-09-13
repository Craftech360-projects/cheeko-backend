from pathlib import Path

import pytest

from agent.tools import remember_child_fact, tools_for


@pytest.mark.asyncio
async def test_remember_appends_a_dated_line(tmp_path: Path):
    tool = remember_child_fact(tmp_path)
    out = await tool("has a dog named Harry")  # FunctionTool.__call__ runs the wrapped coroutine
    assert "remembered" in out
    # merged into MEMORY.md's Stable Memory at shutdown (agent.persistence.add_facts)
    assert (tmp_path / "memory" / "new_facts.md").read_text(encoding="utf-8") == "has a dog named Harry\n"
    assert "error" in await tool("   ")


def test_tools_for_character(tmp_path: Path):
    assert [t.info.name for t in tools_for("Cheeko", tmp_path, None)] == ["get_time_date", "remember_child_fact"]
    names = [t.info.name for t in tools_for("Quizzy", tmp_path, quiz_tracker=None)]
    assert "quiz_score_answer" not in names  # no batch, no quiz tools
