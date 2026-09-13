from agent.metadata import SessionMeta, choose_voice, parse_dispatch_metadata, parse_room_name


def test_room_name_yields_mac_and_type():
    assert parse_room_name("969bf3c6-8d58-4fe5-9f5b-0b964d27e295_68EE8F60BAAC_conversation") == ("68:EE:8F:60:BA:AC", "conversation")
    assert parse_room_name("gptlive-test-3") == (None, None)


def test_dispatch_metadata_fields_and_defaults():
    raw = '{"character":"Quizzy","character_id":"c-1","child_profile":{"name":"Aarav","age":7,"interests":"space"},' \
          '"session_language_name":"Hindi","gptlive":{"voice":"vesper","accent":"indian","rate":24000}}'
    m = parse_dispatch_metadata(raw, "u_68EE8F60BAAC_conversation")
    assert m == SessionMeta(device_mac="68:EE:8F:60:BA:AC", character="Quizzy", character_id="c-1",
                            child_name="Aarav", child_age=7, child_gender="", child_interests="space", parent_rule="",
                            language="Hindi", voice="vesper", accent="indian", sample_rate=24000)


def test_dispatch_metadata_tolerates_garbage():
    m = parse_dispatch_metadata("not json", "u_68EE8F60BAAC_conversation")
    assert m.character == "Cheeko" and m.voice == "" and m.accent == "default" and m.sample_rate == 16000
    assert parse_dispatch_metadata('{"gptlive":{"voice":"aster"}}', "x").voice == ""  # refused voice never chosen


def test_choose_voice_prefers_session_then_character_then_provider():
    assert choose_voice("vesper", "cinder", "stone") == "vesper"  # dashboard GPT-Live tab, this session only
    assert choose_voice("", "cinder", "stone") == "cinder"  # ai_agent_template.gptlive_voice
    assert choose_voice("", "", "Stone") == "stone"  # active realtime provider default
    assert choose_voice("", "aster", "nonsense") == "marin"
