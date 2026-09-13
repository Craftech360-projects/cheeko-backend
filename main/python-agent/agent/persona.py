"""What the two models are told, composed once because GPT-Live cannot change it later."""
from __future__ import annotations

import re

# Manager prompts are written for picoclaw, where a leading [tag] drives the firmware face and is stripped
# before TTS. GPT-Live speaks what it produces, so the rules and the tagged examples are removed here.
# ponytail: tag vocabulary is the set the dev-box prompts use; add a word here if a new character brings one
_TAG_WORDS = ("neutral|happy|excited|laughing|love|silly|curious|surprised|confused|shy|sad|crying|angry|scared|sleepy|"
              "encouraging|thinking|warm|gentle|soft|amused|thoughtful|proud|calm|playful")
_TAG_TOKEN = re.compile(rf"\[(?:{_TAG_WORDS})\]\s*")
_RULE_BULLET = re.compile(r"^[ \t]*[-*][ \t][^\n]*expression tag[^\n]*(?:\n|$)", re.MULTILINE | re.IGNORECASE)
_RULE_SENTENCE = re.compile(r"[^.\s][^.\n]*expression tag[^\n]*?\.(?:[ \t]+|(?=\n)|$)", re.IGNORECASE)
_TRAILING_SPACE = re.compile(r"[ \t]+$", re.MULTILINE)


def strip_expression_tags(text: str) -> str:
    out = _RULE_SENTENCE.sub("", _RULE_BULLET.sub("", text or ""))
    return _TRAILING_SPACE.sub("", _TAG_TOKEN.sub("", out))

ACCENT_INDIAN = """<accent>
Speak Indian English: an Indian accent with Indian intonation and rhythm, and the everyday
phrasing a child in India hears at home and at school. Keep it natural and warm, never a caricature.
</accent>"""


def delegation_block(language: str, has_quiz: bool) -> str:
    language = (language or "English").strip() or "English"
    lines = [
        "<delegation>",
        "You cannot look things up or keep score yourself. Delegate any question about the current time,",
        "date or weather, any factual question you are not sure about, and anything worth remembering",
        "about the child. If the child asks what you talked about before, or about something from an earlier",
        "session that you cannot see in memory/MEMORY.md above, delegate: the helper has the full memory.",
        "While you wait, say one short cheerful line, then read out the result when it arrives.",
        "Answer greetings, small talk, jokes and simple questions yourself.",
    ]
    if has_quiz:
        lines += [
            "Every time the child answers a quiz question, delegate so the answer gets scored, and then do exactly",
            "what the result tells you to do next: ask plainly, offer the two choices, explain then re-ask, or reveal",
            "and move on. Never decide on your own whether an answer was right.",
        ]
    lines += [f"Speak {language} with the child unless they clearly switch language.", "</delegation>"]
    return "\n".join(lines)


def speech_block(today: str) -> str:
    """Last word on output. Manager prompts are written for picoclaw, which strips MEMO lines and [tags]
    from text before TTS; GPT-Live speaks everything it produces, so those rules must be overridden here."""
    lines = [
        "<speech>",
        "Everything you produce is spoken aloud to the child. This overrides any rule above:",
        "- Never say, write or produce a MEMO line, scoreboard, status fields or any other metadata, and ignore every",
        "  instruction above about writing or updating a MEMO or Saved State. Quiz progress is recorded for you when",
        "  you delegate the child's answer.",
        "- Never say expression tags or anything in square brackets, such as [happy]. Show the feeling in your voice instead.",
        "- Never read out question ids, file names or tool names.",
    ]
    if today:
        lines.append(f"- Today is {today}.")
    lines.append("</speech>")
    return "\n".join(lines)


def voice_instructions(system_prompt_from_files: str, language: str, accent: str, bank_block: str, has_quiz: bool,
                       today: str = "") -> str:
    parts = [system_prompt_from_files, delegation_block(language, has_quiz)]
    if bank_block.strip():
        parts.append(bank_block.strip())
    if accent == "indian":
        parts.append(ACCENT_INDIAN)
    parts.append(speech_block(today))
    return "\n\n---\n\n".join(parts)


def backend_instructions(bank_block: str, memos: list[str], has_quiz: bool, memory: str = "") -> str:
    text = ("You handle the work a voice model delegates while it talks to a child aged 3 to 16. "
            "Use tools when current information is required or when the child says something worth remembering. "
            "Reply with one or two short, friendly, child-safe sentences the voice model can read out.")
    if has_quiz:
        text += (" For quiz answers, compare the child's words with the bank answer and accepted answers, then call "
                 "quiz_score_answer with result=correct or result=miss; call quiz_status if unsure which question is pending."
                 " Judge the meaning, not the exact words: a young child's synonym, a close paraphrase, or an answer a kind "
                 "teacher would accept (\"rain\" for \"water\" falling from the sky) is correct.")
    if bank_block.strip():
        text += "\n\n" + bank_block.strip()
    if memos:
        text += "\n\n## Saved state from earlier sessions\n" + "\n".join(m.strip() for m in memos if m.strip())
    if memory.strip():
        text += ("\n\n## What you remember about this child (memory/MEMORY.md, session summaries oldest first)\n"
                 "Use it to answer questions about earlier conversations; say plainly when something is not in it.\n\n" + memory.strip())
    return text


def session_start_block(rendered_greeting_prompt: str) -> str:
    """The manager greeting prompt, kept in the instructions: a generate_reply ask is capped at 500 tokens."""
    text = rendered_greeting_prompt.strip()
    return f"## Session start\nWhen the session starts, open it like this:\n\n{text}" if text else ""


def greeting_instruction(character: str, has_session_start: bool) -> str:
    head = f"Greet the child now as {character or 'Cheeko'}, in one or two short sentences."
    if has_session_start:
        return head + " Follow the Session start section of your instructions."
    return head + " Then ask what they want to do."
