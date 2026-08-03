from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from ..auth_user import CurrentUser, get_owned
from ..db import get_session
from ..models import Conversation
from ._helpers import to_payload

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _from_body(body: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": body["id"],
        "title": body.get("title") or "",
        "active_question_id": body.get("activeQuestionId"),
        "gateway_session_id": body.get("gatewaySessionId"),
        "agent_profile_id": body.get("agentProfileId"),
        "data": body,
    }


@router.get("")
async def list_conversations(session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    stmt = select(Conversation).where(Conversation.owner_user_id == user.id)
    rows = (await session.execute(stmt)).scalars().all()
    return [to_payload(r) for r in rows]


@router.get("/{cid}")
async def get_conversation(cid: str, session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    row = await get_owned(session, Conversation, cid, user)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return to_payload(row)


@router.put("/{cid}")
async def upsert_conversation(cid: str, body: dict[str, Any], session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    if body.get("id") and body["id"] != cid:
        raise HTTPException(status_code=400, detail="id mismatch")
    body["id"] = cid
    kwargs = _from_body(body)
    kwargs["owner_user_id"] = user.id
    existing = await session.get(Conversation, cid)
    if existing is not None and existing.owner_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    if existing:
        for k, v in kwargs.items():
            setattr(existing, k, v)
        row = existing
    else:
        row = Conversation(**kwargs)
        session.add(row)
    await session.commit()
    await session.refresh(row)
    return to_payload(row)


@router.delete("/{cid}")
async def delete_conversation(cid: str, session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    row = await get_owned(session, Conversation, cid, user)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await session.delete(row)
    await session.commit()
    return {"ok": True}
