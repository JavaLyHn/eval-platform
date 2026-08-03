from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from ..auth_user import CurrentUser, get_owned
from ..db import get_session
from ..models import Message
from ._helpers import to_payload

router = APIRouter(prefix="/conversations/{cid}/messages", tags=["messages"])


def _from_body(body: dict[str, Any], cid: str) -> dict[str, Any]:
    return {
        "id": body["id"],
        "conversation_id": cid,
        "role": body["role"],
        "content": body.get("content") or "",
        "question_id": body.get("questionId"),
        "agent_profile_id": body.get("agentProfileId"),
        "turn_index": body.get("turnIndex"),
        "turn_total": body.get("turnTotal"),
        "interrupted": bool(body.get("interrupted") or False),
        "duration_ms": body.get("durationMs"),
        "tokens": body.get("tokens"),
        "model_version": body.get("modelVersion"),
        "is_streaming": bool(body.get("isStreaming") or False),
        "data": body,
    }


@router.get("")
async def list_messages(cid: str, session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    stmt = select(Message).where(Message.conversation_id == cid).where(Message.owner_user_id == user.id).order_by(Message.created_at)
    rows = (await session.execute(stmt)).scalars().all()
    return [to_payload(r) for r in rows]


@router.put("/{mid}")
async def upsert_message(cid: str, mid: str, body: dict[str, Any], session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    body["id"] = mid
    kwargs = _from_body(body, cid)
    kwargs["owner_user_id"] = user.id
    existing = await session.get(Message, mid)
    if existing is not None and existing.owner_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    if existing:
        for k, v in kwargs.items():
            setattr(existing, k, v)
        row = existing
    else:
        row = Message(**kwargs)
        session.add(row)
    await session.commit()
    await session.refresh(row)
    return to_payload(row)


@router.delete("/{mid}")
async def delete_message(cid: str, mid: str, session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    row = await get_owned(session, Message, mid, user)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await session.delete(row)
    await session.commit()
    return {"ok": True}
