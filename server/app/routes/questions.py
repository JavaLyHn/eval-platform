from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from ..auth_user import CurrentUser, get_owned
from ..db import get_session
from ..models import Question
from ._helpers import to_payload

router = APIRouter(prefix="/questions", tags=["questions"])


def _from_body(body: dict[str, Any]) -> dict[str, Any]:
    """Map frontend's camelCase entity to ORM kwargs."""
    return {
        "id": body["id"],
        "target_employee_id": body.get("targetEmployeeId"),
        "severity": body.get("severity"),
        "intent": body.get("intent"),
        "out_of_scope": bool(body.get("outOfScope") or False),
        "status": body.get("status") or "untested",
        "kind": body.get("kind") or "agent",
        "target_skill": body.get("targetSkill"),
        "data": body,
    }


@router.get("")
async def list_questions(
    session: AsyncSession = Depends(get_session),
    user: CurrentUser = ...,
    employee: str | None = None,
    severity: str | None = None,
    intent: str | None = None,
    out_of_scope: bool | None = None,
    kind: str | None = None,
    skill: str | None = None,
):
    stmt = select(Question).where(Question.owner_user_id == user.id)
    if employee:
        stmt = stmt.where(Question.target_employee_id == employee)
    if severity:
        stmt = stmt.where(Question.severity == severity)
    if intent:
        stmt = stmt.where(Question.intent == intent)
    if out_of_scope is not None:
        stmt = stmt.where(Question.out_of_scope == out_of_scope)
    if kind:
        stmt = stmt.where(Question.kind == kind)
    if skill:
        stmt = stmt.where(Question.target_skill == skill)
    rows = (await session.execute(stmt)).scalars().all()
    return [to_payload(r) for r in rows]


@router.get("/{qid}")
async def get_question(qid: str, session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    row = await get_owned(session, Question, qid, user)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return to_payload(row)


@router.put("/{qid}")
async def upsert_question(qid: str, body: dict[str, Any], session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    if body.get("id") and body["id"] != qid:
        raise HTTPException(status_code=400, detail="id mismatch")
    body["id"] = qid
    kwargs = _from_body(body)
    kwargs["owner_user_id"] = user.id
    existing = await session.get(Question, qid)
    # owner=NULL(pre-auth / seed 老数据)视为无主 → 允许当前用户认领(下面 setattr 会写上
    # owner_user_id=user.id,与 migrate.py 的 _upsert 口径一致);只有归属【别的真实用户】
    # 才拒绝覆盖(防劫持)。修复:无主行曾被 `!= user.id` 误判 404,outbox 重试进死信。
    if (
        existing is not None
        and existing.owner_user_id is not None
        and existing.owner_user_id != user.id
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    if existing:
        for k, v in kwargs.items():
            setattr(existing, k, v)
        row = existing
    else:
        row = Question(**kwargs)
        session.add(row)
    await session.commit()
    await session.refresh(row)
    return to_payload(row)


@router.delete("/{qid}")
async def delete_question(qid: str, session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    row = await get_owned(session, Question, qid, user)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await session.delete(row)
    await session.commit()
    return {"ok": True}
