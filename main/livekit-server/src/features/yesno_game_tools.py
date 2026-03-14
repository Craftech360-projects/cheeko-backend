"""Yes/No Quiz game tools — LLM function tools for voice answer processing."""
import json
import logging
from livekit.agents import function_tool

logger = logging.getLogger("yesno_game_tools")

_yesno_game_state = None


def set_yesno_game_state(state):
    global _yesno_game_state
    _yesno_game_state = state


YES_WORDS = {
    "yes", "yeah", "yep", "yup", "sure", "correct", "true", "right",
    "uh huh", "mm hmm", "yah", "ya", "si", "of course", "definitely",
    "haan", "ha", "haji", "sahi", "bilkul",
}

NO_WORDS = {
    "no", "nah", "nope", "naw", "nuh", "false", "wrong", "never",
    "uh uh", "mm mm", "nay", "not",
    "nahi", "nahin", "naa", "galat", "bilkul nahi",
}


def _normalize_yesno(text: str) -> str | None:
    """Normalize spoken text to 'yes', 'no', or None (unknown)."""
    cleaned = text.strip().lower().rstrip(".,!?")
    if cleaned in YES_WORDS:
        return "yes"
    if cleaned in NO_WORDS:
        return "no"
    for word in YES_WORDS:
        if word in cleaned:
            return "yes"
    for word in NO_WORDS:
        if word in cleaned:
            return "no"
    return None


@function_tool
async def check_yesno_answer(answer: str) -> str:
    """Check if the child's yes/no answer is correct.

    Args:
        answer: The child's spoken answer, e.g. "yes", "no", "yeah", "nahi"
    """
    state = _yesno_game_state
    if not state or not state.current_question:
        return json.dumps({"error": "no_active_question"})

    normalized = _normalize_yesno(answer)

    if normalized is None:
        return json.dumps({
            "action": "prompt_retry",
            "message": "I didn't catch that! Try saying YES or NO.",
            "original_text": answer,
        })

    correct_answer = state.current_question.get("correct_answer", True)
    user_said_yes = (normalized == "yes")
    is_correct = (user_said_yes == correct_answer)

    result_meta = state.record_answer(is_correct)

    result = {
        "action": "answer_checked",
        "correct": is_correct,
        "user_answer": normalized,
        "correct_answer": correct_answer,
        "fun_fact": state.current_question.get("fun_fact", ""),
        "question_id": state.current_question_id,
        "input_method": "voice",
        "progress": state._get_progress(),
        **result_meta,
    }

    logger.info(f"tool.check_yesno(answer={normalized}, correct={is_correct}, "
                f"stars={state.stars}, streak={state.consecutive_correct})")

    return json.dumps(result)
