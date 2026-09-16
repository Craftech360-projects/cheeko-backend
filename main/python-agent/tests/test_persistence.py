import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from agent.persistence import SessionRecorder, add_facts, append_summary

NOW = datetime(2026, 9, 13, 10, 0, 0, tzinfo=timezone.utc)
MEMORY = "# Long-term Memory\n\n## Stable Memory\n- Loves dinosaurs\n\n## Session Summaries\n- 2026-09-12 18:10:04 UTC: sang a rain song\n"


class FakeManager:
    enabled = True

    def __init__(self, memory=MEMORY):
        self.calls, self.memory = [], memory

    async def workspace_files(self, mac):
        self.calls.append(("files", mac))
        return {"memory/MEMORY.md": self.memory} if self.memory is not None else {}

    async def save_memory(self, mac, content):
        self.calls.append(("memory", mac, content))

    async def send_session_summary(self, mac, sid, summary, count):
        self.calls.append(("summary", mac, sid, summary, count))

    async def send_chat_history(self, mac, sid, messages):
        self.calls.append(("history", mac, sid, messages))

    async def send_session_end(self, mac, sid, n):
        self.calls.append(("end", mac, sid, n))

    async def send_token_usage(self, mac, sid, usage):
        self.calls.append(("usage", mac, sid, usage))


class FakeSession:
    def on(self, name):
        return lambda fn: fn


def plan(workspace: Path, mac="68:EE:8F:60:BA:AC"):
    (workspace / "memory").mkdir(parents=True, exist_ok=True)
    return SimpleNamespace(meta=SimpleNamespace(device_mac=mac, character="quizzy"), room_name="room-1", workspace=workspace)


USAGE = SimpleNamespace(model_usage=[
    SimpleNamespace(model="gpt-live-1", session_duration=31.0, input_tokens=0, output_tokens=0, total_tokens=0),
    SimpleNamespace(model="gpt-5.6-luna", session_duration=0, input_tokens=100, output_tokens=20, total_tokens=120),
])


def test_append_summary_matches_picoclaw_line_format():
    out = append_summary(MEMORY, "Played the quiz.\nGot two right.", "quizzy", 6, NOW)
    assert out == MEMORY + "- 2026-09-13 10:00:00 UTC [quizzy] (6 messages): Played the quiz. Got two right.\n"
    assert append_summary("", "Hi.", "", 0, NOW) == "# Memory\n\n## Session Summaries\n\n- 2026-09-13 10:00:00 UTC: Hi.\n"
    no_section = append_summary("# Memory\n\n## Stable Memory\n- x\n", "Hi.", "Cheeko", 2, NOW)
    assert no_section.endswith("- x\n\n## Session Summaries\n\n- 2026-09-13 10:00:00 UTC [Cheeko] (2 messages): Hi.\n")


def test_append_summary_caps_the_file_keeping_the_newest_lines():
    big = "# Memory\n\n## Session Summaries\n" + "".join(f"- old {i} " + "x" * 200 + "\n" for i in range(400))
    out = append_summary(big, "newest", "Cheeko", 2, NOW)
    assert len(out.encode("utf-8")) <= 64 * 1024 + 64
    assert out.startswith("# Memory\n\n## Session Summaries\n\n") and out.rstrip().endswith("newest") and "- old 0 " not in out


def test_add_facts_goes_under_stable_memory():
    out = add_facts(MEMORY, ["Has a dog named Harry", "Loves dinosaurs"])
    assert out.index("- Loves dinosaurs") < out.index("- Has a dog named Harry") < out.index("## Session Summaries")
    assert out.count("Loves dinosaurs") == 1  # already known facts are not repeated
    created = add_facts("# Memory\n\n## Session Summaries\n- s\n", ["Likes red"])
    assert created.index("## Stable Memory\n- Likes red") < created.index("## Session Summaries")
    assert add_facts(MEMORY, []) == MEMORY


@pytest.mark.asyncio
async def test_flush_saves_summary_and_facts_to_memory_then_the_rest(tmp_path: Path):
    mgr = FakeManager()
    seen = []

    async def summarize(messages):
        seen.append(messages)
        return "Played the quiz and got two right."

    p = plan(tmp_path)
    (tmp_path / "memory" / "new_facts.md").write_text("Has a dog named Harry\n", encoding="utf-8")
    rec = SessionRecorder(FakeSession(), mgr, p, summarize=summarize, now=lambda: NOW)
    rec.record_user("hello")
    rec.record_agent("hi there")
    await rec.flush(USAGE)

    assert [c[0] for c in mgr.calls] == ["files", "memory", "summary", "history", "end", "usage"]
    saved = mgr.calls[1][2]
    assert saved.startswith(MEMORY.split("\n## Session")[0])  # built on the manager's latest copy
    assert "- Has a dog named Harry" in saved and saved.endswith("[quizzy] (2 messages): Played the quiz and got two right.\n")
    assert (tmp_path / "memory" / "MEMORY.md").read_text(encoding="utf-8") == saved
    assert mgr.calls[2][2:] == ("room-1", "Played the quiz and got two right.", 2)
    assert [m["role"] for m in seen[0]] == ["user", "assistant"]
    msgs = mgr.calls[3][3]
    assert [m["chatType"] for m in msgs] == [1, 2] and abs(msgs[0]["timestamp"] - time.time()) < 60
    assert mgr.calls[5][3]["totalTokens"] == 120 and mgr.calls[5][3]["sessionDurationSeconds"] == 31.0


@pytest.mark.asyncio
async def test_summary_failure_still_uploads_history(tmp_path: Path):
    async def boom(messages):
        raise RuntimeError("model down")

    mgr = FakeManager()
    rec = SessionRecorder(FakeSession(), mgr, plan(tmp_path), summarize=boom, now=lambda: NOW)
    rec.record_user("hello")
    await rec.flush(USAGE)
    assert [c[0] for c in mgr.calls] == ["history", "end", "usage"]


@pytest.mark.asyncio
async def test_flush_skips_summary_for_silent_sessions_and_everything_without_mac(tmp_path: Path):
    called = []

    async def summarize(messages):
        called.append(1)
        return "x"

    mgr = FakeManager()
    await SessionRecorder(FakeSession(), mgr, plan(tmp_path), summarize=summarize).flush(SimpleNamespace(model_usage=[]))
    assert [c[0] for c in mgr.calls] == ["end", "usage"] and not called  # the manager rejects an empty messages array

    mgr = FakeManager()
    await SessionRecorder(FakeSession(), mgr, plan(tmp_path, mac=None), summarize=summarize).flush(SimpleNamespace(model_usage=[]))
    assert mgr.calls == [] and not called
