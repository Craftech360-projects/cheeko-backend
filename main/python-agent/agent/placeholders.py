"""The {{PLACEHOLDER}} vocabulary the manager-owned greeting prompts use."""
from __future__ import annotations

import re
from datetime import datetime

QUIZ_PLACEHOLDERS = ("{{QUIZ_QUESTIONS}}", "{{RIDDLES}}", "{{MATH_PROBLEMS}}")
# ponytail: content banks are stripped, not rendered; add content_block() when the banks are wired
CONTENT_PLACEHOLDERS = ("{{JOKES}}", "{{WHY_QUESTIONS}}", "{{STORY_OF_THE_DAY}}", "{{WORDS_OF_THE_DAY}}", "{{SPELL_WORDS}}", "{{TODAY_PLAN}}", "{{TAG}}")
_ANY = re.compile(r"\{\{[A-Z_]+\}\}")


def wants_quiz(prompt: str) -> bool:
    return any(p in (prompt or "") for p in QUIZ_PLACEHOLDERS)


def time_band(now: datetime) -> str:
    h = now.hour
    return "morning" if h < 12 else "afternoon" if h < 17 else "evening" if h < 21 else "night"


def quiz_block(batch: dict | None) -> str:
    if not batch or not batch.get("questions"):
        return ("## Today's Quiz Questions\nThe question bank is unavailable right now. Do NOT run a scored quiz and do NOT "
                "invent questions. Offer free chat instead, and tell the child new questions are coming soon.")
    band = str(batch.get("age_band") or "").strip()
    lines = [f"## Today's Quiz Questions (Level {batch.get('level', 1)}{', ages ' + band if band else ''})"]
    answered = int(batch.get("answered_today") or 0)
    if answered:
        lines.append(f"The child has answered {answered} already today; continue from the list below, in order.")
    for i, q in enumerate(batch["questions"], 1):
        accepted = [str(a) for a in (q.get("accepted_answers") or []) if str(a).strip()]
        extra = f" (also accept: {', '.join(accepted)})" if accepted else ""
        lines.append(f"{i}. (id={q.get('id')}) {q.get('question_text')} — Answer: {q.get('answer_text')}{extra}")
    wonder = batch.get("wonder_to_ask") or {}
    if wonder.get("question_text"):
        lines.append("")
        lines.append(f"Wonder Question (code {wonder.get('code', '')}): {wonder['question_text']}")
        if wonder.get("second_pass") and wonder.get("previous_answer"):
            lines.append(f"Last time the child answered: {wonder['previous_answer']}")
    return "\n".join(lines)


def render_placeholders(prompt: str, batch: dict | None, now: datetime) -> str:
    out = prompt or ""
    block = quiz_block(batch) if wants_quiz(out) else ""
    for p in QUIZ_PLACEHOLDERS:
        out = out.replace(p, block)
    out = out.replace("{{TODAY_DATE}}", now.strftime("%A, %d %B %Y")).replace("{{TIME_BAND}}", time_band(now))
    for p in CONTENT_PLACEHOLDERS:
        out = out.replace(p, "")
    return _ANY.sub("", out)
