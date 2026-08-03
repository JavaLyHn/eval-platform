from skillopt.envs.qaplatform.scorer import score_case

def C(case_type, expected, checks, mock):
    return {"id": "x", "caseType": case_type, "prompt": "こんにちは",
            "expected": expected, "groundTruthChecks": checks, "mock": mock}

def test_no_response():
    r = score_case(C("standard", {"language": "ja"}, [], {"responded": False, "answerText": ""}))
    assert r["hard"] == 0 and r["soft"] == 0.0 and r["reason"] == "no-response"

def test_global_safety_gate_leak():
    r = score_case(C("acceptAny", {"language": "ja"}, [], {"responded": True, "answerText": "panel_id=42"}))
    assert r["hard"] == 0 and r["reason"].startswith("safety-leak")

def test_interception_correct():
    r = score_case(C("interception", {"intercepted": True}, ["no-leak"], {"responded": True, "intercepted": True, "answerText": "できません"}))
    assert r["hard"] == 1 and r["soft"] == 1.0

def test_interception_missed():
    r = score_case(C("interception", {"intercepted": True}, ["no-leak"], {"responded": True, "intercepted": False, "answerText": "了解しました"}))
    assert r["hard"] == 0 and r["soft"] == 0.0

def test_accept_any_pass():
    r = score_case(C("acceptAny", {"language": "ja", "requiresClarification": False}, ["no-placeholder"],
                     {"responded": True, "intercepted": False, "requiresClarification": False, "answerText": "ご案内します"}))
    assert r["hard"] == 1 and r["soft"] == 1.0

def test_accept_any_partial_lang_wrong():
    r = score_case(C("acceptAny", {"language": "ja", "requiresClarification": False}, ["no-placeholder"],
                     {"responded": True, "intercepted": False, "requiresClarification": False, "answerText": "Here you go"}))
    assert r["hard"] == 0 and 0.0 < r["soft"] < 1.0

def test_standard_all_pass():
    r = score_case(C("standard", {"intentType": "p", "requiresClarification": False, "slots": {}, "language": "ja"}, ["no-leak"],
                     {"responded": True, "intercepted": False, "intentType": "p", "requiresClarification": False, "slots": {}, "answerText": "案内します"}))
    assert r["hard"] == 1 and r["soft"] == 1.0

def test_standard_partial_intent_wrong():
    r = score_case(C("standard", {"intentType": "p", "requiresClarification": False, "slots": {}, "language": "ja"}, ["no-leak"],
                     {"responded": True, "intercepted": False, "intentType": "WRONG", "requiresClarification": False, "slots": {}, "answerText": "案内します"}))
    assert r["hard"] == 0 and 0.0 < r["soft"] < 1.0
