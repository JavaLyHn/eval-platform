"""pass^k 聚合:把 K 次 trial 的 rollout 结果按 case id 聚合成保下限 + 均值。纯函数,无 I/O。"""
from __future__ import annotations


def aggregate_passk(trials: list[list[dict]]) -> dict:
    """trials = K 次 rollout 结果(每次是 results 列表,元素含 id/hard/soft/展示字段)。

    返回:
      {
        "k": K, "n_cases": int, "per_case": {id: {...}},
        "passk_hard": float,   # mean(per_case.passk) —— 严格保下限
        "mean_hard": float,    # 所有 trial 所有题 hard 均值 —— 平均水位
        "mean_soft": float,
      }
    每题对象含:hards/softs/pass_count/k/passk/mean_hard/mean_soft + 展示字段
    + 别名 hard=passk、soft=mean_soft(喂现有 results.json 消费方,图标=保下限二值)。
    """
    k = len(trials)
    order: list[str] = []
    seen: set[str] = set()
    by_trial: list[dict[str, dict]] = []
    for res in trials:
        m: dict[str, dict] = {}
        for r in res or []:
            cid = str(r.get("id"))
            m[cid] = r
            if cid not in seen:
                seen.add(cid)
                order.append(cid)
        by_trial.append(m)

    per_case: dict[str, dict] = {}
    passk_sum = hard_total = soft_total = 0.0
    hard_n = 0
    for cid in order:
        hards: list[float] = []
        softs: list[float] = []
        display: dict = {}
        for m in by_trial:
            r = m.get(cid)
            if r is None:
                hards.append(0.0)
                softs.append(0.0)
                continue
            hards.append(float(r.get("hard", 0) or 0))
            softs.append(float(r.get("soft", 0.0) or 0.0))
            if not display:
                display = {
                    "question": r.get("question", ""),
                    "predicted_answer": r.get("predicted_answer", ""),
                    "task_type": r.get("task_type", ""),
                    "case_type": r.get("case_type", ""),
                    "fail_reason": r.get("fail_reason", ""),
                }
        pass_count = sum(1 for h in hards if h >= 1.0 - 1e-9)
        passk = 1 if (k > 0 and pass_count == k) else 0
        mean_hard = (sum(hards) / k) if k else 0.0
        mean_soft = (sum(softs) / k) if k else 0.0
        per_case[cid] = {
            **display,
            "id": cid,
            "hards": hards,
            "softs": softs,
            "pass_count": pass_count,
            "k": k,
            "passk": passk,
            "mean_hard": mean_hard,
            "mean_soft": mean_soft,
            "hard": passk,        # 别名:results.json 消费方读 hard → 保下限二值
            "soft": mean_soft,    # 别名:soft → 均值
        }
        passk_sum += passk
        hard_total += sum(hards)
        soft_total += sum(softs)
        hard_n += k
    n_cases = len(order)
    return {
        "k": k,
        "n_cases": n_cases,
        "per_case": per_case,
        "passk_hard": (passk_sum / n_cases) if n_cases else 0.0,
        "mean_hard": (hard_total / hard_n) if hard_n else 0.0,
        "mean_soft": (soft_total / hard_n) if hard_n else 0.0,
    }
