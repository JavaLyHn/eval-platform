from skillopt.envs.qaplatform.scorer import (
    detect_script, check_lang_match, check_no_leak,
    check_no_placeholder, check_tool_succeeded, run_ground_truth_checks,
    check_must_include, score_output,
)

def test_detect_script():
    assert detect_script("こんにちは") == "ja"
    assert detect_script("안녕하세요") == "ko"
    assert detect_script("你好") == "zh"
    assert detect_script("hello") == "en"
    assert detect_script("123 !!!") == "unknown"

def test_lang_match():
    assert check_lang_match("価格は?", "ご案内します")["passed"] is True
    assert check_lang_match("価格は?", "Here you go")["passed"] is False
    # 根治:纯汉字日语(无假名 → 被判 zh)+ 带假名日答 → 兼容,不误杀
    assert check_lang_match("価格教示願", "はい、ご案内します")["passed"] is True
    # 中文问 + 日文答 → 汉字共用,无法可靠区分 → 兼容
    assert check_lang_match("请告诉我价格", "はい、ご案内します")["passed"] is True
    # en / ko 仍严格
    assert check_lang_match("请告诉我价格", "Sure, here it is")["passed"] is False
    assert check_lang_match("안녕하세요", "ご案内します")["passed"] is False

def test_no_leak_default_blocklist():
    assert check_no_leak("正常回复", None)["passed"] is True
    assert check_no_leak("the panel_id is 42", None)["passed"] is False
    assert check_no_leak("<thinking>secret", None)["passed"] is False

def test_no_placeholder():
    assert check_no_placeholder("Hi there", None)["passed"] is True
    assert check_no_placeholder("Hi {name}", None)["passed"] is False
    assert check_no_placeholder("Dear [Company]", None)["passed"] is False

def test_tool_succeeded():
    assert check_tool_succeeded(None, None)["passed"] is False
    assert check_tool_succeeded([{"name": "post_tweet", "calls": 1, "errors": 0}], None)["passed"] is True
    assert check_tool_succeeded([{"name": "draft", "calls": 1, "errors": 0}], None)["passed"] is False
    assert check_tool_succeeded([{"name": "publish", "calls": 1, "errors": 1}], None)["passed"] is False

def test_run_ground_truth_all_pass():
    g = run_ground_truth_checks(["no-leak", "no-placeholder"], answer="hello", user="hi", tool_events=[])
    assert g["verdict"] == "passed" and g["score"] == 1.0

def test_run_ground_truth_partial():
    g = run_ground_truth_checks(["no-leak", "no-placeholder"], answer="hi {name}", user="hi", tool_events=[])
    assert g["verdict"] == "failed" and g["score"] == 0.5


def test_must_include():
    g = check_must_include("Aurora 72小时控油", ["Aurora", "72"], None)
    assert g["passed"] is True and g["soft"] == 1.0
    g = check_must_include("Aurora 72小时", ["Aurora", "72", "SAVE20"], None)  # 漏一条
    assert g["passed"] is False and abs(g["soft"] - 2 / 3) < 1e-9 and "SAVE20" in g["note"]
    g = check_must_include("Aurora 保证有效", ["Aurora"], ["保证"])  # 命中禁现
    assert g["passed"] is False and "保证" in g["note"]
    g = check_must_include("NIMBUS #buildfaster", ["nimbus", "#BuildFaster"], None)  # 大小写不敏感
    assert g["passed"] is True
    g = check_must_include("anything", [], [])  # 空约束真空通过
    assert g["passed"] is True and g["soft"] == 1.0


def test_run_ground_truth_must_include_partial_soft():
    g = run_ground_truth_checks(["must-include"], answer="Aurora 72", user="x", tool_events=[],
                                include=["Aurora", "72", "SAVE20"], exclude=None)
    assert g["verdict"] == "failed" and abs(g["score"] - 2 / 3) < 1e-9


def test_score_output_acceptany_constraint_partial_soft():
    """漏 1 条约束 → 硬判挂,但 soft 给部分分(训练梯度)。"""
    case = {"caseType": "acceptAny", "prompt": "给 Aurora 写条 60 字推广",
            "expected": {"language": "zh", "mustInclude": ["Aurora", "60", "SAVE20"]},
            "groundTruthChecks": ["must-include"]}
    out = {"responded": True, "answerText": "Aurora 60字推广文案", "requiresClarification": False,
           "intercepted": False, "toolEvents": []}
    g = score_output(case, out)
    assert g["hard"] == 0 and 0.0 < g["soft"] < 1.0


def test_score_output_standard_intent():
    """standard:意图命中 → 过;意图错 → 挂(slots 不判)。"""
    case = {"caseType": "standard", "prompt": "你们这套多少钱一个月?",
            "expected": {"language": "zh", "intentType": "pricing_inquiry", "requiresClarification": False},
            "groundTruthChecks": []}
    hit = {"responded": True, "answerText": "我们的价格是每月…", "intentType": "pricing_inquiry",
           "requiresClarification": False, "intercepted": False, "slots": {"plan": "pro"}, "toolEvents": []}
    assert score_output(case, hit)["hard"] == 1  # slots 有值也不影响(不判 slots)
    miss = {**hit, "intentType": "troubleshooting"}
    assert score_output(case, miss)["hard"] == 0
