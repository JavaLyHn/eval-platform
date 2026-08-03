"""Evaluation report snapshots — user-triggered, read-only.

Storage shape mirrors `Evaluation`: typed columns for filterable fields
(`title`, `agent_profile_id`, `agent_name`) plus a JSONB `data` blob holding
the full frontend object (including `items[]`).
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from ..auth_user import CurrentUser, get_owned
from ..db import get_session
from ..models import EvaluationReport
from ._helpers import to_payload

router = APIRouter(prefix="/reports", tags=["reports"])


def _from_body(body: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": body["id"],
        "title": body.get("title") or "",
        "agent_profile_id": body.get("agentProfileId"),
        "agent_name": body.get("agentName") or "",
        "data": body,
    }


@router.get("")
async def list_reports(
    session: AsyncSession = Depends(get_session),
    user: CurrentUser = ...,
    agent_profile_id: str | None = None,
):
    stmt = select(EvaluationReport).where(EvaluationReport.owner_user_id == user.id)
    if agent_profile_id:
        stmt = stmt.where(EvaluationReport.agent_profile_id == agent_profile_id)
    rows = (await session.execute(stmt)).scalars().all()
    return [to_payload(r) for r in rows]


@router.get("/{rid}")
async def get_report(rid: str, session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    row = await get_owned(session, EvaluationReport, rid, user)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return to_payload(row)


@router.put("/{rid}")
async def upsert_report(
    rid: str,
    body: dict[str, Any],
    session: AsyncSession = Depends(get_session),
    user: CurrentUser = ...,
):
    body["id"] = rid
    kwargs = _from_body(body)
    kwargs["owner_user_id"] = user.id
    existing = await session.get(EvaluationReport, rid)
    if existing is not None and existing.owner_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    if existing:
        for k, v in kwargs.items():
            setattr(existing, k, v)
        row = existing
    else:
        row = EvaluationReport(**kwargs)
        session.add(row)
    await session.commit()
    await session.refresh(row)
    return to_payload(row)


@router.delete("/{rid}")
async def delete_report(rid: str, session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    row = await get_owned(session, EvaluationReport, rid, user)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await session.delete(row)
    await session.commit()
    return {"ok": True}
