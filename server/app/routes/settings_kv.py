"""Generic key-value endpoint for misc client-side prefs (ui / categories /
user profile / default-criteria / last-generator-profile etc.).
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from ..auth_user import CurrentUser
from ..db import get_session
from ..models import Setting

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("")
async def list_settings(user: CurrentUser, session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(Setting).where(Setting.owner_user_id == user.id))).scalars().all()
    return {r.key: r.value for r in rows}


@router.get("/{key}")
async def get_setting(key: str, user: CurrentUser, session: AsyncSession = Depends(get_session)):
    row = await session.get(Setting, {"owner_user_id": user.id, "key": key})
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return {"key": key, "value": row.value}


@router.put("/{key}")
async def put_setting(key: str, body: dict[str, Any], user: CurrentUser, session: AsyncSession = Depends(get_session)):
    """Body should be {"value": <any-jsonable>}."""
    value = body.get("value")
    existing = await session.get(Setting, {"owner_user_id": user.id, "key": key})
    if existing:
        existing.value = value
    else:
        session.add(Setting(owner_user_id=user.id, key=key, value=value))
    await session.commit()
    return {"key": key, "value": value}


@router.delete("/{key}")
async def delete_setting(key: str, user: CurrentUser, session: AsyncSession = Depends(get_session)):
    row = await session.get(Setting, {"owner_user_id": user.id, "key": key})
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await session.delete(row)
    await session.commit()
    return {"ok": True}
