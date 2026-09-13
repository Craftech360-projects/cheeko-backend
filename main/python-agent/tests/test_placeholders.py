from datetime import datetime

from agent.placeholders import quiz_block, render_placeholders, wants_quiz

BATCH = {"level": 1, "age_band": "6-8", "bank": "quiz", "answered_today": 2,
         "questions": [{"id": "11", "question_text": "How many legs does a spider have?", "answer_text": "eight", "accepted_answers": ["8"]},
                       {"id": "12", "question_text": "What colour is the sky?", "answer_text": "blue", "accepted_answers": []}],
         "wonder_to_ask": {"code": "W7", "question_text": "Why is the sky blue?", "second_pass": False, "previous_answer": ""}}


def test_wants_quiz_matches_the_three_placeholders():
    assert wants_quiz("x {{QUIZ_QUESTIONS}}") and wants_quiz("{{RIDDLES}}") and wants_quiz("{{MATH_PROBLEMS}}")
    assert not wants_quiz("{{JOKES}} {{TODAY_DATE}}")


def test_quiz_block_lists_questions_with_ids_and_answers():
    block = quiz_block(BATCH)
    assert "## Today's Quiz Questions (Level 1, ages 6-8)" in block
    assert "(id=11) How many legs does a spider have? — Answer: eight (also accept: 8)" in block
    assert "(id=12) What colour is the sky? — Answer: blue" in block
    assert "answered 2 already today" in block
    assert "Wonder Question (code W7): Why is the sky blue?" in block
    assert "question bank is unavailable" in quiz_block(None)


def test_render_placeholders_fills_or_strips():
    prompt = "Today is {{TODAY_DATE}} ({{TIME_BAND}}). {{QUIZ_QUESTIONS}} Jokes: {{JOKES}} end"
    out = render_placeholders(prompt, BATCH, datetime(2026, 9, 13, 9, 30))
    assert "Sunday, 13 September 2026" in out and "(morning)" in out and "(id=11)" in out
    assert "{{" not in out
