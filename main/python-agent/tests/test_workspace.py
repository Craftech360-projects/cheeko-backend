from pathlib import Path

from agent.metadata import SessionMeta
from agent.workspace import Persona, build_system_prompt, hydrate_workspace, persona_from_manager, remove_workspace

META = SessionMeta(device_mac="68:EE:8F:60:BA:AC", character="Quizzy", character_id="c-1", child_name="Aarav", child_age=7,
                   child_gender="", child_interests="space", parent_rule="No scary stories", language="Hindi",
                   voice="marin", accent="default", sample_rate=16000)


def test_persona_from_manager_falls_back_to_defaults():
    p = persona_from_manager({"systemPrompt": " You are Quizzy. ", "soul": "Curious", "greetingPrompt": "Hi {{QUIZ_QUESTIONS}}", "language": "hi"}, META)
    assert p == Persona(system_prompt="You are Quizzy.", soul="Curious", greeting="Hi {{QUIZ_QUESTIONS}}", language="hi")
    q = persona_from_manager(None, META)
    assert "Quizzy" in q.system_prompt and q.soul == "" and q.greeting == "" and q.language == "Hindi"


def test_hydrate_writes_the_three_files_and_state(tmp_path: Path):
    p = Persona(system_prompt="You are Quizzy.", soul="Curious and kind.", greeting="", language="hi")
    ws = hydrate_workspace(tmp_path, "room-1", p, META, [{"state_type": "daily_quiz", "memo": "MEMO: type=daily_quiz | date=2026-09-12"}])
    agent_md = (ws / "AGENT.md").read_text(encoding="utf-8")
    assert "You are Quizzy." in agent_md and "<!-- PERSONA -->" not in agent_md
    assert "Respond in the session language: Hindi." in agent_md
    assert (ws / "SOUL.md").read_text(encoding="utf-8").strip() == "Curious and kind."
    user_md = (ws / "USER.md").read_text(encoding="utf-8")
    for line in ("- Name: Aarav", "- Age: 7 years old", "- Interests: space", "- Primary language: Hindi", "- Timezone: Asia/Kolkata", "- Parent rule: No scary stories"):
        assert line in user_md
    assert (ws / "memory" / "state" / "daily_quiz.md").read_text(encoding="utf-8").startswith("MEMO: type=daily_quiz")
    assert (ws / "memory" / "MEMORY.md").exists()


def test_full_agent_md_from_manager_is_used_verbatim(tmp_path: Path):
    full = "# Quizzy AGENT.md\n\nSpeak <!-- LANGUAGE --> only.\n\n## Rules\nmanager-owned rules"
    ws = hydrate_workspace(tmp_path, "room-3", Persona(full, "", "", "hi"), META, [])
    agent_md = (ws / "AGENT.md").read_text(encoding="utf-8")
    assert agent_md.startswith("# Quizzy AGENT.md\n\nSpeak Hindi only.")
    assert "Voice Output Rules" not in agent_md  # the local scaffold is not merged in


def test_parent_rule_is_appended_subordinate_and_sanitized(tmp_path: Path):
    meta = META.__class__(**{**META.__dict__, "parent_rule": "No `scary`\nstories"})
    agent_md = (hydrate_workspace(tmp_path, "room-4", Persona("You are Quizzy.", "", "", "hi"), meta, []) / "AGENT.md").read_text(encoding="utf-8")
    assert agent_md.index("## Parent Preferences (subordinate)") < agent_md.index("No scary stories") < agent_md.index("## Rule Precedence (absolute)")
    no_rule = META.__class__(**{**META.__dict__, "parent_rule": ""})
    assert "Parent Preferences" not in (hydrate_workspace(tmp_path, "room-5", Persona("x", "", "", "hi"), no_rule, []) / "AGENT.md").read_text(encoding="utf-8")


def test_system_prompt_is_built_from_the_files(tmp_path: Path):
    ws = hydrate_workspace(tmp_path, "room-2", Persona("You are Cheeko.", "Playful.", "", "en"), META, [])
    (ws / "SOUL.md").write_text("Edited on disk.", encoding="utf-8")  # proves the prompt comes from files, not memory
    prompt = build_system_prompt(ws)
    assert prompt.index("# Cheeko") < prompt.index("## AGENT.md") < prompt.index("## SOUL.md") < prompt.index("## USER.md")
    assert "Edited on disk." in prompt and "\n\n---\n\n" in prompt
    remove_workspace(ws)
    assert not ws.exists()
