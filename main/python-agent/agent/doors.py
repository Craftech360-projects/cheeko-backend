"""The Door ladder, ported word for word from picoclaw agent_bridge.go doorDirective."""
from __future__ import annotations

DOOR_OPEN, DOOR_CHOICE, DOOR_GUIDED = 1, 2, 3


def _authored(q: dict) -> tuple[bool, bool]:
    choices = [c for c in (q.get("choice_order") or []) if str(c).strip()]
    return len(choices) >= 2, bool(str(q.get("teach_text") or "").strip())


def door_for(q: dict, tries: int) -> int:
    has_choices, has_teach = _authored(q)
    if tries <= 0:
        return DOOR_OPEN
    if tries == 1:
        return DOOR_CHOICE if has_choices else (DOOR_GUIDED if has_teach else DOOR_OPEN)
    return DOOR_GUIDED if has_teach else (DOOR_CHOICE if has_choices else DOOR_OPEN)


def ladder_exhausted(q: dict, tries: int) -> bool:
    has_choices, has_teach = _authored(q)
    if not has_choices and not has_teach:
        return tries >= 2  # no authored ladder: the prompt's own two-miss reveal
    return tries >= DOOR_GUIDED


def door_directive_text(q: dict, tries: int) -> str:
    qid = str(q.get("id") or "")
    has_choices, has_teach = _authored(q)
    if not has_choices and not has_teach:
        if tries == 0:
            return ""
        if tries == 1:
            return (f"## This Question\nThe child has now missed question {qid} once. Give one hint or an either/or version, "
                    f"then ask the same question again and wait.")
        return (f"## This Question\nThe child has now missed question {qid} {tries} times. Kindly tell them the answer, say one "
                f"warm encouraging line, and move straight on to the next question. Your MEMO for this turn MUST carry "
                f"scored_q={qid}, scored_text, and result=revealed.")
    if tries >= DOOR_GUIDED:
        return (f"## This Question\nQuestion {qid} has now had all three tries. Do not explain it again and do NOT tell the child "
                f"the answer. Say one warm line — you will come back to this one another day — and move straight on to the next "
                f"question. Your MEMO for this turn MUST carry scored_q={qid}, scored_text, and result=revealed.")
    door = door_for(q, tries)
    if door == DOOR_CHOICE:
        a, b = (q.get("choice_order") or ["", ""])[:2]
        return (f"## This Question\nAsk question {qid} as a two-way choice, exactly these options and in this order: "
                f'"{a}" or "{b}". Do not add a third option and do not say which is right.')
    if door == DOOR_GUIDED:
        return (f"## This Question\nQuestion {qid}: say this explanation in your own warm words, in one breath: "
                f'"{q.get("teach_text")}". Then ask the question again and wait. Do NOT say the answer.')
    return f"## This Question\nAsk question {qid} plainly, in your own words. Do not offer choices and do not hint yet."
