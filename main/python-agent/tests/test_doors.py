from agent.doors import door_directive_text, door_for, ladder_exhausted

FULL = {"id": "7", "question_text": "How many legs?", "choice_order": ["eight", "six"], "teach_text": "four legs each side"}
BARE = {"id": "8", "question_text": "What colour?", "choice_order": [], "teach_text": ""}


def test_door_for_clamps_and_skips_unauthored_doors():
    assert [door_for(FULL, t) for t in (0, 1, 2, 9)] == [1, 2, 3, 3]
    assert [door_for(BARE, t) for t in (0, 1, 2, 5)] == [1, 1, 1, 1]


def test_directive_wording_matches_the_cascade():
    assert "Ask question 7 plainly" in door_directive_text(FULL, 0)
    assert '"eight" or "six"' in door_directive_text(FULL, 1)
    d3 = door_directive_text(FULL, 2)
    assert "four legs each side" in d3 and "Do NOT say the answer" in d3
    assert "all three tries" in door_directive_text(FULL, 3)
    assert door_directive_text(BARE, 0) == ""
    assert "missed question 8 once" in door_directive_text(BARE, 1)
    assert "result=revealed" in door_directive_text(BARE, 2)


def test_ladder_exhausted():
    assert not ladder_exhausted(FULL, 2) and ladder_exhausted(FULL, 3)
    assert not ladder_exhausted(BARE, 1) and ladder_exhausted(BARE, 2)
