import time
from types import SimpleNamespace

import pytest

from agent.persistence import SessionRecorder


class FakeManager:
    enabled = True

    def __init__(self):
        self.calls = []

    async def send_chat_history(self, mac, sid, messages):
        self.calls.append(("history", mac, sid, messages))

    async def send_session_end(self, mac, sid, n):
        self.calls.append(("end", mac, sid, n))

    async def send_token_usage(self, mac, sid, usage):
        self.calls.append(("usage", mac, sid, usage))


class FakeSession:
    def on(self, name):
        return lambda fn: fn


def plan(mac="68:EE:8F:60:BA:AC"):
    return SimpleNamespace(meta=SimpleNamespace(device_mac=mac), room_name="room-1")


@pytest.mark.asyncio
async def test_flush_posts_history_end_and_usage():
    mgr = FakeManager()
    rec = SessionRecorder(FakeSession(), mgr, plan())
    rec.record_user("hello")
    rec.record_agent("hi there")
    usage = SimpleNamespace(model_usage=[
        SimpleNamespace(model="gpt-live-1", session_duration=31.0, input_tokens=0, output_tokens=0, total_tokens=0),
        SimpleNamespace(model="gpt-5.6-luna", session_duration=0, input_tokens=100, output_tokens=20, total_tokens=120),
    ])
    await rec.flush(usage)
    assert [c[0] for c in mgr.calls] == ["history", "end", "usage"]
    assert mgr.calls[0][2] == "room-1"
    msgs = mgr.calls[0][3]
    assert [m["chatType"] for m in msgs] == [1, 2] and msgs[1]["content"] == "hi there"
    assert abs(msgs[0]["timestamp"] - time.time()) < 60  # the manager reads numeric timestamps as epoch seconds
    assert mgr.calls[1][3] == 2
    assert mgr.calls[2][3]["totalTokens"] == 120 and mgr.calls[2][3]["sessionDurationSeconds"] == 31.0 and mgr.calls[2][3]["messageCount"] == 2


@pytest.mark.asyncio
async def test_flush_skips_empty_history_and_missing_mac():
    mgr = FakeManager()
    await SessionRecorder(FakeSession(), mgr, plan()).flush(SimpleNamespace(model_usage=[]))
    assert [c[0] for c in mgr.calls] == ["end", "usage"]  # the manager rejects an empty messages array

    mgr = FakeManager()
    await SessionRecorder(FakeSession(), mgr, plan(mac=None)).flush(SimpleNamespace(model_usage=[]))
    assert mgr.calls == []
