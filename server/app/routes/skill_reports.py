"""Skill 评测报告快照 —— 用户跑完手动保存,只读。

存储形态镜像 EvaluationReport:id 主键 + JSONB data(全量前端对象)。
**logs 不入库**:_from_body 落库前清空 data.logs(原始 stdout 仅本机临时存档)。
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from ..auth_user import CurrentUser, get_owned
from ..db import get_session
from ..models import SkillEvalReport
from ._helpers import to_payload

router = APIRouter(prefix="/skill-reports", tags=["skill-reports"])


def _from_body(body: dict[str, Any]) -> dict[str, Any]:
    data = {**body, "logs": []}  # logs 不入 PG
    return {"id": body["id"], "data": data}


@router.get("")
async def list_skill_reports(session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    stmt = select(SkillEvalReport).where(SkillEvalReport.owner_user_id == user.id)
    rows = (await session.execute(stmt)).scalars().all()
    return [to_payload(r) for r in rows]


@router.get("/{rid}")
async def get_skill_report(rid: str, session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    row = await get_owned(session, SkillEvalReport, rid, user)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return to_payload(row)


@router.put("/{rid}")
async def upsert_skill_report(
    rid: str,
    body: dict[str, Any],
    session: AsyncSession = Depends(get_session),
    user: CurrentUser = ...,
):
    body["id"] = rid
    kwargs = _from_body(body)
    kwargs["owner_user_id"] = user.id
    existing = await session.get(SkillEvalReport, rid)
    if existing is not None and existing.owner_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    if existing:
        for k, v in kwargs.items():
            setattr(existing, k, v)
        row = existing
    else:
        row = SkillEvalReport(**kwargs)
        session.add(row)
    await session.commit()
    await session.refresh(row)
    return to_payload(row)


@router.delete("/{rid}")
async def delete_skill_report(rid: str, session: AsyncSession = Depends(get_session), user: CurrentUser = ...):
    row = await get_owned(session, SkillEvalReport, rid, user)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await session.delete(row)
    await session.commit()
    return {"ok": True}
