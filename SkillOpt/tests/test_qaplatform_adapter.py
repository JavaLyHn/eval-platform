import json
import os

from skillopt.envs.qaplatform.adapter import QAPlatformEnv

CASE = {"id": "t1", "caseType": "standard",
        "prompt": "こんにちは", "expected": {"language": "ja"},
        "groundTruthChecks": ["no-leak"],
        "mock": {"responded": True, "intercepted": False, "answerText": "ご案内します", "toolEvents": []}}

# A deliberately FAILING standard case: user writes ja, answer is en → lang-match fails → hard=0.
FAIL_CASE = {"id": "t2", "caseType": "standard",
             "prompt": "こんにちは", "expected": {"language": "ja"},
             "groundTruthChecks": ["no-leak"],
             "mock": {"responded": True, "intercepted": False, "answerText": "Hello there", "toolEvents": []}}


def test_mock_rollout_shapes():
    env = QAPlatformEnv(split_dir="", mock=True)
    out = env.rollout([CASE], skill_content="# skill", out_dir="/tmp/qaplatform_m0")
    assert len(out) == 1
    r = out[0]
    assert r["id"] == "t1"
    assert r["hard"] in (0, 1)
    assert 0.0 <= r["soft"] <= 1.0
    # reflect 需要的丰富 extras 必须在(§10b:answer + failReason + 诊断)
    assert "predicted_answer" in r and "fail_reason" in r and "diagnostics" in r


def test_rollout_writes_results_json(tmp_path):
    # qa-platform 报告的 _cases_view 读 {test_eval,test_eval_baseline}/results.json 还原逐题留出对比。
    # rollout 必须把逐题结果落成 results.json,否则 frame.cases=None → 报告「未评测留出集」。
    env = QAPlatformEnv(split_dir="", mock=True)
    out_dir = str(tmp_path / "test_eval")
    env.rollout([CASE, FAIL_CASE], skill_content="# skill", out_dir=out_dir)
    rj = os.path.join(out_dir, "results.json")
    assert os.path.exists(rj), "rollout 未写 results.json"
    data = json.load(open(rj, encoding="utf-8"))
    assert isinstance(data, list) and len(data) == 2
    # _cases_view 依赖的字段必须齐全
    for r in data:
        for k in ("id", "hard", "soft", "question", "case_type", "task_type", "fail_reason", "predicted_answer"):
            assert k in r, f"results.json 缺字段 {k}"


def test_mock_reflect_returns_patch():
    env = QAPlatformEnv(split_dir="", mock=True)
    results = env.rollout([CASE, FAIL_CASE], skill_content="# skill", out_dir="/tmp/qaplatform_m0")
    patches = env.reflect(results, skill_content="# skill", out_dir="/tmp/qaplatform_m0")
    assert len(patches) == len(results)
    assert any(p is not None for p in patches)
    p = next(p for p in patches if p is not None)
    assert "patch" in p and "edits" in p["patch"] and "source_type" in p
