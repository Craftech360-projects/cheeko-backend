"""Game state the voice model cannot hold in prose: pending question, tries, verdicts."""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Callable

from livekit.agents import function_tool

from .doors import DOOR_GUIDED, door_directive_text, door_for, ladder_exhausted

logger = logging.getLogger("cheeko-gptlive.quiz")

MEMO_TYPES = {"quizzy": "daily_quiz", "bujho": "daily_riddle", "ginti": "daily_math"}


def memo_type_for(character: str) -> str:
    return MEMO_TYPES.get((character or "").strip().lower(), "")


class QuizTracker:
    def __init__(self, batch: dict, workspace: Path, memo_type: str, manager, device_mac: str,
                 on_directive: Callable[[str], None] | None = None, now: Callable[[], datetime] | None = None) -> None:
        self.batch = batch or {}
        self.questions: list[dict] = list(self.batch.get("questions") or [])
        self.workspace = Path(workspace)
        self.memo_type = memo_type or "daily_quiz"
        self.manager = manager
        self.device_mac = device_mac
        self.on_directive = on_directive
        self.now = now or datetime.now
        self.reported: set[str] = set()
        self.tries: dict[str, int] = {}
        self.attempts: dict[str, list[dict]] = {}

    def _find(self, qid: str) -> dict | None:
        qid = str(qid or "").strip()
        return next((q for q in self.questions if str(q.get("id")) == qid), None)

    def pending(self) -> dict | None:
        return next((q for q in self.questions if str(q.get("id")) not in self.reported), None)

    def status(self) -> str:
        answered = int(self.batch.get("answered_today") or 0) + len(self.reported)
        total = int(self.batch.get("answered_today") or 0) + len(self.questions)
        q = self.pending()
        if q is None:
            return f"STATUS: answered={answered} of {total} today | all questions done"
        qid = str(q.get("id"))
        tries = self.tries.get(qid, 0)
        return (f"STATUS: answered={answered} of {total} today | pending question id={qid} "
                f"(door {door_for(q, tries)}, tries {tries}): {q.get('question_text')}")

    async def score(self, question_id: str, result: str, transcript: str) -> str:
        q = self._find(question_id)
        if q is None:
            raise ValueError(f"question {question_id!r} is not in today's batch")
        qid = str(q.get("id"))
        if qid in self.reported:
            raise ValueError(f"question {qid} was already scored")
        transcript = (transcript or "").strip()
        if result == "miss":
            self.tries[qid] = self.tries.get(qid, 0) + 1
            self.attempts.setdefault(qid, []).append({"verdict": "wrong", "transcript": transcript})
            if not ladder_exhausted(q, self.tries[qid]):
                return self._next_directive(q)
            return await self._record(q, "revealed")
        if result == "correct":
            self.attempts.setdefault(qid, []).append({"verdict": "correct", "transcript": transcript})
            verdict = "revealed" if door_for(q, self.tries.get(qid, 0)) == DOOR_GUIDED else "correct"  # ADR-0009 mastery rule
            return await self._record(q, verdict)
        if result == "revealed":
            self.attempts.setdefault(qid, []).append({"verdict": "revealed", "transcript": transcript})
            return await self._record(q, "revealed")
        raise ValueError('result must be "correct", "miss" or "revealed"')

    async def _record(self, q: dict, verdict: str) -> str:
        qid = str(q.get("id"))
        self.reported.add(qid)
        answered = int(self.batch.get("answered_today") or 0) + len(self.reported)
        text = str(q.get("question_text") or "").replace("|", "/")
        memo = (f"MEMO: type={self.memo_type} | date={self.now().strftime('%Y-%m-%d')} | scored_q={qid} | "
                f"scored_text={text} | result={verdict} | answered={answered}")
        state_dir = self.workspace / "memory" / "state"
        state_dir.mkdir(parents=True, exist_ok=True)
        (state_dir / f"{self.memo_type}.md").write_text(memo + "\n", encoding="utf-8")
        await self.manager.post_quiz_answer(self.device_mac, qid, verdict, str(self.batch.get("bank") or ""), list(self.attempts.get(qid, [])))
        terminal = door_directive_text(q, self.tries.get(qid, 0)) if verdict == "revealed" and self.tries.get(qid, 0) > 0 else ""
        nxt = self.pending()
        tail = self._next_directive(nxt) if nxt else "All of today's questions are done. Celebrate briefly and move on to free play."
        return (terminal + "\n\n" + tail).strip()

    def _next_directive(self, q: dict) -> str:
        d = door_directive_text(q, self.tries.get(str(q.get("id")), 0)) or \
            f"## This Question\nAsk question {q.get('id')} plainly, in your own words. Do not offer choices and do not hint yet."
        if self.on_directive:
            self.on_directive(d)
        return d

    async def record_wonder(self, question: str, answer: str, code: str) -> None:
        await self.manager.post_wonder(self.device_mac, question, answer, code)


def quiz_tools(tracker: QuizTracker) -> list:
    @function_tool(name="quiz_status")
    async def quiz_status() -> str:
        """Where today's quiz stands: answered count, the pending question and its Door. Call before asking if unsure."""
        return tracker.status()

    @function_tool(name="quiz_score_answer")
    async def quiz_score_answer(question_id: str, result: str, transcript: str = "") -> str:
        """Score the child's latest answer to a quiz question.

        Args:
            question_id: The id shown next to the question, e.g. "11".
            result: "correct" when it matches the bank answer, "miss" when it does not (the tool decides hints,
                choices and reveals), "revealed" when the child asked for the answer.
            transcript: What the child said, verbatim.
        """
        try:
            return await tracker.score(question_id, result, transcript)
        except ValueError as e:
            return f"error: {e}"

    @function_tool(name="quiz_record_wonder")
    async def quiz_record_wonder(question: str, answer: str, code: str = "") -> str:
        """Record the Wonder Question the child asked today and the answer given, for tomorrow's recall.

        Args:
            question: The wonder question, as asked.
            answer: The child's answer or the answer given.
            code: The wonder code from the quiz block, e.g. "W7".
        """
        await tracker.record_wonder(question, answer, code)
        return "recorded"

    return [quiz_status, quiz_score_answer, quiz_record_wonder]
