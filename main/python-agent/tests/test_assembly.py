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
            return 200, {"code": 0, "data": {
                "systemPrompt": "You are Quizzy, quiz master.\n- Start every spoken sentence with an expression tag such as [excited] or [happy].\n- Cheer: \"[excited] Ting!\"",
                "soul": "[happy] Kind.",
                "greetingPrompt": "Ask away. Begin every spoken sentence with an expression tag such as [curious]. {{QUIZ_QUESTIONS}}", "language": "en"}}
        if "/quiz/next-questions" in url:
            return 200, {"code": 0, "data": {"level": 1, "age_band": "6-8", "bank": "quiz", "answered_today": 0,
                                            "questions": [{"id": "11", "question_text": "How many legs does a spider have?", "answer_text": "eight", "accepted_answers": [], "choice_order": [], "teach_text": ""}]}}
        if "/progress/state" in url:
            return 200, {"code": 0, "data": {"states": [{"state_type": "daily_quiz", "memo": "MEMO: type=daily_quiz | date=2026-09-12"}]}}
        return 404, {}


@pytest.mark.asyncio
async def test_assemble_quizzy_session(tmp_path: Path):
    plan = await assemble_session(ROOM, META, ManagerClient("http://m/toy", "s", fetch=FakeFetch()), tmp_path, now=lambda: datetime(2026, 9, 13, 9))
    assert plan.meta.voice == "vesper" and plan.meta.accent == "indian" and plan.has_quiz and plan.room_name == ROOM
    assert (plan.workspace / "AGENT.md").exists() and "You are Quizzy, quiz master." in plan.voice_instructions
    assert "(id=11)" in plan.voice_instructions and "(id=11)" in plan.backend_instructions and "<accent>" in plan.voice_instructions
    assert "MEMO: type=daily_quiz" in plan.backend_instructions
    # the greeting prompt lives in the session instructions; the spoken ask stays under GPT-Live's 500-token append cap
    assert "## Session start" in plan.voice_instructions and "Ask away." in plan.voice_instructions and "{{" not in plan.voice_instructions
    assert plan.voice_instructions.count("(id=11)") == 1
    assert "Ask away." not in plan.greeting and len(plan.greeting) < 400
    assert "Sunday, 13 September 2026" in plan.voice_instructions
    # picoclaw face tags: rules and tagged examples are gone from the files and the instructions (the <speech> ban stays)
    body = plan.voice_instructions[:plan.voice_instructions.index("<speech>")]
    assert "expression tag" not in body and "[excited]" not in body and "[happy]" not in body and "[curious]" not in body
    assert '- Cheer: "Ting!"' in (plan.workspace / "AGENT.md").read_text(encoding="utf-8")
    assert "[happy]" not in (plan.workspace / "SOUL.md").read_text(encoding="utf-8")
    assert [t.info.name for t in plan.tools] == ["get_time_date", "remember_child_fact", "quiz_status", "quiz_score_answer", "quiz_record_wonder"]


@pytest.mark.asyncio
async def test_assemble_without_manager_degrades(tmp_path: Path):
    plan = await assemble_session("gptlive-test-9", None, ManagerClient("", ""), tmp_path)
    assert plan.meta.character == "Cheeko" and not plan.has_quiz and plan.quiz_tracker is None
    assert "You are Cheeko" in plan.voice_instructions and [t.info.name for t in plan.tools] == ["get_time_date", "remember_child_fact"]
