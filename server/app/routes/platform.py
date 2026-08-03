import json
from typing import Any

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from ..config import settings
from ..platform_client import list_employees as platform_list_employees
from ..platform_client import list_skills as platform_list_skills
from ..platform_client import ping as platform_ping
from ..platform_client import stream_chat

router = APIRouter(prefix="/platform", tags=["platform"])


@router.get("/ping")
async def platform_ping_route(instanceId: str | None = None):
    """连通性探活,供前端 provider.ping() 调用。带 instanceId 时校验该实例本身。"""
    return await platform_ping(
        base_url=settings.platform_base_url,
        api_key=settings.platform_api_key,
        instance_id=instanceId,
    )


@router.get("/skills")
async def platform_skills_route(instanceId: str | None = None, templateId: str | None = None):
    """拉取技能列表,供前端展示 agent 技能。

    instanceId(优先) → 先解析实例取 templateId,再拉该模板技能。
    templateId → 直接拉该模板技能。
    均未给 → 拉全量。
    """
    return await platform_list_skills(
        base_url=settings.platform_base_url,
        api_key=settings.platform_api_key,
        instance_id=instanceId,
        template_id=templateId,
    )


@router.get("/employees")
async def platform_employees_route():
    """列出 Platform 账号里真实存在的员工(按 templateId 去重),供 Skill 评测页浏览面板用。"""
    return await platform_list_employees(
        base_url=settings.platform_base_url,
        api_key=settings.platform_api_key,
    )


@router.post("/chat")
async def platform_chat(body: dict[str, Any]):
    prompt = body.get("prompt") or ""
    session_token = body.get("session")
    instance_id = body.get("instanceId") or ""

    async def gen():
        async for frame in stream_chat(
            prompt=prompt,
            session_token=session_token,
            instance_id=instance_id,
            base_url=settings.platform_base_url,
            api_key=settings.platform_api_key,
            timeout=settings.platform_request_timeout,
            namespace=settings.platform_namespace,
            capture_tool_io=settings.capture_tool_io,
        ):
            yield {"data": json.dumps(frame, ensure_ascii=False)}

    return EventSourceResponse(gen())
