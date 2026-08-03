"""驱动 SkillOpt 子进程并把进度流式产出。命令构造(纯)与子进程 IO 分离,便于测试。"""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator

from .config import settings


# mock 用 M0 题集(带 canned 答案 → mock scorer 有作答可判);真模式用 M1 题集。
CASES_MOCK = "skillopt/envs/qaplatform/cases"
CASES_REAL = "skillopt/envs/qaplatform/cases_m1"

CASE_SETS_DIR = "skillopt/envs/qaplatform/cases_m1"
_SPLIT_META = [
    ("train", "训练集", "优化器直接练:rollout 产生轨迹 → 反思出 patch"),
    ("val",   "选择集", "gate 据此择优:每个 patch 在它上面涨了才收"),
    ("test",  "留出集", "验收,不参与优化:发版决策 / pass^k 用"),
]


@dataclass
class RunRequest:
    mock: bool = False
    llm: dict[str, Any] | None = None
    case_dir: str | None = None       # None → 按 mock 选默认题集(见 build_command)
    seed_skill: str = "skillopt/envs/qaplatform/skills/initial.md"
    epochs: int | None = None
    seed_skill_content: str | None = None
    pass_k: int = 3                    # 留出集 pass^k 的 K(每题跑 K 次)
    case_splits: dict[str, Any] | None = None   # {train,val,test} 各 list[case dict];None → 用内置题集
    target_model: str | None = None
    optimizer_model: str | None = None
    gate_metric: str | None = None
    edit_budget: int | None = None
    lr_scheduler: str | None = None
    skill_update_mode: str | None = None
    use_slow_update: bool | None = None
    use_meta_skill: bool | None = None
    reasoning_effort: str | None = None
    batch_size: int | None = None
    analyst_workers: int | None = None   # 反思阶段并发调 analyst 的线程数(gradient.analyst_workers)
    use_gate: bool | None = None         # 是否启用择优门(evaluation.use_gate);关=每步 force-accept

    @classmethod
    def from_body(cls, body: dict[str, Any]) -> "RunRequest":
        raw_k = body.get("passK")
        try:
            pass_k = int(raw_k) if raw_k is not None else 3
        except (TypeError, ValueError):
            pass_k = 3
        pass_k = max(1, min(10, pass_k))   # clamp [1,10],防误填巨值跑爆成本

        def _opt_int(key: str) -> int | None:
            v = body.get(key)
            if v is None:
                return None
            try:
                return int(v)
            except (TypeError, ValueError):
                return None

        def _opt_bool(key: str) -> bool | None:
            v = body.get(key)
            return bool(v) if isinstance(v, bool) else None

        return cls(
            mock=bool(body.get("mock", False)),
            llm=body.get("llm"),
            case_dir=(str(body["caseDir"]) if body.get("caseDir") else None),
            seed_skill=str(body.get("seedSkill") or "skillopt/envs/qaplatform/skills/initial.md"),
            epochs=body.get("epochs"),
            seed_skill_content=(str(body["seedSkillContent"]) if body.get("seedSkillContent") else None),
            pass_k=pass_k,
            case_splits=(body.get("caseSplits") if isinstance(body.get("caseSplits"), dict) else None),
            target_model=(str(body["targetModel"]) if body.get("targetModel") else None),
            optimizer_model=(str(body["optimizerModel"]) if body.get("optimizerModel") else None),
            gate_metric=(str(body["gateMetric"]) if body.get("gateMetric") else None),
            edit_budget=_opt_int("editBudget"),
            lr_scheduler=(str(body["lrScheduler"]) if body.get("lrScheduler") else None),
            skill_update_mode=(str(body["skillUpdateMode"]) if body.get("skillUpdateMode") else None),
            use_slow_update=_opt_bool("useSlowUpdate"),
            use_meta_skill=_opt_bool("useMetaSkill"),
            reasoning_effort=(str(body["reasoningEffort"]) if body.get("reasoningEffort") else None),
            batch_size=_opt_int("batchSize"),
            analyst_workers=_opt_int("analystWorkers"),
            use_gate=_opt_bool("useGate"),
        )


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def read_case_sets(root: str | None = None) -> dict:
    """读 cases_m1/{train,val,test}/items.json,按组返回(只读浏览用)。root 可注入便于测试。"""
    base = Path(root or settings.skillopt_root) / CASE_SETS_DIR
    groups = []
    for split, label, role in _SPLIT_META:
        raw = _read_json(base / split / "items.json")
        items = raw if isinstance(raw, list) else []
        cases = [{
            "id": str(c.get("id", "")),
            "prompt": str(c.get("prompt", "")),
            "caseType": str(c.get("caseType", "")),
            "taskType": str(c.get("task_type", "")),
            "language": str((c.get("expected") or {}).get("language", "") or ""),
            "expected": c.get("expected") or {},
            "checks": list(c.get("groundTruthChecks") or []),
        } for c in items if isinstance(c, dict)]
        groups.append({"split": split, "label": label, "role": role,
                       "count": len(cases), "cases": cases})
    case_set = Path(CASE_SETS_DIR).name if any(g["count"] for g in groups) else ""
    return {"caseSet": case_set, "groups": groups}


def _summary_view(raw: dict, cases: list | None) -> dict:
    cfg = raw.get("config", {}) or {}
    tok = (raw.get("token_summary", {}) or {}).get("_total", {}) or {}
    total_tokens = int(tok.get("total_tokens", 0) or 0)
    tokens = None
    if total_tokens > 0:
        tokens = {
            "calls": int(tok.get("calls", 0) or 0),
            "promptTokens": int(tok.get("prompt_tokens", 0) or 0),
            "completionTokens": int(tok.get("completion_tokens", 0) or 0),
            "totalTokens": total_tokens,
        }
    split_dir = str(cfg.get("split_dir", "") or "")
    return {
        "mock": bool(cfg.get("mock", False)),
        "model": str(cfg.get("target_model", "") or ""),
        "caseSet": Path(split_dir).name if split_dir else "",
        "epochs": int(cfg.get("num_epochs", 0) or 0),
        "trainSize": int(cfg.get("train_size", 0) or 0),
        "testSize": (len(cases) if cases is not None else None),
        "baselineSelectionHard": float(raw.get("baseline_selection_hard", 0.0) or 0.0),
        "bestSelectionHard": float(raw.get("best_selection_hard", 0.0) or 0.0),
        "bestStep": int(raw.get("best_step", 0) or 0),
        "bestOrigin": str(raw.get("best_origin", "") or ""),
        "totalSteps": int(raw.get("total_steps", 0) or 0),
        "totalAccepts": int(raw.get("total_accepts", 0) or 0),
        "totalRejects": int(raw.get("total_rejects", 0) or 0),
        "totalSkips": int(raw.get("total_skips", 0) or 0),
        "baselineTestHard": raw.get("baseline_test_hard"),
        "baselineTestSoft": raw.get("baseline_test_soft"),
        "baselineTestPassk": raw.get("baseline_test_passk"),
        "testHard": raw.get("test_hard"),
        "testSoft": raw.get("test_soft"),
        "testPassk": raw.get("test_passk"),
        "testK": raw.get("test_k"),
        "wallTimeS": float(raw.get("total_wall_time_s", 0.0) or 0.0),
        "tokens": tokens,
    }


def _history_view(raw: list) -> list:
    out = []
    for h in raw or []:
        out.append({
            "step": int(h.get("step", 0) or 0),
            "epoch": int(h.get("epoch", 0) or 0),
            "rolloutHard": float(h.get("rollout_hard", 0.0) or 0.0),
            "rolloutSoft": float(h.get("rollout_soft", 0.0) or 0.0),
            "rolloutN": int(h.get("rollout_n", 0) or 0),
            "action": str(h.get("action", "") or ""),
            "currentScore": float(h.get("current_score", 0.0) or 0.0),
            "bestScore": float(h.get("best_score", 0.0) or 0.0),
            "bestStep": int(h.get("best_step", 0) or 0),
            "skillLen": int(h.get("skill_len", 0) or 0),
            "wallTimeS": float(h.get("wall_time_s", 0.0) or 0.0),
        })
    return out


def _cases_view(out_path: Path) -> list | None:
    base = _read_json(out_path / "test_eval_baseline" / "results.json")
    best = _read_json(out_path / "test_eval" / "results.json")
    if not isinstance(base, list) or not isinstance(best, list):
        return None
    by_id = {str(r.get("id")): r for r in base}
    cases = []
    for r in best:
        cid = str(r.get("id"))
        b = by_id.get(cid, {})
        src = r if r.get("question") is not None else b
        cases.append({
            "id": cid,
            "prompt": str(src.get("question", "") or ""),
            "caseType": str(src.get("case_type", "") or ""),
            "taskType": str(src.get("task_type", "") or ""),
            "baselineHard": int(b.get("hard", 0) or 0),
            "baselineSoft": float(b.get("soft", 0.0) or 0.0),
            "bestHard": int(r.get("hard", 0) or 0),
            "bestSoft": float(r.get("soft", 0.0) or 0.0),
            "baselineFailReason": str(b.get("fail_reason", "") or ""),
            "bestFailReason": str(r.get("fail_reason", "") or ""),
            "bestAnswer": str(r.get("predicted_answer", "") or ""),
            "passCount": (r.get("pass_count") if r.get("pass_count") is not None else None),
            "k": (r.get("k") if r.get("k") is not None else None),
        })
    return cases


def build_done_frame(root: str, out_dir: str, req: RunRequest, exit_code: int) -> dict:
    """子进程结束后,读产物组装脱敏的富 done 帧(纯函数,便于测试)。"""
    out_path = Path(root) / out_dir
    best_skill = ""
    bs = out_path / "best_skill.md"
    if bs.exists():
        best_skill = bs.read_text(encoding="utf-8")
    seed_skill = ""
    seed_path = Path(root) / req.seed_skill
    if seed_path.exists():
        seed_skill = seed_path.read_text(encoding="utf-8")
    cases = _cases_view(out_path)
    raw_summary = _read_json(out_path / "summary.json")
    raw_history = _read_json(out_path / "history.json")
    return {
        "type": "done",
        "exitCode": exit_code,
        "bestSkill": best_skill,
        "seedSkill": seed_skill,
        "summary": _summary_view(raw_summary if isinstance(raw_summary, dict) else {}, cases),
        "history": _history_view(raw_history if isinstance(raw_history, list) else []),
        "cases": cases,
    }


def build_command(req: RunRequest, run_id: str) -> tuple[list[str], dict[str, str], str]:
    """返回 (argv, env, out_dir)。凭据只进 env,不进 argv。"""
    out_dir = f"outputs/run_{run_id}"
    config = "configs/qaplatform/tiny_mock.yaml" if req.mock else "configs/qaplatform/tiny_real.yaml"
    case_dir = req.case_dir or (CASES_MOCK if req.mock else CASES_REAL)
    cfg_opts = [
        f"env.out_root={out_dir}",
        f"env.split_dir={case_dir}",
        f"env.skill_init={req.seed_skill}",
    ]
    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"  # 子进程 print 即刻经管道流出,SSE 才是真实时

    if not req.mock:
        if not req.llm or not all(req.llm.get(k) for k in ("baseUrl", "apiKey", "model")):
            raise ValueError("real run requires llm.baseUrl / apiKey / model")
        model = str(req.llm["model"])
        target = req.target_model or model
        optimizer = req.optimizer_model or model
        cfg_opts += [f"model.target={target}", f"model.optimizer={optimizer}"]
        # OpenAI 兼容网关:SDK base_url 必须含 /v1;无则补(否则中转返回 HTML 页 → 'str' object has no attribute 'choices')
        base_url = str(req.llm["baseUrl"]).rstrip("/")
        if not base_url.endswith("/v1"):
            base_url += "/v1"
        env["AZURE_OPENAI_ENDPOINT"] = base_url
        env["AZURE_OPENAI_API_KEY"] = str(req.llm["apiKey"])
        env["AZURE_OPENAI_AUTH_MODE"] = "openai_compatible"

    if req.epochs is not None:
        cfg_opts.append(f"train.num_epochs={int(req.epochs)}")
    cfg_opts.append(f"evaluation.test_passk={int(req.pass_k)}")

    # 可选优化参数 → cfg-options(空则用 yaml 默认,向后兼容)
    def _bool(v: bool) -> str:
        return "true" if v else "false"
    if req.gate_metric:
        cfg_opts.append(f"evaluation.gate_metric={req.gate_metric}")
    if req.edit_budget is not None:
        cfg_opts.append(f"optimizer.learning_rate={int(req.edit_budget)}")
    if req.lr_scheduler:
        cfg_opts.append(f"optimizer.lr_scheduler={req.lr_scheduler}")
    if req.skill_update_mode:
        cfg_opts.append(f"optimizer.skill_update_mode={req.skill_update_mode}")
    if req.use_slow_update is not None:
        cfg_opts.append(f"optimizer.use_slow_update={_bool(req.use_slow_update)}")
    if req.use_meta_skill is not None:
        cfg_opts.append(f"optimizer.use_meta_skill={_bool(req.use_meta_skill)}")
    if req.reasoning_effort:
        cfg_opts.append(f"model.reasoning_effort={req.reasoning_effort}")
    if req.batch_size is not None:
        cfg_opts.append(f"train.batch_size={int(req.batch_size)}")
    if req.analyst_workers is not None:
        cfg_opts.append(f"gradient.analyst_workers={int(req.analyst_workers)}")
    if req.use_gate is not None:
        cfg_opts.append(f"evaluation.use_gate={_bool(req.use_gate)}")

    # 员工题集:把前端切好的 {train,val,test} 写成 items.json,覆盖默认 split_dir。
    if req.case_splits:
        cases_root = Path(settings.skillopt_root) / out_dir / "cases"
        for split in ("train", "val", "test"):
            items = req.case_splits.get(split)
            if not isinstance(items, list):
                items = []
            d = cases_root / split
            d.mkdir(parents=True, exist_ok=True)
            (d / "items.json").write_text(
                json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        cfg_opts = [o for o in cfg_opts if not o.startswith("env.split_dir=")]
        cfg_opts.append(f"env.split_dir={out_dir}/cases")

    argv = [settings.skillopt_python, "scripts/train.py", "--config", config, "--cfg-options", *cfg_opts]
    return argv, env, out_dir


async def run_skillopt_stream(body: dict[str, Any], run_id: str | None = None) -> AsyncIterator[dict[str, Any]]:
    """起 SkillOpt 子进程,逐行流式产出帧;结束读 best_skill.md + summary。"""
    rid = run_id or uuid.uuid4().hex[:8]
    req = RunRequest.from_body(body)
    root = settings.skillopt_root

    # 用户从 Platform 技能生成的中文种子:写临时文件当 skill_init(否则用默认 initial.md)
    if req.seed_skill_content:
        try:
            seed_rel = f"outputs/run_{rid}/seed_skill.md"
            seed_abs = Path(root) / seed_rel
            seed_abs.parent.mkdir(parents=True, exist_ok=True)
            seed_abs.write_text(req.seed_skill_content, encoding="utf-8")
            req.seed_skill = seed_rel
        except Exception:  # noqa: BLE001 — 写失败则回退默认种子,不阻断
            pass

    if not os.path.exists(settings.skillopt_python):
        yield {"type": "error", "message": f"SkillOpt 未就位:找不到 {settings.skillopt_python}"}
        return
    try:
        argv, env, out_dir = build_command(req, run_id=rid)
    except ValueError as e:
        yield {"type": "error", "message": str(e)}
        return

    yield {"type": "start", "outDir": out_dir, "mock": req.mock}

    proc = await asyncio.create_subprocess_exec(
        *argv, cwd=root, env=env,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    try:
        assert proc.stdout is not None
        async for raw in proc.stdout:
            line = raw.decode("utf-8", "replace").rstrip("\n")
            if line:
                yield {"type": "log", "line": line}
        await proc.wait()
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()

    exit_code = proc.returncode
    if exit_code == 0:
        yield build_done_frame(root, out_dir, req, exit_code)
    else:
        best_skill = ""
        bs = Path(root) / out_dir / "best_skill.md"
        if bs.exists():
            best_skill = bs.read_text(encoding="utf-8")
        yield {"type": "error", "message": f"SkillOpt 退出码 {exit_code}",
               "exitCode": exit_code, "bestSkill": best_skill}
