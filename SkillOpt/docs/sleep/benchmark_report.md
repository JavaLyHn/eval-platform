# SkillOpt-Sleep — benchmark report

Auto-generated from `sweep.jsonl`. Benchmark: [gbrain-evals](https://github.com/garrytan/gbrain-evals) `skillopt-v1` (deficient skills, train/held-out split, local rule judge — no judge-API).
Held-out scores are computed by the harness, not the optimizer.

## Direct improvement (optimize, then deploy)

| Optimizer → Target | Seed | Held-out before | Held-out after | Nights | Tokens |
|---|---|---|---|---|---|
| claude:sonnet → claude:haiku | brief-writer | 0.00 | **1.00** | 2 | 6657 |
| claude:sonnet → claude:haiku | advisor | 0.00 | **1.00** | 2 | 7891 |
| claude:sonnet → claude:haiku | thorough-analyst | 0.00 | **1.00** | 2 | 17960 |
| codex:default → codex:default | brief-writer | 0.00 | **1.00** | 2 | 9969 |
| codex:default → codex:default | advisor | 0.00 | **1.00** | 2 | 6210 |
| claude:sonnet → claude:haiku | quick-answerer | 0.00 | **1.00** | 2 | 10988 |
| codex:default → codex:default | quick-answerer | 0.00 | **1.00** | 2 | 7347 |

**7/7 configurations improved on held-out.**

## Cross-model transfer (optimize on SOURCE, deploy frozen on TARGET)

The price-difference story: spend cheap tokens optimizing overnight, then deploy the frozen skill on any model with no further optimization.

| Source (optimizer) | Target (deploy) | Seed | Target baseline | Transferred | Gain |
|---|---|---|---|---|---|
| claude:haiku | claude:sonnet | brief-writer | 0.00 | **1.00** | +1.00 |
| claude:sonnet | claude:haiku | brief-writer | 0.00 | **1.00** | +1.00 |
| codex:default | claude:haiku | brief-writer | 0.00 | **1.00** | +1.00 |
| claude:haiku | codex:default | brief-writer | 0.00 | **1.00** | +1.00 |

**4/4 transfers were positive** (frozen skill helped a different model than it was optimized on).

## How to reproduce

```bash
git clone https://github.com/garrytan/gbrain-evals /tmp/gbrain-evals
python -m skillopt.sleep.experiments.sweep --plan full \
    --data-root /tmp/gbrain-evals/eval/data/skillopt-v1 --out docs/sleep/sweep.jsonl
python -m skillopt.sleep.experiments.report \
    --in docs/sleep/sweep.jsonl --out docs/sleep/benchmark_report.md
```
