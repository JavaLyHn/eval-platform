from app.platform_client import pack_session, unpack_session


def test_pack_session_joins_with_pipe():
    assert pack_session("eval-abc", "1934567890") == "eval-abc|1934567890"


def test_unpack_roundtrip():
    op, sess = unpack_session(pack_session("eval-abc", "1934567890"))
    assert op == "eval-abc"
    assert sess == "1934567890"


def test_unpack_none_is_fresh():
    assert unpack_session(None) == (None, None)


def test_unpack_no_separator_is_fresh():
    assert unpack_session("garbage-no-pipe") == (None, None)


from app.platform_client import extract_answer, normalize_transcript

_HISTORY = [
    {"role": "user", "content": "请计算 17×23", "createTime": "2026-06-01T10:00:00Z"},
    {"role": "tool", "toolName": "calculator", "isError": False,
     "toolInput": {"x": 17}, "output": 391, "content": ""},
    {"role": "tool", "toolName": "present_options", "isError": False,
     "toolInput": {"options": ["A", "B"]}, "output": {"picked": "A"}, "content": ""},
    {"role": "assistant", "content": "17×23 = 391"},
]


def test_extract_answer_takes_last_assistant():
    assert extract_answer(_HISTORY) == "17×23 = 391"


def test_extract_answer_empty_when_no_assistant():
    assert extract_answer([{"role": "user", "content": "hi"}]) == ""


def test_normalize_shape_and_session():
    t = normalize_transcript(_HISTORY, "sess-1", "2026-06-01T10:01:00Z")
    assert t["source"] == "platform"
    assert t["sessionId"] == "sess-1"
    assert t["fetchedAt"] == "2026-06-01T10:01:00Z"
    assert len(t["steps"]) == 4


def test_normalize_desensitizes_non_whitelist_tool():
    t = normalize_transcript(_HISTORY, "s", "f")
    calc = t["steps"][1]
    assert calc["toolName"] == "calculator"
    assert calc["isError"] is False
    assert "toolInput" not in calc  # 非白名单 → 脱敏
    assert "output" not in calc


def test_normalize_keeps_whitelist_tool_io():
    t = normalize_transcript(_HISTORY, "s", "f")
    opt = t["steps"][2]
    assert opt["toolName"] == "present_options"
    assert opt["toolInput"] == {"options": ["A", "B"]}
    assert opt["output"] == {"picked": "A"}


def test_normalize_expands_toolcalls_on_assistant():
    # 真实形状(冒烟确认):工具调用挂在 assistant 消息的 toolCalls[] 上
    history = [
        {
            "role": "assistant",
            "content": "",
            "toolCalls": [
                {"toolCallId": "t1", "toolName": "present_options", "isError": False,
                 "toolInput": {"q": "?"}, "output": {"picked": "A"}},
                {"toolCallId": "t2", "toolName": "secret_tool", "isError": True},
            ],
        },
    ]
    t = normalize_transcript(history, "s", "f")
    assert [s["role"] for s in t["steps"]] == ["assistant", "tool", "tool"]
    opt = t["steps"][1]
    assert opt["toolName"] == "present_options"
    assert opt["toolInput"] == {"q": "?"}
    assert opt["output"] == {"picked": "A"}
    secret = t["steps"][2]
    assert secret["toolName"] == "secret_tool"
    assert secret["isError"] is True
    assert "toolInput" not in secret and "output" not in secret  # 非白名单脱敏


def test_unwrap_envelope_and_passthrough():
    from app.platform_client import _unwrap

    assert _unwrap({"code": 0, "success": True, "data": {"token": "x"}}) == {"token": "x"}
    assert _unwrap({"no": "envelope"}) == {"no": "envelope"}
    assert _unwrap([1, 2]) == [1, 2]


from app.platform_client import _dedupe_employees


def test_dedupe_employees_dedups_sorts_skips_empty():
    records = [
        {"id": "1", "templateId": "T_aria", "templateName": "Aria"},
        {"id": "2", "templateId": "T_aria", "templateName": "Aria"},   # 重复 templateId
        {"id": "3", "templateId": "T_nav", "templateName": "Dex"},
        {"id": "4", "templateId": None, "templateName": "无模板"},        # 跳过空 templateId
        {"id": "5", "templateId": "T_sam"},                            # 无 templateName → 回退
    ]
    out = _dedupe_employees(records)
    assert [e["templateId"] for e in out] == ["T_aria", "T_nav", "T_sam"]
    assert [e["templateName"] for e in out] == ["Aria", "Dex", "T_sam"]


def test_dedupe_employees_empty():
    assert _dedupe_employees([]) == []


# ── Task 1: redact_tool_io + capture_io 测试 ──────────────────────────────────
from app.platform_client import redact_tool_io


def test_redact_masks_email_and_token_and_truncates():
    s = redact_tool_io({"to": "aria@example.com", "key": "sk_live_ABCDEFGHIJKLMNOPQRSTUVWX"})
    assert "aria@example.com" not in s
    assert "<email>" in s
    assert "ABCDEFGHIJKLMNOPQRSTUVWX" not in s
    assert "<redacted>" in s
    # 截断:用短词长串(每词 <20 字符,不会被 token 正则整体掩码)验证截断生效
    long = redact_tool_io("ab cd " * 400, max_chars=800)
    assert len(long) <= 800 + len("…(截断)")
    assert long.endswith("…(截断)")


def test_redact_stringifies_non_json():
    # 非 JSON 安全对象走 str()
    class Weird:
        def __repr__(self):
            return "WEIRD"
    assert "WEIRD" in redact_tool_io(Weird())


def test_normalize_default_strips_nonwhitelist_io():
    history = [
        {"role": "assistant", "toolName": "send_email",
         "toolInput": {"to": "a@b.com"}, "output": "sent"},
        {"role": "assistant", "toolName": "present_options",
         "toolInput": {"opts": ["x"]}, "output": "shown"},
    ]
    out = normalize_transcript(history, "sess", "2026-06-18T00:00:00Z")
    steps = out["steps"]
    email_step = next(s for s in steps if s.get("toolName") == "send_email")
    opt_step = next(s for s in steps if s.get("toolName") == "present_options")
    # 默认:非白名单工具无 I/O;白名单保留原始 I/O
    assert "toolInput" not in email_step and "output" not in email_step
    assert opt_step["toolInput"] == {"opts": ["x"]}
    assert opt_step["output"] == "shown"


def test_normalize_capture_io_redacts_all_tools():
    history = [
        {"role": "assistant", "toolName": "send_email",
         "toolInput": {"to": "a@b.com"}, "output": "ok"},
        {"role": "assistant", "toolName": "present_options",
         "toolInput": {"opts": ["x"]}, "output": "shown"},
    ]
    out = normalize_transcript(history, "sess", "2026-06-18T00:00:00Z", capture_io=True)
    email_step = next(s for s in out["steps"] if s.get("toolName") == "send_email")
    opt_step = next(s for s in out["steps"] if s.get("toolName") == "present_options")
    # 开关开:非白名单也有 I/O,且脱密(邮箱被掩码);白名单同样走脱密(变字符串)
    assert isinstance(email_step["toolInput"], str)
    assert "a@b.com" not in email_step["toolInput"]
    assert "<email>" in email_step["toolInput"]
    assert isinstance(opt_step["toolInput"], str)
    assert isinstance(opt_step["output"], str)
