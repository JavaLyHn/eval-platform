# SkillOpt-Sleep — validation experiment results

Generated: 2026-06-07 (autonomous offline session)
Backend: mock (deterministic, no API). Reproducible via the commands below.

```
$ python3.12 -m skillopt.sleep.experiments.run_experiment --persona researcher --nights 4 --json
{
  "persona": "researcher",
  "backend": "mock",
  "nights_run": 1,
  "baseline_holdout": 0.3333,
  "after_holdout": 1.0,
  "lift": 0.6667,
  "improved": true,
  "gate_blocks_harmful": true,
  "final_skill_excerpt": "T -->\n## Learned preferences & procedures\n\n_This block is maintained by SkillOpt-Sleep. Edits here are proposed offline, validated against your past tasks, and adopted only after you approve them. Hand-edits outside this block are never touched._\n\n- Always wrap the final answer in <answer>...</answer> tags.\n- Report arXiv ids in the exact form arXiv:XXXX.XXXXX.\n<!-- SKILLOPT-SLEEP:LEARNED END -->\n",
  "trace": [
    {
      "night": 0,
      "holdout_score": 0.3333,
      "action": "baseline",
      "n_edits": 0
    },
    {
      "night": 1,
      "holdout_score": 1.0,
      "action": "accept_new_best",
      "accepted": true,
      "n_edits": 2,
      "edits": [
        "Always wrap the final answer in <answer>...</answer> tags.",
        "Report arXiv ids in the exact form arXiv:XXXX.XXXXX."
      ],
      "n_rejected": 0
    }
  ]
}
```

```
$ python3.12 -m skillopt.sleep.experiments.run_experiment --persona programmer --nights 4 --json
{
  "persona": "programmer",
  "backend": "mock",
  "nights_run": 1,
  "baseline_holdout": 0.3194,
  "after_holdout": 1.0,
  "lift": 0.6806,
  "improved": true,
  "gate_blocks_harmful": true,
  "final_skill_excerpt": "laude Code sessions.\n\n<!-- SKILLOPT-SLEEP:LEARNED START -->\n## Learned preferences & procedures\n\n_This block is maintained by SkillOpt-Sleep. Edits here are proposed offline, validated against your past tasks, and adopted only after you approve them. Hand-edits outside this block are never touched._\n\n- Write git commit subjects in imperative mood, max 50 chars.\n<!-- SKILLOPT-SLEEP:LEARNED END -->\n",
  "trace": [
    {
      "night": 0,
      "holdout_score": 0.3194,
      "action": "baseline",
      "n_edits": 0
    },
    {
      "night": 1,
      "holdout_score": 1.0,
      "action": "accept_new_best",
      "accepted": true,
      "n_edits": 1,
      "edits": [
        "Write git commit subjects in imperative mood, max 50 chars."
      ],
      "n_rejected": 0
    }
  ]
}
```
