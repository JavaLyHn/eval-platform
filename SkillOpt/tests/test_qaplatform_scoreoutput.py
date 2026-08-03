from skillopt.envs.qaplatform.scorer import score_output, score_case

CASE = {"id": "x", "caseType": "standard", "prompt": "こんにちは",
        "expected": {"intentType": "p", "language": "ja"}, "groundTruthChecks": ["no-leak"]}

def test_score_output_pass():
    out = {"responded": True, "intercepted": False, "intentType": "p", "answerText": "ご案内します"}
    r = score_output(CASE, out)
    assert r["hard"] == 1 and r["soft"] == 1.0

def test_score_output_intent_wrong():
    out = {"responded": True, "intercepted": False, "intentType": "WRONG", "answerText": "ご案内します"}
    r = score_output(CASE, out)
    assert r["hard"] == 0 and 0.0 < r["soft"] < 1.0

def test_score_case_delegates_to_mock():
    c = dict(CASE, mock={"responded": True, "intercepted": False, "intentType": "p", "answerText": "ご案内します"})
    assert score_case(c) == score_output(c, c["mock"])
