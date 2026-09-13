from datetime import datetime
from pathlib import Path

import pytest

from agent.manager import ManagerClient
from cheeko_gptlive_worker import assemble_session

ROOM = "969bf3c6-8d58-4fe5-9f5b-0b964d27e295_68EE8F60BAAC_conversation"
META = '{"character":"Quizzy","child_profile":{"name":"Aarav","age":7},"gptlive":{"voice":"vesper","accent":"indian"}}'


class FakeFetch:
    async def __call__(self, method, url, body):
        if "/agent/character/by-name/Quizzy/session" in url:
            return 200, {"code": 0, "data": {"systemPrompt": "You are Quizzy, quiz master.", "soul": "Kind.", "greetingPrompt": "Ask away. {{QUIZ_QUESTIONS}}", "language": "en"}}
        if "/quiz/next-questions" in url:
            return 200, {"code": 0, "data": {"level": 1, "age_band": "6-8", "bank": "quiz", "answered_today": 0,
                                            "questions": [{"id": "11", "question_text": "How many legs does a spider have?", "answer_text": "eight", "accepted_answers": [], "choice_order": [], "teach_text": ""}]}}
        if "/progress/state" in url:
            return 200, {"code": 0, "data": {"states": [{"state_type": "daily_quiz", "memo": "MEMO: type=daily_quiz | date=2026-09-12"}]}}
        return 404, {}


@pytest.mark.asyncio
async def test_assemble_quizzy_session(tmp_path: Path):
    plan = await assemble_session(ROOM, META, ManagerClient("http://m/toy", "s", fetch=FakeFetch()), tmp_path, now=lambda: datetime(2026, 9, 13, 9))
    assert plan.meta.voice == "vesper" and plan.meta.accent == "indian" and plan.has_quiz
    assert (plan.workspace / "AGENT.md").exists() and "You are Quizzy, quiz master." in plan.voice_instructions
    assert "(id=11)" in plan.voice_instructions and "(id=11)" in plan.backend_instructions and "<accent>" in plan.voice_instructions
    assert "MEMO: type=daily_quiz" in plan.backend_instructions
    assert "Ask away." in plan.greeting and "{{" not in plan.greeting
    assert [t.info.name for t in plan.tools] == ["get_time_date", "remember_child_fact", "quiz_status", "quiz_score_answer", "quiz_record_wonder"]


@pytest.mark.asyncio
async def test_assemble_without_manager_degrades(tmp_path: Path):
    plan = await assemble_session("gptlive-test-9", None, ManagerClient("", ""), tmp_path)
    assert plan.meta.character == "Cheeko" and not plan.has_quiz and plan.quiz_tracker is None
    assert "You are Cheeko" in plan.voice_instructions and [t.info.name for t in plan.tools] == ["get_time_date", "remember_child_fact"]
