import json
from typing import Any

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from ..config import settings
from ..gateway_client import ping as gateway_ping
from ..gateway_client import stream_chat

router = APIRouter(prefix="/gateway", tags=["gateway"])


@router.post("/ping")
async def gateway_ping_route(body: dict[str, Any] | None = None):
    """连通性探活,供前端 gateway provider.ping() 调用(校验网关可达 + 模型在列表)。

    key/base/model 优先取请求体(前端 profile 配置),缺省回退 .env —— 这样运维
    不进部署机也能在 UI 填 sk 直接连。POST(而非 GET)是为了让 key 走请求体、
    不进 URL / 访问日志。
    """
    b = body or {}
    return await gateway_ping(
        base_url=b.get("baseUrl") or settings.gateway_base_url,
        api_key=b.get("apiKey") or settings.gateway_api_key,
        model=b.get("model") or settings.gateway_model,
    )


@router.post("/chat")
async def gateway_chat(body: dict[str, Any]):
    prompt = body.get("prompt") or ""
    history = body.get("history") or []
    images = body.get("images") or []
    model = body.get("model") or settings.gateway_model
    # 前端 profile 传来的 key/base 优先,留空回退 .env(向后兼容既有部署)。
    base_url = body.get("baseUrl") or settings.gateway_base_url
    api_key = body.get("apiKey") or settings.gateway_api_key
    # 多轮:前端回传的会话 id(首轮为空 → stream_chat 生成并经 start 帧回传)。
    session_id = body.get("session") or None

    async def gen():
        async for frame in stream_chat(
            prompt=prompt,
            history=history,
            images=images,
            base_url=base_url,
            api_key=api_key,
            model=model,
            timeout=settings.gateway_request_timeout,
            session_id=session_id,
        ):
            yield {"data": json.dumps(frame, ensure_ascii=False)}

    return EventSourceResponse(gen())
