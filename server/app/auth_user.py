"""登录会话依赖:读 qa_session Cookie → 查 sessions 表 → 取 active 用户。"""

from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import Cookie, Depends, HTTPException, Response, status
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from uuid import uuid4

from .config import settings
from .db import get_session
from .models import AuthSession, User
from .security import generate_token, hash_token

COOKIE_NAME = "qa_session"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def require_user(
    qa_session: str | None = Cookie(default=None),
    session: AsyncSession = Depends(get_session),
) -> User:
    if not qa_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录")
    th = hash_token(qa_session)
    sess = (
        await session.execute(select(AuthSession).where(AuthSession.token_hash == th))
    ).scalar_one_or_none()
    if not sess or sess.expires_at < _now():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="会话失效")
    user = await session.get(User, sess.user_id)
    if not user or user.status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号不可用")
    return user


CurrentUser = Annotated[User, Depends(require_user)]


async def issue_session(session: AsyncSession, response: Response, user: User) -> None:
    token = generate_token()
    expires = _now() + timedelta(days=settings.session_ttl_days)
    session.add(
        AuthSession(
            id=uuid4().hex,
            token_hash=hash_token(token),
            user_id=user.id,
            expires_at=expires,
        )
    )
    await session.commit()
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        max_age=settings.session_ttl_days * 86400,
        path="/",
    )


async def clear_user_sessions(session: AsyncSession, user_id: str) -> None:
    await session.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
    await session.commit()


async def get_owned(session: AsyncSession, model: Any, pk: str, user: User):
    """id-PK 表:取自己的行;不存在或非本人 → None(调用方据此 404,不泄露存在性)。"""
    row = await session.get(model, pk)
    if row is None or getattr(row, "owner_user_id", None) != user.id:
        return None
    return row
