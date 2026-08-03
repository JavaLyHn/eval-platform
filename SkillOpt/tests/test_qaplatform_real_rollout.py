import skillopt.envs.qaplatform.adapter as adapter_mod
from skillopt.envs.qaplatform.adapter import QAPlatformEnv

STD_CASE = {"id": "r1", "caseType": "standard", "prompt": "こんにちは",
            "expected": {"intentType": "pricing", "language": "ja"},
            "groundTruthChecks": ["no-leak"]}

def test_real_rollout_scores_parsed_llm_output(monkeypatch):
    def fake_chat_target(system, user, **kwargs):
        assert system == "# SKILL"
        assert "こんにちは" in user
        return ('{"reply":"ご案内します","intentType":"pricing","slots":{},'
                '"requiresClarification":false,"intercepted":false}'), {"total_tokens": 10}
    monkeypatch.setattr(adapter_mod, "chat_target", fake_chat_target)

    env = QAPlatformEnv(split_dir="", mock=False)
    out = env.rollout([STD_CASE], skill_content="# SKILL", out_dir="/tmp/qa_m1")
    assert len(out) == 1
    r = out[0]
    assert r["id"] == "r1"
    assert r["hard"] == 1 and r["soft"] == 1.0
    assert r["predicted_answer"] == "ご案内します"

def test_real_rollout_intent_miss_partial(monkeypatch):
    def fake_chat_target(system, user, **kwargs):
        return ('{"reply":"ご案内します","intentType":"WRONG","slots":{},'
                '"requiresClarification":false,"intercepted":false}'), {}
    monkeypatch.setattr(adapter_mod, "chat_target", fake_chat_target)
    env = QAPlatformEnv(split_dir="", mock=False)
    r = env.rollout([STD_CASE], skill_content="# SKILL", out_dir="/tmp/qa_m1")[0]
    assert r["hard"] == 0 and 0.0 < r["soft"] < 1.0
