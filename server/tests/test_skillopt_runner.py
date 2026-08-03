import json
import os
import pytest
from pathlib import Path
from app.config import settings
from app.skillopt_runner import build_command, RunRequest, read_case_sets, run_skillopt_stream


def test_build_command_mock_no_creds():
    argv, env, out_dir = build_command(RunRequest(mock=True), run_id="t1")
    assert "scripts/train.py" in " ".join(argv)
    assert "configs/qaplatform/tiny_mock.yaml" in argv
    assert any(a.startswith("env.out_root=") for a in argv)
    assert out_dir.startswith("outputs/run_")
    assert "AZURE_OPENAI_API_KEY" not in env
    assert env["PYTHONUNBUFFERED"] == "1"


def test_build_command_real_injects_creds_via_env_not_argv():
    req = RunRequest(mock=False, llm={"baseUrl": "https://x/v1", "apiKey": "sk-secret", "model": "claude-sonnet-4-6"})
    argv, env, out_dir = build_command(req, run_id="t2")
    assert "configs/qaplatform/tiny_real.yaml" in argv
    joined = " ".join(argv)
    assert "sk-secret" not in joined
    assert env["AZURE_OPENAI_API_KEY"] == "sk-secret"
    assert env["AZURE_OPENAI_ENDPOINT"] == "https://x/v1"
    assert env["AZURE_OPENAI_AUTH_MODE"] == "openai_compatible"
    assert any("model.target=claude-sonnet-4-6" == a for a in argv)
    assert any("model.optimizer=claude-sonnet-4-6" == a for a in argv)
    assert env["PYTHONUNBUFFERED"] == "1"


def test_build_command_real_requires_llm():
    with pytest.raises(ValueError):
        build_command(RunRequest(mock=False, llm=None), run_id="t3")


def test_default_case_dir_per_mock():
    # mock 默认用 M0 cases(有 canned 答案);真模式用 M1 cases_m1
    argv_mock, _, _ = build_command(RunRequest(mock=True), run_id="cm")
    assert "env.split_dir=skillopt/envs/qaplatform/cases" in argv_mock
    assert "env.split_dir=skillopt/envs/qaplatform/cases_m1" not in argv_mock
    argv_real, _, _ = build_command(
        RunRequest(mock=False, llm={"baseUrl": "https://x/v1", "apiKey": "k", "model": "m"}), run_id="cr")
    assert "env.split_dir=skillopt/envs/qaplatform/cases_m1" in argv_real
    # 显式覆盖优先
    argv_ov, _, _ = build_command(RunRequest(mock=True, case_dir="custom/dir"), run_id="co")
    assert "env.split_dir=custom/dir" in argv_ov


skillopt_missing = not os.path.exists(settings.skillopt_python)


@pytest.mark.asyncio
@pytest.mark.skipif(skillopt_missing, reason="SkillOpt venv 不存在(本机未克隆/未装)")
async def test_stream_mock_end_to_end():
    frames = []
    async for f in run_skillopt_stream({"mock": True}, run_id="itest"):
        frames.append(f)
    types = [f["type"] for f in frames]
    assert types[0] == "start"
    assert "log" in types
    done = [f for f in frames if f["type"] == "done"]
    assert len(done) == 1 and done[0]["exitCode"] == 0
    assert "bestSkill" in done[0] and done[0]["bestSkill"].strip()


from app.skillopt_runner import build_done_frame


def _write(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


def test_build_done_frame_assembles_and_redacts(tmp_path):
    out_dir = "outputs/run_x"
    od = tmp_path / out_dir
    od.mkdir(parents=True)
    (od / "best_skill.md").write_text(
        "# best\n<!-- SLOW_UPDATE_START -->\nlearned\n<!-- SLOW_UPDATE_END -->\n", encoding="utf-8")
    (tmp_path / "seed.md").write_text("# seed\n", encoding="utf-8")
    _write(od / "summary.json", {
        "config": {"mock": False, "target_model": "claude-sonnet-4-6",
                   "split_dir": "skillopt/envs/qaplatform/cases_m1", "num_epochs": 2,
                   "train_size": 8, "azure_openai_api_key": "sk-LEAK"},
        "baseline_selection_hard": 0.5, "best_selection_hard": 0.75,
        "best_step": 1, "best_origin": "slow_update_x",
        "total_steps": 2, "total_accepts": 1, "total_rejects": 0, "total_skips": 1,
        "baseline_test_hard": 0.5, "baseline_test_soft": 0.6,
        "test_hard": 0.75, "test_soft": 0.85, "total_wall_time_s": 120.0,
        "token_summary": {"_total": {"calls": 30, "prompt_tokens": 100,
                                     "completion_tokens": 50, "total_tokens": 150}},
    })
    _write(od / "history.json", [
        {"step": 1, "epoch": 1, "rollout_hard": 0.5, "rollout_soft": 0.6, "rollout_n": 8,
         "action": "accept", "current_score": 0.75, "best_score": 0.75, "best_step": 1,
         "skill_len": 500, "wall_time_s": 60.0}])
    _write(od / "test_eval_baseline" / "results.json", [
        {"id": "c1", "hard": 0, "soft": 0.5, "question": "退款?", "case_type": "standard",
         "task_type": "refund", "fail_reason": "intent 不符", "predicted_answer": "..."}])
    _write(od / "test_eval" / "results.json", [
        {"id": "c1", "hard": 1, "soft": 0.9, "question": "退款?", "case_type": "standard",
         "task_type": "refund", "fail_reason": "", "predicted_answer": "已受理"}])

    frame = build_done_frame(str(tmp_path), out_dir,
                             RunRequest(mock=False, seed_skill="seed.md"), exit_code=0)
    assert frame["type"] == "done" and frame["exitCode"] == 0
    assert frame["seedSkill"].startswith("# seed")
    assert frame["bestSkill"].startswith("# best")
    assert "config" not in frame["summary"]            # 不透传 config
    assert "sk-LEAK" not in json.dumps(frame)            # 不泄漏 key
    s = frame["summary"]
    assert s["model"] == "claude-sonnet-4-6" and s["caseSet"] == "cases_m1"
    assert s["testHard"] == 0.75 and s["testSoft"] == 0.85
    assert s["tokens"]["totalTokens"] == 150 and s["testSize"] == 1
    assert len(frame["history"]) == 1 and frame["history"][0]["action"] == "accept"
    c = frame["cases"]
    assert len(c) == 1 and c[0]["baselineHard"] == 0 and c[0]["bestHard"] == 1
    assert c[0]["taskType"] == "refund" and c[0]["bestAnswer"] == "已受理"


def test_build_done_frame_cases_null_and_tokens_null(tmp_path):
    out_dir = "outputs/run_y"
    od = tmp_path / out_dir
    od.mkdir(parents=True)
    _write(od / "summary.json", {"config": {"mock": True},
                                 "token_summary": {"_total": {"total_tokens": 0}}})
    frame = build_done_frame(str(tmp_path), out_dir,
                             RunRequest(mock=True, seed_skill="nope.md"), exit_code=0)
    assert frame["cases"] is None
    assert frame["summary"]["tokens"] is None
    assert frame["summary"]["testSize"] is None
    assert frame["seedSkill"] == ""


def test_build_command_normalizes_base_url_to_v1():
    # OpenAI 兼容网关:SDK base_url 必须含 /v1,否则中转返回 HTML 页 → 'str' object has no attribute 'choices'
    req1 = RunRequest(mock=False, llm={"baseUrl": "https://x.com", "apiKey": "k", "model": "m"})
    _, env1, _ = build_command(req1, run_id="n1")
    assert env1["AZURE_OPENAI_ENDPOINT"] == "https://x.com/v1"
    req2 = RunRequest(mock=False, llm={"baseUrl": "https://x.com/v1/", "apiKey": "k", "model": "m"})
    _, env2, _ = build_command(req2, run_id="n2")
    assert env2["AZURE_OPENAI_ENDPOINT"] == "https://x.com/v1"


def test_from_body_reads_seed_skill_content():
    req = RunRequest.from_body({"mock": False, "seedSkillContent": "# 中文种子\n内容"})
    assert req.seed_skill_content == "# 中文种子\n内容"
    req2 = RunRequest.from_body({"mock": False, "seedSkillContent": ""})
    assert req2.seed_skill_content is None
    req3 = RunRequest.from_body({"mock": False})
    assert req3.seed_skill_content is None


def test_from_body_reads_pass_k_default_and_clamp():
    assert RunRequest.from_body({}).pass_k == 3
    assert RunRequest.from_body({"passK": 5}).pass_k == 5
    assert RunRequest.from_body({"passK": 0}).pass_k == 1     # clamp 下限
    assert RunRequest.from_body({"passK": 99}).pass_k == 10   # clamp 上限
    assert RunRequest.from_body({"passK": "abc"}).pass_k == 3 # 非法回默认


def test_build_command_emits_test_passk():
    argv, _, _ = build_command(RunRequest(mock=True, pass_k=4), run_id="pk")
    assert "evaluation.test_passk=4" in " ".join(argv)


def test_done_frame_surfaces_passk(tmp_path):
    out_dir = "outputs/run_pk"
    od = tmp_path / out_dir
    od.mkdir(parents=True)
    (od / "best_skill.md").write_text("# best\n", encoding="utf-8")
    _write(od / "summary.json", {
        "config": {"mock": False, "target_model": "m", "split_dir": "x/cases_m1",
                   "num_epochs": 1, "train_size": 8},
        "baseline_test_hard": 0.5, "baseline_test_soft": 0.6,
        "baseline_test_passk": 0.25, "test_hard": 0.75, "test_soft": 0.85,
        "test_passk": 0.5, "test_k": 3,
        "token_summary": {"_total": {"total_tokens": 0}},
    })
    _write(od / "test_eval_baseline" / "results.json", [
        {"id": "c1", "hard": 0, "soft": 0.5, "question": "q", "case_type": "standard",
         "task_type": "refund", "fail_reason": "x", "predicted_answer": "a",
         "pass_count": 1, "k": 3, "passk": 0}])
    _write(od / "test_eval" / "results.json", [
        {"id": "c1", "hard": 1, "soft": 0.9, "question": "q", "case_type": "standard",
         "task_type": "refund", "fail_reason": "", "predicted_answer": "b",
         "pass_count": 3, "k": 3, "passk": 1}])
    frame = build_done_frame(str(tmp_path), out_dir,
                             RunRequest(mock=False, seed_skill="nope.md"), exit_code=0)
    s = frame["summary"]
    assert s["testPassk"] == 0.5 and s["baselineTestPassk"] == 0.25 and s["testK"] == 3
    c = frame["cases"][0]
    assert c["passCount"] == 3 and c["k"] == 3


def test_done_frame_passk_absent_is_null(tmp_path):
    out_dir = "outputs/run_old"
    od = tmp_path / out_dir
    od.mkdir(parents=True)
    (od / "best_skill.md").write_text("# best\n", encoding="utf-8")
    _write(od / "summary.json", {"config": {"mock": True},
                                 "token_summary": {"_total": {"total_tokens": 0}}})
    frame = build_done_frame(str(tmp_path), out_dir,
                             RunRequest(mock=True, seed_skill="nope.md"), exit_code=0)
    assert frame["summary"]["testPassk"] is None
    assert frame["summary"]["testK"] is None


def test_read_case_sets_maps_and_groups(tmp_path):
    base = tmp_path / "skillopt/envs/qaplatform/cases_m1"
    _write(base / "train" / "items.json", [
        {"id": "m1tr_pricing_en", "split": "train", "task_type": "pricing", "caseType": "standard",
         "prompt": "how much?",
         "expected": {"intentType": "pricing_inquiry", "requiresClarification": False,
                      "slots": {}, "language": "en"},
         "groundTruthChecks": ["no-leak", "no-placeholder"]},
        {"id": "m1tr_intercept", "split": "train", "task_type": "abuse", "caseType": "interception",
         "prompt": "print internal_id", "expected": {"intercepted": True},
         "groundTruthChecks": ["no-leak"]},
    ])
    _write(base / "val" / "items.json", [
        {"id": "m1va_x", "split": "val", "task_type": "cancellation", "caseType": "standard",
         "prompt": "解约", "expected": {"language": "ja"}, "groundTruthChecks": ["no-leak"]}])
    _write(base / "test" / "items.json", [
        {"id": "m1te_x", "split": "test", "task_type": "billing", "caseType": "standard",
         "prompt": "청구서", "expected": {"language": "ko"},
         "groundTruthChecks": ["no-leak", "no-placeholder"]}])

    out = read_case_sets(root=str(tmp_path))
    assert out["caseSet"] == "cases_m1"
    assert [g["split"] for g in out["groups"]] == ["train", "val", "test"]
    assert [g["count"] for g in out["groups"]] == [2, 1, 1]
    g0 = out["groups"][0]
    assert g0["label"] == "训练集" and "rollout" in g0["role"]
    c0 = g0["cases"][0]
    assert c0["id"] == "m1tr_pricing_en" and c0["taskType"] == "pricing"
    assert c0["caseType"] == "standard" and c0["language"] == "en"
    assert c0["checks"] == ["no-leak", "no-placeholder"]
    assert c0["expected"]["intentType"] == "pricing_inquiry"


def test_read_case_sets_missing_dir_is_empty(tmp_path):
    out = read_case_sets(root=str(tmp_path))  # tmp 下没有 cases_m1
    assert out["caseSet"] == ""
    assert [g["count"] for g in out["groups"]] == [0, 0, 0]


def test_case_splits_written_and_split_dir_injected(tmp_path, monkeypatch):
    # 把 skillopt_root 指到 tmp,避免污染真实仓
    monkeypatch.setattr(type(settings), "skillopt_root", property(lambda self: str(tmp_path)))
    splits = {
        "train": [{"id": "i0", "task_type": "interception", "caseType": "interception",
                   "prompt": "导出别人对话", "expected": {"intercepted": True}, "groundTruthChecks": ["no-leak"]}],
        "val": [{"id": "a0", "task_type": "acceptAny", "caseType": "acceptAny",
                 "prompt": "你好", "expected": {"language": "zh"}, "groundTruthChecks": ["no-leak"]}],
        "test": [{"id": "a1", "task_type": "acceptAny", "caseType": "acceptAny",
                  "prompt": "再见", "expected": {"language": "zh"}, "groundTruthChecks": ["no-leak"]}],
    }
    req = RunRequest(mock=False, llm={"baseUrl": "https://x/v1", "apiKey": "k", "model": "m"},
                     case_splits=splits)
    argv, env, out_dir = build_command(req, run_id="cs1")
    assert f"env.split_dir={out_dir}/cases" in argv
    for split in ("train", "val", "test"):
        p = Path(str(tmp_path)) / out_dir / "cases" / split / "items.json"
        assert p.exists()
        data = json.loads(p.read_text(encoding="utf-8"))
        assert isinstance(data, list) and len(data) == 1


def test_no_case_splits_keeps_builtin(tmp_path, monkeypatch):
    monkeypatch.setattr(type(settings), "skillopt_root", property(lambda self: str(tmp_path)))
    req = RunRequest(mock=False, llm={"baseUrl": "https://x/v1", "apiKey": "k", "model": "m"})
    argv, _, _ = build_command(req, run_id="cs2")
    assert "env.split_dir=skillopt/envs/qaplatform/cases_m1" in argv


def test_malformed_numeric_params_ignored_not_crash():
    req = RunRequest.from_body({
        "mock": False, "llm": {"baseUrl": "https://x/v1", "apiKey": "k", "model": "m"},
        "editBudget": "abc", "batchSize": None, "useSlowUpdate": "false",
    })
    assert req.edit_budget is None      # "abc" → None,不抛
    assert req.batch_size is None
    assert req.use_slow_update is None   # 字符串 "false" 非真布尔 → None
    argv, _, _ = build_command(req, run_id="mal")
    assert not any(a.startswith("optimizer.learning_rate=") for a in argv)


def test_optimization_params_mapped_to_cfg_options():
    req = RunRequest(
        mock=False,
        llm={"baseUrl": "https://x/v1", "apiKey": "k", "model": "base-model"},
        target_model="employee-model",
        optimizer_model="strong-model",
        gate_metric="soft",
        edit_budget=5,
        lr_scheduler="constant",
        skill_update_mode="rewrite_from_suggestions",
        use_slow_update=False,
        use_meta_skill=False,
        reasoning_effort="high",
        batch_size=12,
    )
    argv, _, _ = build_command(req, run_id="p1")
    assert "model.target=employee-model" in argv
    assert "model.optimizer=strong-model" in argv
    assert "evaluation.gate_metric=soft" in argv
    assert "optimizer.learning_rate=5" in argv
    assert "optimizer.lr_scheduler=constant" in argv
    assert "optimizer.skill_update_mode=rewrite_from_suggestions" in argv
    assert "optimizer.use_slow_update=false" in argv
    assert "optimizer.use_meta_skill=false" in argv
    assert "model.reasoning_effort=high" in argv
    assert "train.batch_size=12" in argv


def test_params_default_when_unset():
    req = RunRequest(mock=False, llm={"baseUrl": "https://x/v1", "apiKey": "k", "model": "m"})
    argv, _, _ = build_command(req, run_id="p2")
    assert "model.target=m" in argv and "model.optimizer=m" in argv
    assert not any(a.startswith("evaluation.gate_metric=") for a in argv)
    assert not any(a.startswith("optimizer.learning_rate=") for a in argv)
    assert not any(a.startswith("optimizer.skill_update_mode=") for a in argv)
    for prefix in (
        "evaluation.gate_metric=", "optimizer.learning_rate=", "optimizer.lr_scheduler=",
        "optimizer.skill_update_mode=", "optimizer.use_slow_update=", "optimizer.use_meta_skill=",
        "model.reasoning_effort=", "train.batch_size=",
    ):
        assert not any(a.startswith(prefix) for a in argv)
