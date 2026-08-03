"""gateway 桥 SSE 解析(纯函数 _process_sse_line)单测 —— 覆盖 Dex 的
字符串 delta / 数组 delta(文件)/ gateway.tool.progress 事件 / 噪声鲁棒。"""

import json

import app.gateway_client as hc
from app.gateway_client import _StreamState, _process_sse_line, _build_extra_steps


def feed(lines):
    """喂多行 SSE,返回 (state, 收到的 delta 文本列表)。"""
    st = _StreamState()
    deltas = []
    for ln in lines:
        for frame in _process_sse_line(ln, st):
            deltas.append(frame["delta"])
    return st, deltas


def _chat(content):
    return "data: " + json.dumps({"choices": [{"delta": {"content": content}}]})


def test_string_delta_accumulates_and_yields():
    st, deltas = feed([_chat("你好"), _chat("世界")])
    assert deltas == ["你好", "世界"]
    assert "".join(st.answer_parts) == "你好世界"
    assert st.files == []
    assert _build_extra_steps(st) == []


def test_array_delta_text_and_file():
    line = _chat([
        {"type": "text", "text": "已生成"},
        {"type": "file", "file": {
            "filename": "hello.md",
            "file_data": "data:text/markdown;base64,aGVsbG8=",
        }},
    ])
    st, deltas = feed([line])
    assert deltas == ["已生成"]
    assert st.files == [
        {"filename": "hello.md", "dataUri": "data:text/markdown;base64,aGVsbG8="}
    ]


def test_tool_progress_dedup_latest_status():
    lines = [
        "event: gateway.tool.progress",
        'data: {"tool":"write_file","emoji":"\U0001f4dd","label":"/w/a.md","toolCallId":"c1","status":"running"}',
        "",
        "event: gateway.tool.progress",
        'data: {"tool":"write_file","emoji":"\U0001f4dd","label":"/w/a.md","toolCallId":"c1","status":"completed"}',
        "",
    ]
    st, deltas = feed(lines)
    assert deltas == []
    steps = _build_extra_steps(st)
    assert len(steps) == 1
    assert steps[0]["role"] == "tool"
    assert steps[0]["toolName"] == "write_file"
    assert steps[0]["output"] == "completed"
    assert steps[0]["isError"] is False
    assert "/w/a.md" in steps[0]["content"]


def test_tool_progress_error_status():
    st, _ = feed([
        "event: gateway.tool.progress",
        'data: {"tool":"run_cmd","toolCallId":"c9","status":"failed"}',
        "",
    ])
    steps = _build_extra_steps(st)
    assert steps[0]["isError"] is True


def test_tool_progress_no_callid_gets_sequential_key():
    st, _ = feed([
        "event: gateway.tool.progress",
        'data: {"tool":"a","status":"completed"}',
        "",
        "event: gateway.tool.progress",
        'data: {"tool":"b","status":"completed"}',
        "",
    ])
    assert len(_build_extra_steps(st)) == 2


def test_robust_to_noise():
    st, deltas = feed([
        "data: [DONE]",
        "data: not-json",
        'data: {"foo":1}',
        ": a comment line",
        "",
    ])
    assert deltas == []
    assert st.files == []
    assert _build_extra_steps(st) == []


def test_file_dedup_same_datauri():
    du = "data:text/plain;base64,YQ=="
    line = _chat([
        {"type": "file", "file": {"filename": "a.txt", "file_data": du}},
        {"type": "file", "file": {"filename": "a.txt", "file_data": du}},
    ])
    st, _ = feed([line])
    assert len(st.files) == 1


def test_file_count_cap(monkeypatch):
    monkeypatch.setattr(hc, "MAX_OUTPUT_FILES", 1)
    line = _chat([
        {"type": "file", "file": {"filename": "a", "file_data": "data:x;base64,YQ=="}},
        {"type": "file", "file": {"filename": "b", "file_data": "data:x;base64,Yg=="}},
    ])
    st, _ = feed([line])
    assert len(st.files) == 1


def test_file_oversize_skipped(monkeypatch):
    monkeypatch.setattr(hc, "MAX_FILE_DATAURI_LEN", 10)
    du = "data:text/plain;base64," + "A" * 50
    line = _chat([{"type": "file", "file": {"filename": "big.txt", "file_data": du}}])
    st, _ = feed([line])
    assert st.files == []


def test_non_data_file_uri_skipped():
    line = _chat([
        {"type": "file", "file": {"filename": "a.md", "file_data": "https://x/a.md"}},
    ])
    st, _ = feed([line])
    assert st.files == []


def test_usage_parsed():
    st, _ = feed([
        "data: " + json.dumps({"choices": [], "usage": {"prompt_tokens": 11, "completion_tokens": 22}}),
    ])
    assert st.tokens_in == 11
    assert st.tokens_out == 22
