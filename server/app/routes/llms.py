"""LLM profile routes.

`agent_profiles` and `llm_profiles` are two separate tables — agents are
被测对象 (走 bridge 的完整智能体), LLMs are pure model endpoints used as
裁判 / AI 出题 / 反思. See models.py for the rationale.

The wire shape on the frontend is unified (`AgentProfile` type with `providerId`),
so this route mirrors `agents.py` almost line-for-line; only the SQLModel and
the prefix change.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from ..auth_user import CurrentUser, get_owned
from ..db import get_session
from ..models import LLMProfile
from ._helpers import to_payload

router = APIRouter(prefix="/llms", tags=["llms"])


def _from_body(body: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": body["id"],
        "name": body.get("name") or "",
        "kind": body.get("type") or body.get("kind"),
        "data": body,
    }


@router.get("")
async def list_llms(session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    stmt = select(LLMProfile).where(LLMProfile.owner_user_id == user.id)
    rows = (await session.execute(stmt)).scalars().all()
    return [to_payload(r) for r in rows]


@router.put("/{lid}")
async def upsert_llm(lid: str, body: dict[str, Any], session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    body["id"] = lid
    kwargs = _from_body(body)
    kwargs["owner_user_id"] = user.id
    existing = await session.get(LLMProfile, lid)
    if existing is not None and existing.owner_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    if existing:
        for k, v in kwargs.items():
            setattr(existing, k, v)
        row = existing
    else:
        row = LLMProfile(**kwargs)
        session.add(row)
    await session.commit()
    await session.refresh(row)
    return to_payload(row)


@router.delete("/{lid}")
async def delete_llm(lid: str, session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    row = await get_owned(session, LLMProfile, lid, user)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await session.delete(row)
    await session.commit()
    return {"ok": True}
