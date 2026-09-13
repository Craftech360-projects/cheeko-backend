from agent.persona import strip_expression_tags

# Real lines from the dev box characters (2026-09-13) and the picoclaw scaffold.


def test_rule_bullets_are_dropped_whole():
    text = ("## Voice\n"
            "- Start every spoken sentence with an expression tag - yours are [gentle], [sleepy], [soft], [warm]. Never [excited] after the first minute.\n"
            "- The hidden MEMO line is metadata and does not need an expression tag.\n"
            "- The ONE exception is the square-bracket expression tag (for example `[happy]`) that starts each sentence: it is stripped before speech and drives the face. Never use square brackets for anything else.\n"
            "- Keep it short.")
    assert strip_expression_tags(text) == "## Voice\n- Keep it short."


def test_rule_sentences_inside_paragraphs_are_dropped_and_the_rest_kept():
    greeting = ("Ask exactly one word, then stop and wait for the spelling. Begin every spoken sentence with an expression tag such as "
                "[excited] or [happy]. Keep the greeting under 40 spoken words. Roman letters only.")
    assert strip_expression_tags(greeting) == ("Ask exactly one word, then stop and wait for the spelling. Keep the greeting under 40 spoken words. "
                                               "Roman letters only.")
    assert strip_expression_tags("Use one to three details naturally. Begin every spoken sentence with an expression tag. Roman letters only.") == \
        "Use one to three details naturally. Roman letters only."


def test_inline_tags_in_examples_are_removed_but_placeholders_stay():
    assert strip_expression_tags('1. SETUP with drama: "[silly] Okay okay okay - why did the banana go to the doctor?!"') == \
        '1. SETUP with drama: "Okay okay okay - why did the banana go to the doctor?!"'
    assert strip_expression_tags('"[sleepy] Mmm... hello [name]." BOUNCE BACK: "what do YOU think [tiny follow-up]?"') == \
        '"Mmm... hello [name]." BOUNCE BACK: "what do YOU think [tiny follow-up]?"'


def test_text_without_tags_is_unchanged():
    text = "You are Quizzy Bee.\n\n- Ask one question at a time.\n"
    assert strip_expression_tags(text) == text
