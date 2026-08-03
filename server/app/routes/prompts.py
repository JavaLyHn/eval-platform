"""Prompt 管理:每个 prompt key 一行,自定义版本(不可变数组)+ 生效指针 + 变量定制。

内置默认(v1)在前端代码里,不落库;这里只存覆盖状态。
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from ..auth_user import CurrentUser
from ..db import get_session
from ..models import Prompt
from ._helpers import to_payload

router = APIRouter(prefix="/prompts", tags=["prompts"])


def _from_body(body: dict[str, Any]) -> dict[str, Any]:
    versions = body.get("versions")
    return {
        "id": body["id"],
        "active_version": body.get("activeVersion") or 1,
        "version_count": len(versions) if isinstance(versions, list) else 0,
        "data": body,
    }


@router.get("")
async def list_prompts(user: CurrentUser, session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(Prompt).where(Prompt.owner_user_id == user.id))).scalars().all()
    return [to_payload(r) for r in rows]


@router.put("/{pid}")
async def upsert_prompt(pid: str, body: dict[str, Any], user: CurrentUser, session: AsyncSession = Depends(get_session)):
    body["id"] = pid
    kwargs = _from_body(body)
    kwargs["owner_user_id"] = user.id
    existing = await session.get(Prompt, {"owner_user_id": user.id, "id": pid})
    if existing:
        for k, v in kwargs.items():
            setattr(existing, k, v)
        row = existing
    else:
        row = Prompt(**kwargs)
        session.add(row)
    await session.commit()
    await session.refresh(row)
    return to_payload(row)


@router.delete("/{pid}")
async def delete_prompt(pid: str, user: CurrentUser, session: AsyncSession = Depends(get_session)):
    row = await session.get(Prompt, {"owner_user_id": user.id, "id": pid})
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await session.delete(row)
    await session.commit()
    return {"ok": True}
