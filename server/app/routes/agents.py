from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from ..auth_user import CurrentUser, get_owned
from ..db import get_session
from ..models import AgentProfile
from ._helpers import to_payload

router = APIRouter(prefix="/agents", tags=["agents"])


def _from_body(body: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": body["id"],
        "name": body.get("name") or "",
        "kind": body.get("type") or body.get("kind"),
        "is_active": bool(body.get("isActive") or False),
        "data": body,
    }


@router.get("")
async def list_agents(session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    stmt = select(AgentProfile).where(AgentProfile.owner_user_id == user.id)
    rows = (await session.execute(stmt)).scalars().all()
    return [to_payload(r) for r in rows]


@router.put("/{aid}")
async def upsert_agent(aid: str, body: dict[str, Any], session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    body["id"] = aid
    kwargs = _from_body(body)
    kwargs["owner_user_id"] = user.id
    existing = await session.get(AgentProfile, aid)
    if existing is not None and existing.owner_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    if existing:
        for k, v in kwargs.items():
            setattr(existing, k, v)
        row = existing
    else:
        row = AgentProfile(**kwargs)
        session.add(row)
    await session.commit()
    await session.refresh(row)
    return to_payload(row)


@router.post("/{aid}/activate")
async def set_active_agent(aid: str, session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    """Single-active invariant: clear current user's is_active, then set the chosen one."""
    row = await get_owned(session, AgentProfile, aid, user)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await session.execute(
        update(AgentProfile).where(AgentProfile.owner_user_id == user.id).values(is_active=False)
    )
    row.is_active = True
    await session.commit()
    await session.refresh(row)
    return to_payload(row)


@router.delete("/{aid}")
async def delete_agent(aid: str, session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    row = await get_owned(session, AgentProfile, aid, user)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await session.delete(row)
    await session.commit()
    return {"ok": True}
