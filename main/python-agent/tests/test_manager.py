import pytest

from agent.manager import ManagerClient


class FakeFetch:
    def __init__(self, responses):
        self.responses, self.calls = responses, []

    async def __call__(self, method, url, body):
        self.calls.append((method, url, body))
        for prefix, resp in self.responses.items():
            if prefix in url:
                return resp
        return 404, {"code": 404, "msg": "not found"}


@pytest.mark.asyncio
async def test_character_session_by_name_then_by_id():
    fetch = FakeFetch({"/agent/character/by-name/Quizzy/session": (200, {"code": 0, "data": {"systemPrompt": "You are Quizzy", "soul": "Curious", "greetingPrompt": "Ask {{QUIZ_QUESTIONS}}", "language": "en"}})})
    mc = ManagerClient("http://m/toy", "s3cret", fetch=fetch)
    got = await mc.character_session("Quizzy", "c-1")
    assert got["systemPrompt"] == "You are Quizzy"
    assert fetch.calls[0][0] == "GET"

    fetch = FakeFetch({"/agent/character/c-1/session": (200, {"code": 0, "data": {"systemPrompt": "by id"}})})
    mc = ManagerClient("http://m/toy", "s3cret", fetch=fetch)
    assert (await mc.character_session("Nobody", "c-1"))["systemPrompt"] == "by id"
    assert await ManagerClient("http://m/toy", "s", fetch=FakeFetch({})).character_session("X", "") is None


@pytest.mark.asyncio
async def test_quiz_batch_and_reporters_use_the_cascade_payloads():
    fetch = FakeFetch({"/quiz/next-questions": (200, {"code": 0, "data": {"level": 1, "questions": [{"id": "11"}]}}),
                       "/quiz/answer": (200, {"code": 0}), "/quiz/attempts": (200, {"code": 0}), "/quiz/wonder": (200, {"code": 0})})
    mc = ManagerClient("http://m/toy", "s", fetch=fetch)
    batch = await mc.quiz_batch("68:EE:8F:60:BA:AC", "Quizzy")
    assert batch["level"] == 1 and "device_mac=68%3AEE%3A8F%3A60%3ABA%3AAC" in fetch.calls[0][1] and "character=Quizzy" in fetch.calls[0][1]
    await mc.post_quiz_answer("68:EE:8F:60:BA:AC", "11", "correct", "quiz", [{"verdict": "correct", "transcript": "eight"}])
    assert fetch.calls[1][2] == {"device_mac": "68:EE:8F:60:BA:AC", "question_id": "11", "result": "correct", "bank": "quiz",
                                 "attempts": [{"verdict": "correct", "transcript": "eight"}]}
    await mc.post_wonder("68:EE:8F:60:BA:AC", "why is the sky blue", "scattering", "W1")
    assert fetch.calls[2][2] == {"device_mac": "68:EE:8F:60:BA:AC", "question": "why is the sky blue", "answer": "scattering", "code": "W1"}


@pytest.mark.asyncio
async def test_persistence_payloads():
    fetch = FakeFetch({"/agent/chat-history/session": (200, {"code": 0}), "/sessions/room-1/end": (200, {"code": 0}), "/device/token-usage": (200, {"code": 0})})
    mc = ManagerClient("http://m/toy", "s", fetch=fetch)
    await mc.send_chat_history("AA:BB:CC:DD:EE:FF", "room-1", [{"chatType": 1, "content": "hi", "timestamp": 1}])
    await mc.send_session_end("AA:BB:CC:DD:EE:FF", "room-1", 1)
    await mc.send_token_usage("AA:BB:CC:DD:EE:FF", "room-1", {"totalTokens": 120, "sessionDurationSeconds": 31.0, "messageCount": 1})
    assert fetch.calls[0][2]["macAddress"] == "AA:BB:CC:DD:EE:FF" and fetch.calls[0][2]["sessionId"] == "room-1"
    assert "/agent/device/AA:BB:CC:DD:EE:FF/sessions/room-1/end" in fetch.calls[1][1] and fetch.calls[1][2]["status"] == "ended"
    assert fetch.calls[2][2]["mac"] == "AA:BB:CC:DD:EE:FF" and fetch.calls[2][2]["totalTokens"] == 120


@pytest.mark.asyncio
async def test_failures_never_raise():
    async def boom(method, url, body):
        raise RuntimeError("down")
    mc = ManagerClient("http://m/toy", "s", fetch=boom)
    assert await mc.character_session("Quizzy", "") is None
    assert await mc.quiz_batch("AA", "Quizzy") is None
    assert await mc.progress_state("AA") == []
    await mc.post_quiz_answer("AA", "1", "correct", "", [])  # no exception
