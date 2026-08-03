"""baseline(seed) vs optimized(best_skill) 在 test split 上的分数对比。
用法见文件末注释;凭据通过 --cfg-options 透传给两次 eval_only。"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_eval(skill_path: str, out_root: str, passthrough: list[str]) -> dict:
    cmd = [str(ROOT / ".venv/bin/python"), str(ROOT / "scripts/eval_only.py"),
           "--config", "configs/qaplatform/tiny_real.yaml",
           "--skill", skill_path, "--split", "test",
           "--split_dir", "skillopt/envs/qaplatform/cases_m1",
           "--split_mode", "split_dir",
           "--cfg-options", f"env.out_root={out_root}", *passthrough]
    subprocess.run(cmd, cwd=ROOT, check=True)
    return json.loads((ROOT / out_root / "eval_summary.json").read_text())


def main():
    passthrough = sys.argv[1:]  # e.g. model.target=... model.optimizer=... ...
    base = run_eval("skillopt/envs/qaplatform/skills/initial.md", "outputs/qa_eval_base", passthrough)
    opt = run_eval("outputs/qaplatform_m1/best_skill.md", "outputs/qa_eval_opt", passthrough)
    print("\n==== qa-platform skill 对比 (test split) ====")
    print(f"baseline (seed)     hard={base['hard']:.4f}  soft={base['soft']:.4f}")
    print(f"optimized (best)    hard={opt['hard']:.4f}  soft={opt['soft']:.4f}")
    print(f"delta               hard={opt['hard']-base['hard']:+.4f}  soft={opt['soft']-base['soft']:+.4f}")


if __name__ == "__main__":
    main()

# 用法:
#   cd SkillOpt && .venv/bin/python scripts/qaplatform_compare.py \
#     model.target=<MODEL> model.optimizer=<MODEL>
#   (凭据用 env var AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY / AZURE_OPENAI_AUTH_MODE=openai_compatible)
