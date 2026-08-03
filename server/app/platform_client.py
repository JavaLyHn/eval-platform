"""Platform 开放平台接入:纯函数 + 流式编排。

纯函数(可单测):
- pack_session / unpack_session: operatorId 与 platform sessionId 打包进单串,
  借现有 gatewaySessionId 字段透传,零数据模型改动。
- normalize_transcript: platform 历史 → 平台中立 AgentTranscript dict。
- extract_answer: platform 历史 → 最后一条 assistant 正文。
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncIterator

import httpx
import socketio

logger = logging.getLogger("platform")

_SEP = "|"
_WHITELIST_TOOLS = {"present_options", "panel_show", "preview_file"}

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
# 疑似密钥 / token / 长 ID:连续 ≥20 个 [A-Za-z0-9_-]
_TOKEN_RE = re.compile(r"\b[A-Za-z0-9_-]{20,}\b")


def redact_tool_io(value: object, *, max_chars: int = 800) -> str:
    """工具 I/O → 脱密截断字符串(尽力而为,非保证):
    JSON 串化 → 掩码邮箱 / 疑似密钥·token·长ID → 截断到 max_chars。"""
    try:
        s = json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        s = str(value)
    s = _EMAIL_RE.sub("<email>", s)
    s = _TOKEN_RE.sub("<redacted>", s)
    if len(s) > max_chars:
        s = s[:max_chars] + "…(截断)"
    return s


def _unwrap(payload: Any) -> Any:
    """Platform 开放平台所有响应套一层 {code,success,message,data,...} 信封,真数据在 data。

    取出 data;若不是信封(无 data 键)则原样返回。对接文档给的是拆信封后的形状。
    """
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def pack_session(operator_id: str, session_id: str) -> str:
    return f"{operator_id}{_SEP}{session_id}"


def unpack_session(token: str | None) -> tuple[str | None, str | None]:
    """复合串 '<op>|<sess>' → (operator_id, session_id)。空/无分隔符 → (None, None)。"""
    if not token or _SEP not in token:
        return None, None
    op, _, sess = token.partition(_SEP)
    return (op or None), (sess or None)


def extract_answer(history_items: list[dict[str, Any]]) -> str:
    """最后一条 role=='assistant' 的 content;无则空串。"""
    for item in reversed(history_items):
        if item.get("role") == "assistant":
            return item.get("content") or ""
    return ""


def normalize_transcript(
    history_items: list[dict[str, Any]],
    session_id: str,
    fetched_at: str,
    *,
    capture_io: bool = False,
) -> dict[str, Any]:
    """platform 历史 → 平台中立 AgentTranscript。
    capture_io=False(默认):仅白名单工具保留原始 I/O(其余脱敏剔除)。
    capture_io=True:所有工具保留「截断 + 脱密」的 I/O 片段。"""
    steps: list[dict[str, Any]] = []
    for item in history_items:
        step: dict[str, Any] = {
            "role": item.get("role"),
            "content": item.get("content") or "",
        }
        if item.get("createTime"):
            step["createTime"] = item["createTime"]
        tool_name = item.get("toolName")
        if tool_name:
            step["toolName"] = tool_name
            step["isError"] = bool(item.get("isError") or False)
            if capture_io:
                if "toolInput" in item:
                    step["toolInput"] = redact_tool_io(item["toolInput"])
                if "output" in item:
                    step["output"] = redact_tool_io(item["output"])
            elif tool_name in _WHITELIST_TOOLS:
                if "toolInput" in item:
                    step["toolInput"] = item["toolInput"]
                if "output" in item:
                    step["output"] = item["output"]
        steps.append(step)

        # 工具调用实际挂在 assistant 消息的 toolCalls[] 上(对接文档 §7.1),
        # 展开成独立 tool 步;非白名单工具的入参/出参由服务端脱敏,这里也只对白名单复制。
        for tc in item.get("toolCalls") or []:
            tname = tc.get("toolName")
            if not tname:
                continue
            tstep: dict[str, Any] = {
                "role": "tool",
                "content": "",
                "toolName": tname,
                "isError": bool(tc.get("isError") or False),
            }
            if capture_io:
                if "toolInput" in tc:
                    tstep["toolInput"] = redact_tool_io(tc["toolInput"])
                if "output" in tc:
                    tstep["output"] = redact_tool_io(tc["output"])
            elif tname in _WHITELIST_TOOLS:
                if "toolInput" in tc:
                    tstep["toolInput"] = tc["toolInput"]
                if "output" in tc:
                    tstep["output"] = tc["output"]
            steps.append(tstep)
    return {
        "source": "platform",
        "sessionId": session_id,
        "fetchedAt": fetched_at,
        "steps": steps,
    }


async def stream_chat(
    *,
    prompt: str,
    session_token: str | None,
    instance_id: str,
    base_url: str,
    api_key: str,
    timeout: int,
    namespace: str = "/open/agent",
    capture_tool_io: bool = False,
) -> AsyncIterator[dict[str, Any]]:
    """一轮对话的全编排,逐个 yield SSE 帧 dict(前端按 agentcli 词汇解析)。

    帧:
      {"event":"start","sessionId": "<op>|<sess>"}
      {"event":"stage","stage": "调用工具: X"}
      {"delta": "<最终正文>"}
      {"done": True, "sessionId","durationMs","interrupted","transcript"}
      {"error": "<干净提示>"}
    """
    operator_id, platform_session_id = unpack_session(session_token)
    if not operator_id:
        operator_id = f"eval-{uuid.uuid4().hex[:16]}"

    base = base_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "X-Operator-Id": operator_id,
        "Content-Type": "application/json",
    }

    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    sio = socketio.AsyncClient(reconnection=False)

    @sio.on("tool_use", namespace=namespace)
    async def _on_tool_use(data):  # noqa: ANN001
        await queue.put({"event": "stage", "stage": f"调用工具: {data.get('toolName', '?')}"})

    @sio.on("tool_done", namespace=namespace)
    async def _on_tool_done(data):  # noqa: ANN001
        mark = "✗" if data.get("isError") else "✓"
        await queue.put({"event": "stage", "stage": f"工具完成: {data.get('toolName', '?')} {mark}"})

    @sio.on("message", namespace=namespace)
    async def _on_message(data):  # noqa: ANN001
        # 实时流式:只转发 assistant 的增量(isChunk=true)。isChunk=false 是整段定稿、
        # isSnapshot 是订阅瞬间的累计快照,转发都会与增量重复,故跳过(见对接文档 §6.1)。
        if data.get("role") != "assistant" or not data.get("isChunk"):
            return
        content = data.get("content") or ""
        if content:
            await queue.put({"delta": content})

    @sio.on("done", namespace=namespace)
    async def _on_done(data):  # noqa: ANN001
        await queue.put({"_done": True, "interrupted": bool(data.get("interrupted") or False)})

    @sio.on("error", namespace=namespace)
    async def _on_error(data):  # noqa: ANN001
        await queue.put({"_error": "agent 推理出错(platform 侧已脱敏)"})

    started = datetime.now(timezone.utc)
    session_id: str | None = None
    completed = False

    async with httpx.AsyncClient(timeout=timeout) as http:
        # ① 换 WS token
        try:
            r = await http.post(f"{base}/api/open/auth/token", headers=headers)
            r.raise_for_status()
            ws_token = _unwrap(r.json())["token"]
        except Exception:
            logger.warning("platform auth/token failed", exc_info=True)
            yield {"error": "platform 鉴权失败,检查 server/.env 的 PLATFORM_API_KEY"}
            return

        # ② 连 socket
        try:
            await sio.connect(
                base,
                namespaces=[namespace],
                transports=["websocket"],
                auth={"token": ws_token},
            )
        except Exception:
            logger.warning("platform socket connect failed", exc_info=True)
            yield {"error": "连不上 platform socket:WS token 失效或后端 origin 未白名单"}
            return

        try:
            # ③ 建/续会话
            # platform 要求标准 UUID(带连字符);uuid4().hex 无连字符会被 'Invalid uuid' 拒。
            body: dict[str, Any] = {"message": prompt, "clientMsgId": str(uuid.uuid4())}
            if platform_session_id:
                body["sessionId"] = platform_session_id
            r = await http.post(
                f"{base}/api/open/agent/{instance_id}/sessions", headers=headers, json=body
            )
            r.raise_for_status()
            session_id = _unwrap(r.json())["sessionId"]
            composite = pack_session(operator_id, session_id)
            yield {"event": "start", "sessionId": composite}

            # ④ 订阅
            await sio.emit("subscribe", {"sessionId": session_id}, namespace=namespace)

            # ⑤ 等事件直到 done / error
            interrupted = False
            streamed_any = False
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=timeout)
                except asyncio.TimeoutError:
                    logger.warning("platform stream timeout after %ss", timeout)
                    yield {"error": "platform 推理超时,未在限定时间内返回结果"}
                    return
                if "_error" in msg:
                    yield {"error": msg["_error"]}
                    return
                if msg.get("_done"):
                    interrupted = bool(msg.get("interrupted"))
                    break
                if "delta" in msg:
                    streamed_any = True
                yield msg  # stage 进度 或 流式正文增量

            # ⑥ 拉 REST 定稿历史
            r = await http.get(
                f"{base}/api/open/agent/sessions/{session_id}/messages",
                headers=headers,
                params={"size": 100},
            )
            r.raise_for_status()
            history = _unwrap(r.json()).get("data", [])

            answer = extract_answer(history)
            fetched_at = datetime.now(timezone.utc).isoformat()
            transcript = normalize_transcript(
                history, session_id, fetched_at, capture_io=capture_tool_io
            )
            duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)

            # socket 已实时流式吐过正文 → 不再重发(否则重复);若本轮没流式(某些 agent/
            # 场景不走增量)→ 用 REST 定稿一次性补上,保证正文不丢。
            if not streamed_any and answer:
                yield {"delta": answer}
            yield {
                "done": True,
                "sessionId": composite,
                "durationMs": duration_ms,
                "interrupted": interrupted,
                "transcript": transcript,
            }
            completed = True
        except Exception:
            logger.exception("platform interaction error")
            yield {"error": "platform 交互异常,请重试或检查实例配置"}
        finally:
            # 客户端中断/异常退出 → best-effort 中止 platform 推理,避免孤儿跑烧 token
            if not completed and session_id:
                try:
                    await http.post(
                        f"{base}/api/open/agent/{instance_id}/sessions/{session_id}/abort",
                        headers=headers,
                    )
                except BaseException:
                    pass
            try:
                await sio.disconnect()
            except BaseException:
                pass


async def list_skills(
    *,
    base_url: str,
    api_key: str,
    instance_id: str | None = None,
    template_id: str | None = None,
    timeout: int = 15,
) -> dict[str, Any]:
    """拉取 Platform account 的技能列表(只读)。返回 {ok, skills, templateId?, templateName?, detail?}。

    优先级:instance_id → 先查实例详情取 templateId,再拉技能;template_id → 直接拉;
    均未给 → 拉全量(无 templateId 参数)。
    """
    if not base_url or not api_key:
        return {"ok": False, "skills": [], "detail": "未配置 PLATFORM_BASE_URL / PLATFORM_API_KEY"}
    base = base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {api_key}", "X-Operator-Id": "eval-skills"}

    template_name: str | None = None

    # 若给了 instance_id 但未给 template_id,解析实例 → templateId。
    # 注意:单实例详情接口 (/instances/{id}) 不带 templateId(只有 id/name/description/
    # groupId/chatModel);**只有列表接口** (/instances) 每个实例才带 templateId/templateName。
    # 所以这里拉列表、按 id 匹配。
    if instance_id and not template_id:
        try:
            async with httpx.AsyncClient(timeout=timeout) as http:
                r = await http.get(
                    f"{base}/api/open/agent/instances", headers=headers, params={"size": 200}
                )
        except Exception as e:
            logger.warning("platform list_skills: fetch instances failed", exc_info=True)
            return {"ok": False, "skills": [], "detail": f"取实例列表失败: {type(e).__name__}"}
        if r.status_code != 200:
            return {"ok": False, "skills": [], "detail": f"取实例列表失败: HTTP {r.status_code}"}
        body = r.json()
        if isinstance(body, dict) and not body.get("success", True):
            msg = body.get("message") or "platform 返回 success=false"
            return {"ok": False, "skills": [], "detail": f"取实例列表失败: {msg}"}
        data = _unwrap(body)
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = (
                data.get("list")
                or data.get("data")
                or data.get("records")
                or data.get("items")
                or []
            )
        else:
            items = []
        match = next(
            (it for it in items if isinstance(it, dict) and str(it.get("id")) == str(instance_id)),
            None,
        )
        if match is None:
            return {
                "ok": False,
                "skills": [],
                "detail": "实例不在列表中(可能超出 size=200 或 id 不存在)",
            }
        template_id = match.get("templateId")
        template_name = match.get("templateName")
        if not template_id:
            return {"ok": False, "skills": [], "detail": "实例未关联模板(templateId 为空)"}

    params: dict[str, Any] = {}
    if template_id:
        params["templateId"] = template_id
    try:
        async with httpx.AsyncClient(timeout=timeout) as http:
            r = await http.get(f"{base}/api/open/agent/skills", headers=headers, params=params)
    except Exception as e:
        logger.warning("platform list_skills failed", exc_info=True)
        return {"ok": False, "skills": [], "detail": f"连不上 platform: {type(e).__name__}"}
    if r.status_code != 200:
        return {"ok": False, "skills": [], "detail": f"HTTP {r.status_code}"}
    body = r.json()
    if isinstance(body, dict) and not body.get("success", True):
        return {"ok": False, "skills": [], "detail": body.get("message") or "platform 返回 success=false"}
    data = _unwrap(body)
    skills = data if isinstance(data, list) else (data.get("skills") if isinstance(data, dict) else None)
    if not isinstance(skills, list):
        skills = []
    return {"ok": True, "skills": skills, "templateId": template_id, "templateName": template_name}


def _dedupe_employees(records: list[dict]) -> list[dict]:
    """实例记录 → 按 templateId 去重的员工列表;跳过空 templateId;按 templateName 排序。"""
    seen: dict[str, str] = {}
    for r in records:
        tid = r.get("templateId")
        if not tid:
            continue
        tid = str(tid)
        if tid not in seen:
            seen[tid] = str(r.get("templateName") or r.get("name") or tid)
    return sorted(
        ({"templateId": k, "templateName": v} for k, v in seen.items()),
        key=lambda e: e["templateName"],
    )


async def list_employees(
    *, base_url: str, api_key: str, timeout: int = 15
) -> dict[str, Any]:
    """拉 Platform 实例列表 → 按 templateId 去重成员工。返回 {ok, employees, detail?}。"""
    if not base_url or not api_key:
        return {"ok": False, "employees": [], "detail": "未配置 PLATFORM_BASE_URL / PLATFORM_API_KEY"}
    base = base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {api_key}", "X-Operator-Id": "eval-employees"}
    try:
        async with httpx.AsyncClient(timeout=timeout) as http:
            r = await http.get(
                f"{base}/api/open/agent/instances", headers=headers, params={"size": 200}
            )
    except Exception as e:  # noqa: BLE001
        logger.warning("platform list_employees failed", exc_info=True)
        return {"ok": False, "employees": [], "detail": f"连不上 platform: {type(e).__name__}"}
    if r.status_code != 200:
        return {"ok": False, "employees": [], "detail": f"HTTP {r.status_code}"}
    body = r.json()
    if isinstance(body, dict) and not body.get("success", True):
        return {"ok": False, "employees": [], "detail": body.get("message") or "platform 返回 success=false"}
    data = _unwrap(body)
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        items = data.get("data") or data.get("list") or data.get("records") or data.get("items") or []
    else:
        items = []
    return {"ok": True, "employees": _dedupe_employees([it for it in items if isinstance(it, dict)])}


async def ping(
    *, base_url: str, api_key: str, instance_id: str | None = None, timeout: int = 15
) -> dict[str, Any]:
    """探活(不连 socket、不跑 agent)。返回 {ok, detail}。

    给了 instance_id 就校验**该实例本身**(GET 实例详情)——绿灯才代表"这个员工真能连",
    detail 回员工名 + 模型,便于一眼确认连的是谁;无效 id → platform 返回 success=false → 红灯。
    没给 instance_id 时退化为只探 API Key + 连通性。
    """
    if not base_url or not api_key:
        return {"ok": False, "detail": "未配置 PLATFORM_BASE_URL / PLATFORM_API_KEY"}
    base = base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {api_key}", "X-Operator-Id": "eval-ping"}
    try:
        async with httpx.AsyncClient(timeout=timeout) as http:
            if instance_id:
                r = await http.get(
                    f"{base}/api/open/agent/instances/{instance_id}", headers=headers
                )
            else:
                r = await http.get(
                    f"{base}/api/open/agent/instances", headers=headers, params={"size": 1}
                )
    except Exception as e:
        logger.warning("platform ping failed", exc_info=True)
        return {"ok": False, "detail": f"连不上 platform: {type(e).__name__}"}
    if r.status_code != 200:
        return {"ok": False, "detail": f"HTTP {r.status_code}"}
    body = r.json()
    # platform 对无效实例返回 HTTP 200 + success:false(如"Agent 实例不存在: …"),必须看 success。
    if not body.get("success", True):
        return {"ok": False, "detail": body.get("message") or "platform 返回 success=false"}
    data = _unwrap(body)
    if instance_id:
        name = data.get("name") if isinstance(data, dict) else None
        model = data.get("chatModel") if isinstance(data, dict) else None
        detail = f"已连接 · {name or instance_id}"
        if model:
            detail += f" · {model}"
        # 结构化回传真实模型(chatModel),供前端缓存 → 聊天时当 modelVersion → 匹配定价表算 $。
        return {"ok": True, "detail": detail, "model": model}
    total = data.get("total") if isinstance(data, dict) else None
    return {"ok": True, "detail": f"platform 可达 · 实例 {total} 个" if total is not None else "platform 可达"}
