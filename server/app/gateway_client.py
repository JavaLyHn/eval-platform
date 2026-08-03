"""Gateway / OpenAI 兼容网关桥。

目标是任意 OpenAI 兼容网关后的被测 Agent(如 demo 员工 Dex)。这类网关暴露标准
OpenAI `/v1/chat/completions` 协议,但常**不发 CORS 头** → 浏览器直连被拦。
本模块在服务端代理:server→server 没有 CORS 限制,且 API Key 留在后端
`.env`(不进浏览器 localStorage)。上游 SSE 转成平台中立的帧
(start / delta / done+transcript / error),与 platform 桥同词汇,前端
gateway provider 复用同一套 SSE 消费器(consumePlatformSSE)。

被测对象经 chat/completions 只回最终答案,没有工具轨迹 → transcript 仅含
user + assistant 两步(如实反映能拿到的信息)。
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Dex 文件/工具进度落地上限(防 transcript 过大爆 localStorage;测试可 monkeypatch)。
MAX_OUTPUT_FILES = 12
MAX_FILE_DATAURI_LEN = 8_000_000  # ~8MB base64 串,超限跳过
MAX_TOOL_STEPS = 40
_ERROR_STATUSES = {"error", "failed", "failure"}


@dataclass
class _StreamState:
    """一轮 SSE 的累积状态(供纯解析函数 _process_sse_line 更新)。"""

    current_event: str | None = None
    answer_parts: list[str] = field(default_factory=list)
    files: list[dict[str, str]] = field(default_factory=list)
    # toolCallId(或合成键)-> transcript 工具步;同 id 覆盖 = 留最新 status。
    tool_steps: dict[str, dict[str, Any]] = field(default_factory=dict)
    tokens_in: int | None = None
    tokens_out: int | None = None
    _seen_files: set[str] = field(default_factory=set)
    _tool_seq: int = 0


def _accumulate_file(f: Any, st: _StreamState) -> None:
    """数组 delta 的 file 段 → st.files(仅 data: URI,去重 + 限量 + 限体积)。"""
    if not isinstance(f, dict):
        return
    data_uri = f.get("file_data")
    if not isinstance(data_uri, str) or not data_uri.startswith("data:"):
        return
    if len(data_uri) > MAX_FILE_DATAURI_LEN or len(st.files) >= MAX_OUTPUT_FILES:
        return
    if data_uri in st._seen_files:
        return
    st._seen_files.add(data_uri)
    filename = f.get("filename")
    st.files.append(
        {"filename": str(filename) if filename else "file", "dataUri": data_uri}
    )


def _accumulate_tool(ev: Any, st: _StreamState) -> None:
    """gateway.tool.progress 事件 → st.tool_steps(按 toolCallId 去重,留最新)。"""
    if not isinstance(ev, dict):
        return
    call_id = ev.get("toolCallId")
    if call_id in (None, ""):
        st._tool_seq += 1
        call_id = f"__seq{st._tool_seq}"
    else:
        call_id = str(call_id)
    if call_id not in st.tool_steps and len(st.tool_steps) >= MAX_TOOL_STEPS:
        return
    status = ev.get("status")
    label = ev.get("label") or ""
    emoji = ev.get("emoji") or ""
    content = f"{emoji} {label}".strip() if emoji else str(label)
    is_error = isinstance(status, str) and status.lower() in _ERROR_STATUSES
    st.tool_steps[call_id] = {
        "role": "tool",
        "toolName": str(ev.get("tool") or "tool"),
        "content": content,
        "isError": is_error,
        "output": status,
    }


def _process_sse_line(line: str, st: _StreamState) -> list[dict[str, Any]]:
    """消费一行上游 SSE,更新 st,返回要 yield 的 delta 帧(0/1 条)。

    - `event:` 行 → 记当前事件名;空行 / 处理完一条 data 后复位(命名事件单 data 行)。
    - `event: gateway.tool.progress` 的 data → 工具步累积。
    - 其余 data(chat chunk):content 为 str → 文本增量;为 list → 遍历 text/file 段。
    """
    if not line:
        st.current_event = None
        return []
    if line.startswith("event:"):
        st.current_event = line[6:].strip()
        return []
    if not line.startswith("data:"):
        return []
    payload = line[5:].strip()
    event = st.current_event
    st.current_event = None
    if not payload or payload == "[DONE]":
        return []
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, dict):
        return []
    if event == "gateway.tool.progress":
        _accumulate_tool(data, st)
        return []
    out: list[dict[str, Any]] = []
    choices = data.get("choices") or []
    if choices:
        content = (choices[0].get("delta") or {}).get("content")
        if isinstance(content, str) and content:
            st.answer_parts.append(content)
            out.append({"delta": content})
        elif isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                ptype = part.get("type")
                if ptype == "text":
                    text = part.get("text")
                    if isinstance(text, str) and text:
                        st.answer_parts.append(text)
                        out.append({"delta": text})
                elif ptype == "file":
                    _accumulate_file(part.get("file"), st)
    usage = data.get("usage")
    if isinstance(usage, dict):
        if usage.get("prompt_tokens") is not None:
            st.tokens_in = usage["prompt_tokens"]
        if usage.get("completion_tokens") is not None:
            st.tokens_out = usage["completion_tokens"]
    return out


def _build_extra_steps(st: _StreamState) -> list[dict[str, Any]]:
    """工具进度 → transcript 中间步(dict 插入序 = 首现序)。"""
    return list(st.tool_steps.values())


def _build_messages(
    prompt: str,
    history: list[dict[str, Any]] | None,
    images: list[str] | None = None,
) -> list[dict[str, Any]]:
    """把 history(可空)+ 本轮 prompt(可含图片)拼成 OpenAI messages。

    多轮改由 X-Gateway-Session-Id 在网关侧记忆 → 前端通常**不再传 history**(history=[]),
    这里只发本轮;若调用方仍传 history 则一并拼上(向后兼容,只带文本)。
    本轮带图 → user content 用 OpenAI 多模态数组 [{type:text},{type:image_url}…]。
    """
    msgs: list[dict[str, Any]] = []
    for item in history or []:
        role = item.get("role")
        content = item.get("content")
        if role in ("user", "assistant", "system") and isinstance(content, str) and content:
            msgs.append({"role": role, "content": content})
    valid_images = [u for u in (images or []) if isinstance(u, str) and u]
    if valid_images:
        parts: list[dict[str, Any]] = []
        # 只发图(prompt 为空)时不放空 text 块 —— 部分网关会拒空字符串。
        if prompt:
            parts.append({"type": "text", "text": prompt})
        for url in valid_images:
            parts.append({"type": "image_url", "image_url": {"url": url}})
        msgs.append({"role": "user", "content": parts})
    else:
        msgs.append({"role": "user", "content": prompt})
    return msgs


async def ping(
    *, base_url: str, api_key: str, model: str, timeout: int = 15
) -> dict[str, Any]:
    """探活:GET {base}/v1/models,顺带校验目标模型是否在可用列表。"""
    if not base_url or not api_key:
        return {"ok": False, "detail": "未配置 GATEWAY_BASE_URL / GATEWAY_API_KEY(server/.env)"}
    base = base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        async with httpx.AsyncClient(timeout=timeout) as http:
            r = await http.get(f"{base}/v1/models", headers=headers)
        if r.status_code != 200:
            return {"ok": False, "detail": f"网关 HTTP {r.status_code}"}
        data = (r.json() or {}).get("data") or []
        ids = [m.get("id") for m in data if isinstance(m, dict) and m.get("id")]
        if model and ids and model not in ids:
            peek = ", ".join(ids[:8])
            return {
                "ok": False,
                "detail": f"网关可达,但模型「{model}」不在可用列表(可用: {peek})",
                "model": None,
            }
        return {"ok": True, "detail": "ok", "model": model or (ids[0] if ids else None)}
    except Exception as e:  # noqa: BLE001
        logger.warning("gateway ping failed", exc_info=True)
        return {"ok": False, "detail": f"连接失败: {type(e).__name__}"}


async def stream_chat(
    *,
    prompt: str,
    history: list[dict[str, Any]] | None,
    base_url: str,
    api_key: str,
    model: str,
    timeout: int,
    images: list[str] | None = None,
    session_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """一轮对话,逐帧 yield(与 platform 桥同词汇,前端复用消费器)。

    多轮:传 session_id → 作为 `X-Gateway-Session-Id` 头发给网关,网关服务端记忆
    (同一 sid 续接上下文/沙箱,无需重发 history)。首轮 session_id 为空 → 本函数
    生成一个并经 start 帧回传,前端存下、后续轮回传复用(同 platform 的 sessionId 流)。

    帧:
      {"event":"start","sessionId": <sid>}
      {"delta": "<正文增量>"}
      {"done": True,"sessionId","durationMs","interrupted":False,"transcript","tokensIn?","tokensOut?"}
      {"error": "<干净提示>"}
    """
    if not base_url or not api_key:
        yield {"error": "未配置 GATEWAY_BASE_URL / GATEWAY_API_KEY(server/.env)"}
        return

    sid = session_id or uuid.uuid4().hex
    base = base_url.rstrip("/")
    url = f"{base}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        # 多轮会话:网关按此 id 在服务端记住上下文(同一 sid 续接)。
        "X-Gateway-Session-Id": sid,
    }
    body: dict[str, Any] = {
        "model": model,
        "messages": _build_messages(prompt, history, images),
        "stream": True,
    }

    started = datetime.now(timezone.utc)
    yield {"event": "start", "sessionId": sid}

    st = _StreamState()

    try:
        async with httpx.AsyncClient(timeout=timeout) as http:
            async with http.stream("POST", url, headers=headers, json=body) as resp:
                if resp.status_code != 200:
                    raw = (await resp.aread()).decode("utf-8", "replace")[:200]
                    yield {"error": f"Gateway HTTP {resp.status_code}: {raw}"}
                    return
                async for line in resp.aiter_lines():
                    for out_frame in _process_sse_line(line, st):
                        yield out_frame
    except httpx.TimeoutException:
        logger.warning("gateway stream timeout after %ss", timeout)
        yield {"error": "Gateway 推理超时,未在限定时间内返回结果"}
        return
    except Exception:
        logger.exception("gateway stream error")
        yield {"error": "Gateway 交互异常,请重试或检查 server/.env 配置"}
        return

    answer = "".join(st.answer_parts)
    fetched_at = datetime.now(timezone.utc).isoformat()
    duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    steps: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
    steps.extend(_build_extra_steps(st))
    steps.append({"role": "assistant", "content": answer})
    transcript: dict[str, Any] = {
        "source": "gateway",
        "sessionId": sid,
        "fetchedAt": fetched_at,
        "steps": steps,
    }
    if st.files:
        transcript["files"] = st.files
    frame: dict[str, Any] = {
        "done": True,
        "sessionId": sid,
        "durationMs": duration_ms,
        "interrupted": False,
        "transcript": transcript,
    }
    if st.tokens_in is not None:
        frame["tokensIn"] = st.tokens_in
    if st.tokens_out is not None:
        frame["tokensOut"] = st.tokens_out
    yield frame
