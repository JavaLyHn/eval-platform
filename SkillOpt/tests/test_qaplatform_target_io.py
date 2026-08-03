from skillopt.envs.qaplatform.target_io import (
    build_target_messages, parse_target_output, STANDARD_INTENT_LABELS,
)

def test_build_messages_uses_skill_as_system():
    case = {"prompt": "こんにちは", "caseType": "standard"}
    system, user = build_target_messages(case, "# MY SKILL")
    assert system == "# MY SKILL"
    assert "こんにちは" in user
    assert "JSON" in user

def test_standard_injects_intent_label_set():
    """standard 题把固定意图闭集注入 agent 指令 → 黑盒 agent 从同一标签空间分类。"""
    case = {"prompt": "你们多少钱?", "caseType": "standard"}
    _system, user = build_target_messages(case, "# SKILL")
    for label in STANDARD_INTENT_LABELS:
        assert label in user
    assert "EXACTLY one" in user

def test_non_standard_does_not_inject_labels():
    case = {"prompt": "写条推广", "caseType": "acceptAny"}
    _system, user = build_target_messages(case, "# SKILL")
    assert "pricing_inquiry" not in user

def test_parse_valid_json():
    text = '{"reply": "ご案内します", "intentType": "pricing", "slots": {}, "requiresClarification": false, "intercepted": false}'
    out = parse_target_output(text)
    assert out["responded"] is True
    assert out["answerText"] == "ご案内します"
    assert out["intentType"] == "pricing"
    assert out["requiresClarification"] is False
    assert out["intercepted"] is False

def test_parse_json_embedded_in_prose():
    text = 'Sure!\n{"reply": "hi", "intentType": "greet", "slots": {}, "requiresClarification": false, "intercepted": false}\nthanks'
    out = parse_target_output(text)
    assert out["intentType"] == "greet" and out["answerText"] == "hi"

def test_parse_unparseable_falls_back_to_raw():
    text = "just a plain reply, no json"
    out = parse_target_output(text)
    assert out["responded"] is True
    assert out["answerText"] == "just a plain reply, no json"
    assert out["intentType"] is None

def test_parse_empty_is_no_response():
    out = parse_target_output("")
    assert out["responded"] is False
