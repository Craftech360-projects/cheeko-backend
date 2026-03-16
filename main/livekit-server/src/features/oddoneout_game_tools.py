"""Odd One Out game tools — LLM function tool for voice answer processing."""
import json
import logging
from livekit.agents import function_tool

logger = logging.getLogger("oddoneout_game_tools")

_oddoneout_game_state = None


def set_oddoneout_game_state(state):
    global _oddoneout_game_state
    _oddoneout_game_state = state


def _fuzzy_match_item(speech: str, items: list) -> str | None:
    """
    Match spoken text to one of the option labels.
    Handles: exact match, substring, ordinal ("the first one", "option A").
    """
    cleaned = speech.strip().lower()

    # Exact match
    for item in items:
        if cleaned == item.lower():
            return item

    # Substring match ("the banana one" -> "Banana")
    for item in items:
        if item.lower() in cleaned:
            return item

    # Ordinal match ("first", "second", "option a", "number 1")
    ordinal_map = {
        "first": 0, "1st": 0, "one": 0, "1": 0, "a": 0,
        "second": 1, "2nd": 1, "two": 1, "2": 1, "b": 1,
        "third": 2, "3rd": 2, "three": 2, "3": 2, "c": 2,
        "fourth": 3, "4th": 3, "four": 3, "4": 3, "d": 3,
    }
    for word in cleaned.split():
        if word in ordinal_map:
            idx = ordinal_map[word]
            if idx < len(items):
                return items[idx]

    # "option A/B/C/D" pattern
    for prefix in ["option ", "choice "]:
        if cleaned.startswith(prefix):
            letter = cleaned[len(prefix):].strip()
            if letter in ordinal_map:
                idx = ordinal_map[letter]
                if idx < len(items):
                    return items[idx]

    return None


@function_tool
async def check_oddoneout_answer(answer: str) -> str:
    """Check which item the child selected as the odd one out.

    Args:
        answer: The child's spoken answer, e.g. "banana", "the first one", "option B"
    """
    state = _oddoneout_game_state
    if not state or not state.current_question:
        return json.dumps({"error": "no_active_question"})

    items = state.current_question.get("items", [])
    matched = _fuzzy_match_item(answer, items)

    if matched is None:
        items_str = ", ".join(items)
        return json.dumps({
            "action": "prompt_retry",
            "message": f"I didn't catch that! Pick one: {items_str}",
            "original_text": answer,
        })

    result = {
        "action": "answer_checked",
        "selected_item": matched,
        "question_id": state.current_question_id,
        "input_method": "voice",
    }
    logger.info(f"tool.check_oddoneout(selected={matched}, qid={state.current_question_id})")
    return json.dumps(result)
