from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from ..auth_user import CurrentUser, get_owned
from ..db import get_session
from ..models import Evaluation
from ._helpers import to_payload

router = APIRouter(prefix="/evaluations", tags=["evaluations"])


def _from_body(body: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": body["id"],
        "question_id": body["questionId"],
        "message_id": body["messageId"],
        "sub_index": body.get("subIndex"),
        "verdict": body.get("verdict") or "partial",
        "auto_score": body.get("autoScore"),
        "notes": body.get("notes") or "",
        "agent_profile_id": body.get("agentProfileId"),
        "judge_profile_id": body.get("judgeProfileId"),
        "model_version": body.get("modelVersion"),
        "data": body,
    }


@router.get("")
async def list_evaluations(
    session: AsyncSession = Depends(get_session),
    user: CurrentUser = ...,
    question_id: str | None = None,
):
    stmt = select(Evaluation).where(Evaluation.owner_user_id == user.id)
    if question_id:
        stmt = stmt.where(Evaluation.question_id == question_id)
    rows = (await session.execute(stmt)).scalars().all()
    return [to_payload(r) for r in rows]


@router.put("/{eid}")
async def upsert_evaluation(eid: str, body: dict[str, Any], session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    body["id"] = eid
    kwargs = _from_body(body)
    kwargs["owner_user_id"] = user.id
    existing = await session.get(Evaluation, eid)
    if existing is not None and existing.owner_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    if existing:
        for k, v in kwargs.items():
            setattr(existing, k, v)
        row = existing
    else:
        row = Evaluation(**kwargs)
        session.add(row)
    await session.commit()
    await session.refresh(row)
    return to_payload(row)


@router.delete("/{eid}")
async def delete_evaluation(eid: str, session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    row = await get_owned(session, Evaluation, eid, user)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await session.delete(row)
    await session.commit()
    return {"ok": True}
