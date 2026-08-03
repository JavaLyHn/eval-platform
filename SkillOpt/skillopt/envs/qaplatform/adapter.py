"""qaplatform EnvAdapter:mock 模式用 case 预置答案喂真 scorer;真模式(M1)走 chat_target。"""
from __future__ import annotations

import json
import os

from skillopt.datasets.base import BatchSpec
from skillopt.envs.base import EnvAdapter
from skillopt.envs.qaplatform.loader import QAPlatformLoader
from skillopt.envs.qaplatform.scorer import score_case
from skillopt.model import chat_target
from skillopt.envs.qaplatform.target_io import build_target_messages, parse_target_output
from skillopt.envs.qaplatform.scorer import score_output


class QAPlatformEnv(EnvAdapter):
    def __init__(self, split_dir: str = "", data_path: str = "",
                 split_mode: str = "split_dir", split_ratio: str = "2:1:7",
                 split_seed: int = 42, split_output_dir: str = "",
                 workers: int = 1, analyst_workers: int = 1, failure_only: bool = False,
                 minibatch_size: int = 4, edit_budget: int = 2, seed: int = 42,
                 limit: int = 0, max_completion_tokens: int = 1024, mock: bool = False) -> None:
        self.workers = workers
        self.analyst_workers = analyst_workers
        self.failure_only = failure_only
        self.minibatch_size = minibatch_size
        self.edit_budget = edit_budget
        self.max_completion_tokens = int(max_completion_tokens)
        self.mock = bool(mock)
        self.dataloader = QAPlatformLoader(
            split_dir=split_dir, data_path=data_path, split_mode=split_mode,
            split_ratio=split_ratio, split_seed=split_seed,
            split_output_dir=split_output_dir, seed=seed, limit=limit)

    def setup(self, cfg: dict) -> None:
        super().setup(cfg)
        # The trainer passes a *flattened* cfg, where `env.mock` becomes the
        # top-level key `mock` (not a nested `env` dict). `mock` is also already
        # passed to __init__ via get_adapter; this re-read keeps them in sync and
        # tolerates a structured (nested) cfg if ever passed directly.
        c = getattr(self, "_cfg", {})
        env_section = c.get("env")
        if isinstance(env_section, dict) and "mock" in env_section:
            self.mock = bool(env_section["mock"])
        elif "mock" in c:
            self.mock = bool(c["mock"])
        self.dataloader.setup(cfg)

    def get_dataloader(self):
        return self.dataloader

    def build_env_from_batch(self, batch: BatchSpec, **kwargs):
        return list(batch.payload or [])

    def build_train_env(self, batch_size: int, seed: int, **kwargs):
        return self.build_env_from_batch(
            self.dataloader.build_train_batch(batch_size=batch_size, seed=seed, **kwargs), **kwargs)

    def build_eval_env(self, env_num: int, split: str, seed: int, **kwargs):
        return self.build_env_from_batch(
            self.dataloader.build_eval_batch(env_num=env_num, split=split, seed=seed, **kwargs), **kwargs)

    def rollout(self, env_manager, skill_content: str, out_dir: str, **kwargs) -> list[dict]:
        results = []
        total = len(env_manager)
        for i, case in enumerate(env_manager):
            if self.mock:
                graded = score_case(case)
            else:
                system, user = build_target_messages(case, skill_content)
                try:
                    text, _usage = chat_target(
                        system=system, user=user,
                        max_completion_tokens=self.max_completion_tokens)
                    out = parse_target_output(text)
                except Exception as e:  # noqa: BLE001
                    # 中转网关偶发坏响应 → 该题记「无作答」(hard=0)继续跑,不让整轮 crash
                    out = {"responded": False, "answerText": "", "intentType": None,
                           "slots": {}, "requiresClarification": False, "intercepted": False,
                           "toolEvents": [], "_error": str(e)[:200]}
                graded = score_output(case, out)
            # 落盘最小轨迹:reflect 的 analyst 按 predictions/<id>/conversation.json 读轨迹;
            # 不写这个文件 → fmt_minibatch_trajectories 取到空 → analyst 直接 return None → 0 edits。
            try:
                case_dir = os.path.join(out_dir, "predictions", str(case["id"]))
                os.makedirs(case_dir, exist_ok=True)
                conversation = [
                    {"role": "user", "content": str(case.get("prompt", ""))},
                    {"role": "assistant", "content": str(graded.get("answer", ""))},
                    {"role": "system", "content": (
                        f"[grader] hard={graded['hard']} soft={graded['soft']:.2f} "
                        f"reason={graded.get('reason', '') or '通过'}\n"
                        f"[signals] {json.dumps(graded.get('diagnostics', {}), ensure_ascii=False)}"
                    )},
                ]
                with open(os.path.join(case_dir, "conversation.json"), "w", encoding="utf-8") as f:
                    json.dump(conversation, f, ensure_ascii=False, indent=2)
            except Exception:  # noqa: BLE001
                pass
            results.append({
                "id": str(case["id"]),
                "hard": graded["hard"],
                "soft": graded["soft"],
                "predicted_answer": graded.get("answer", ""),
                "question": case.get("prompt", ""),
                "case_type": case.get("caseType", ""),
                "task_type": case.get("task_type", ""),
                "fail_reason": "" if graded["hard"] == 1 else graded["reason"],
                "diagnostics": graded.get("diagnostics", {}),
            })
            r = results[-1]
            line = f"    [case {i + 1}/{total}] id={r['id']} hard={r['hard']} soft={r['soft']:.2f}"
            if r["fail_reason"]:
                line += f" reason={r['fail_reason']}"
            print(line, flush=True)
        # 落盘整轮逐题结果:qa-platform 的 _cases_view 读 {test_eval,test_eval_baseline}/results.json
        # 还原留出集逐题对比 + 校准/抽审;不写它 → frame.cases=None → 报告显示「未评测留出集」。
        # 每个 out_dir(train/val/test/selection)都写一份,无害——只有 test_eval* 会被读。
        try:
            os.makedirs(out_dir, exist_ok=True)
            with open(os.path.join(out_dir, "results.json"), "w", encoding="utf-8") as f:
                json.dump(results, f, ensure_ascii=False, indent=2)
        except Exception:  # noqa: BLE001
            pass
        return results

    def reflect(self, results: list[dict], skill_content: str, out_dir: str, **kwargs):
        if self.mock:
            patches = []
            for r in results:
                if r["hard"] == 0:
                    patches.append({
                        "patch": {"reasoning": "", "edits": [{
                            "op": "append",
                            "content": f"- For cases failing due to {r['fail_reason']}, address it explicitly.",
                            "target": "",
                        }]},
                        "source_type": "failure",
                    })
                else:
                    patches.append(None)
            return patches
        from skillopt.gradient.reflect import run_minibatch_reflect
        return run_minibatch_reflect(
            results=results, skill_content=skill_content,
            prediction_dir=kwargs.get("prediction_dir", os.path.join(out_dir, "predictions")),
            patches_dir=kwargs.get("patches_dir", os.path.join(out_dir, "patches")),
            workers=self.analyst_workers, failure_only=self.failure_only,
            minibatch_size=self.minibatch_size, edit_budget=self.edit_budget,
            random_seed=kwargs.get("random_seed"),
            error_system=self.get_error_minibatch_prompt(),
            success_system=self.get_success_minibatch_prompt(),
            step_buffer_context=kwargs.get("step_buffer_context", ""),
            update_mode=getattr(self, "_cfg", {}).get("skill_update_mode", "patch"))

    def get_task_types(self) -> list[str]:
        seen = []
        for it in (self.dataloader.train_items + self.dataloader.val_items + self.dataloader.test_items):
            tt = str(it.get("task_type") or "qaplatform")
            if tt not in seen:
                seen.append(tt)
        return seen or ["qaplatform"]
