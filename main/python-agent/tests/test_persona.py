from agent.persona import ACCENT_INDIAN, backend_instructions, greeting_instruction, voice_instructions


def test_voice_instructions_layers_files_rules_bank_and_accent():
    v = voice_instructions("# Cheeko\n\n---\n\n## AGENT.md\n\nYou are Quizzy.", "Hindi", "indian", "## Today's Quiz Questions\n1. (id=11) ...", True)
    assert v.index("You are Quizzy.") < v.index("<delegation>") < v.index("(id=11)") < v.index("<accent>")
    assert "Speak Hindi" in v and "quiz" in v.lower() and "remember_child_fact" not in v
    assert ACCENT_INDIAN in v
    plain = voice_instructions("x", "English", "default", "", False)
    assert "<accent>" not in plain and "scored" not in plain
    # seen live 2026-09-13: "Goodbye" as an answer ended the quiz, and a clue was improvised outside the ladder
    assert "not a request to stop" in v and "clue" in v


def test_speech_rules_come_last_and_override_picoclaw_text_rules():
    # picoclaw strips MEMO lines and [tags] from text before TTS; GPT-Live speaks everything it produces
    v = voice_instructions("Everything you output is spoken aloud, except the hidden MEMO line.", "English", "indian",
                           "## Session start\nAsk question one.", True, today="Sunday, 13 September 2026")
    rules = v[v.index("<speech>"):]
    assert v.index("## Session start") < v.index("<accent>") < v.index("<speech>")
    assert "MEMO" in rules and "square brackets" in rules and "Sunday, 13 September 2026" in rules
    assert "<speech>" in voice_instructions("x", "English", "default", "", False)


def test_backend_instructions_carry_bank_and_memos():
    b = backend_instructions("## Today's Quiz Questions", ["MEMO: type=daily_quiz | date=2026-09-12 | answered=3"], True)
    assert "quiz_score_answer" in b and "## Today's Quiz Questions" in b and "MEMO: type=daily_quiz" in b
    assert "meaning" in b  # "rain" for "water" was scored a miss for a 4-year-old
    assert "quiz_score_answer" not in backend_instructions("", [], False)


def test_greeting_instruction_is_short_and_points_at_session_start():
    g = greeting_instruction("Quizzy", has_session_start=True)
    assert "Quizzy" in g and "Session start" in g and len(g) < 400  # GPT-Live caps a commentary append at 500 tokens
    assert "greet" in greeting_instruction("Cheeko", has_session_start=False).lower()
