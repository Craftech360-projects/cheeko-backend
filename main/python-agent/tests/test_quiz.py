from datetime import datetime
from pathlib import Path

import pytest

from agent.quiz import QuizTracker, memo_type_for, quiz_tools

BATCH = {"level": 1, "age_band": "6-8", "bank": "quiz", "answered_today": 2,
         "questions": [{"id": "11", "question_text": "How many legs does a spider have?", "answer_text": "eight", "accepted_answers": ["8"],
                        "choice_order": ["eight", "six"], "teach_text": "four legs each side"},
                       {"id": "12", "question_text": "What colour is the sky?", "answer_text": "blue", "accepted_answers": [], "choice_order": [], "teach_text": ""}]}


class FakeManager:
    def __init__(self):
        self.answers, self.wonders = [], []

    async def post_quiz_answer(self, mac, qid, result, bank, attempts):
        self.answers.append((qid, result, bank, attempts))

    async def post_quiz_attempts(self, mac, qid, attempts):
        pass

    async def post_wonder(self, mac, question, answer, code):
        self.wonders.append((question, answer, code))


def tracker(tmp_path, mgr):
    return QuizTracker(BATCH, tmp_path, "daily_quiz", mgr, "68:EE:8F:60:BA:AC", now=lambda: datetime(2026, 9, 13))


def test_memo_type():
    assert memo_type_for("Quizzy") == "daily_quiz" and memo_type_for("bujho") == "daily_riddle" and memo_type_for("Cheeko") == ""


@pytest.mark.asyncio
async def test_correct_writes_memo_reports_and_moves_on(tmp_path: Path):
    mgr = FakeManager()
    t = tracker(tmp_path, mgr)
    directive = await t.score("11", "correct", "eight")
    assert "Ask question 12 plainly" in directive
    memo = (tmp_path / "memory" / "state" / "daily_quiz.md").read_text(encoding="utf-8")
    assert memo.startswith("MEMO: type=daily_quiz | date=2026-09-13 | scored_q=11 | scored_text=How many legs does a spider have? | result=correct | answered=3")
    assert mgr.answers == [("11", "correct", "quiz", [{"verdict": "correct", "transcript": "eight"}])]
    with pytest.raises(ValueError):
        await t.score("11", "correct", "eight")


@pytest.mark.asyncio
async def test_misses_walk_the_ladder_then_reveal(tmp_path: Path):
    mgr = FakeManager()
    pushed = []
    t = tracker(tmp_path, mgr)
    t.on_directive = pushed.append
    assert '"eight" or "six"' in await t.score("11", "miss", "six")
    assert "four legs each side" in await t.score("11", "miss", "ten")
    final = await t.score("11", "miss", "twelve")
    assert "all three tries" in final and "Ask question 12 plainly" in final
    assert mgr.answers[0][1] == "revealed" and len(mgr.answers[0][3]) == 3
    assert "pending question id=12" in t.status() and len(pushed) == 3


@pytest.mark.asyncio
async def test_correct_at_door_three_is_revealed(tmp_path: Path):
    mgr = FakeManager()
    t = tracker(tmp_path, mgr)
    await t.score("11", "miss", "six")
    await t.score("11", "miss", "ten")
    await t.score("11", "correct", "eight")
    assert mgr.answers[0][1] == "revealed"


@pytest.mark.asyncio
async def test_tools_are_function_tools_with_the_right_names(tmp_path: Path):
    t = tracker(tmp_path, FakeManager())
    tools = quiz_tools(t)
    assert [tool.info.name for tool in tools] == ["quiz_status", "quiz_score_answer", "quiz_record_wonder"]
    assert (await tools[1]("99", "correct", "x")).startswith("error:")  # unknown ids come back as a string error
