from skillopt.engine.passk import aggregate_passk


def _case(cid, hard, soft, **kw):
    return {"id": cid, "hard": hard, "soft": soft, **kw}


def test_all_pass_gives_passk_1():
    trials = [[_case("a", 1, 1.0)], [_case("a", 1, 1.0)], [_case("a", 1, 1.0)]]
    agg = aggregate_passk(trials)
    assert agg["k"] == 3
    assert agg["per_case"]["a"]["passk"] == 1
    assert agg["per_case"]["a"]["pass_count"] == 3
    assert agg["passk_hard"] == 1.0
    assert abs(agg["mean_hard"] - 1.0) < 1e-9


def test_one_failing_trial_fails_passk_but_mean_partial():
    trials = [[_case("a", 1, 0.8)], [_case("a", 0, 0.4)], [_case("a", 1, 0.9)]]
    c = aggregate_passk(trials)["per_case"]["a"]
    assert c["passk"] == 0
    assert c["pass_count"] == 2
    assert abs(c["mean_hard"] - 2 / 3) < 1e-9
    assert abs(c["mean_soft"] - (0.8 + 0.4 + 0.9) / 3) < 1e-9


def test_k1_passk_equals_hard():
    agg = aggregate_passk([[_case("a", 1, 0.5), _case("b", 0, 0.2)]])
    assert agg["k"] == 1
    assert agg["per_case"]["a"]["passk"] == 1
    assert agg["per_case"]["b"]["passk"] == 0
    assert agg["per_case"]["a"]["mean_hard"] == 1.0
    assert agg["passk_hard"] == 0.5  # 2 题里过 1


def test_missing_id_in_a_trial_counts_as_fail():
    c = aggregate_passk([[_case("a", 1, 1.0)], [], [_case("a", 1, 1.0)]])["per_case"]["a"]
    assert c["pass_count"] == 2
    assert c["passk"] == 0


def test_hard_soft_aliases_for_results_compat():
    c = aggregate_passk([[_case("a", 1, 0.6)], [_case("a", 0, 0.4)]])["per_case"]["a"]
    assert c["hard"] == c["passk"]        # 别名 hard = passk(保下限二值,喂 ④ 图标)
    assert c["soft"] == c["mean_soft"]


def test_display_fields_from_first_present_trial():
    trials = [[_case("a", 1, 1.0, question="退款?", task_type="refund",
                     case_type="standard", predicted_answer="已受理", fail_reason="")]]
    c = aggregate_passk(trials)["per_case"]["a"]
    assert c["question"] == "退款?" and c["task_type"] == "refund"
    assert c["predicted_answer"] == "已受理"
