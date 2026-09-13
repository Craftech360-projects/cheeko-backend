from agent.persona import ACCENT_INDIAN, backend_instructions, greeting_instruction, voice_instructions


def test_voice_instructions_layers_files_rules_bank_and_accent():
    v = voice_instructions("# Cheeko\n\n---\n\n## AGENT.md\n\nYou are Quizzy.", "Hindi", "indian", "## Today's Quiz Questions\n1. (id=11) ...", True)
    assert v.index("You are Quizzy.") < v.index("<delegation>") < v.index("(id=11)") < v.index("<accent>")
    assert "Speak Hindi" in v and "quiz" in v.lower() and "remember_child_fact" not in v
    assert ACCENT_INDIAN in v
    plain = voice_instructions("x", "English", "default", "", False)
    assert "<accent>" not in plain and "scored" not in plain


def test_backend_instructions_carry_bank_and_memos():
    b = backend_instructions("## Today's Quiz Questions", ["MEMO: type=daily_quiz | date=2026-09-12 | answered=3"], True)
    assert "quiz_score_answer" in b and "## Today's Quiz Questions" in b and "MEMO: type=daily_quiz" in b
    assert "quiz_score_answer" not in backend_instructions("", [], False)


def test_greeting_instruction():
    g = greeting_instruction("Quizzy", "Start with question one.")
    assert "Quizzy" in g and "Start with question one." in g
    assert "greet" in greeting_instruction("Cheeko", "").lower()
