"""登录/鉴权端点:/v1/auth/*。本路由不挂全局 require_user(开放注册/登录)。"""

import logging
import secrets
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from .. import google_oauth
from ..auth_user import COOKIE_NAME, issue_session, require_user
from ..config import settings
from ..db import get_session
from ..models import AuthSession, User
from ..security import hash_password, hash_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

# Google OAuth state(防 CSRF)cookie 名;只在 /v1/auth/google 路径下生效。
STATE_COOKIE = "g_oauth_state"


def _public_user(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "avatarUrl": user.avatar_url,
        # 前端据此显示「设置密码」(Google 建的无密码账户)还是「修改密码」。
        "hasPassword": bool(user.password_hash),
    }


@router.post("/login")
async def login(body: dict[str, Any], response: Response, session: AsyncSession = Depends(get_session)):
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    user = (
        await session.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()
    if (
        not user
        or user.status != "active"
        or not user.password_hash  # Google 建的无密码账户:不能用密码登录
        or not verify_password(password, user.password_hash)
    ):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    await issue_session(session, response, user)
    return _public_user(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    qa_session: str | None = Cookie(default=None),
    session: AsyncSession = Depends(get_session),
):
    if qa_session:
        await session.execute(
            delete(AuthSession).where(AuthSession.token_hash == hash_token(qa_session))
        )
        await session.commit()
    response.delete_cookie(COOKIE_NAME, path="/")


@router.get("/me")
async def me(user: User = Depends(require_user)):
    return _public_user(user)


@router.post("/password")
async def set_password(
    body: dict[str, Any],
    user: User = Depends(require_user),
    session: AsyncSession = Depends(get_session),
):
    """设置 / 修改当前登录用户的密码。

    Google 建的无密码账户首次设置无需旧密码;已有密码的账户必须校验当前密码。
    设置后即可用「邮箱 + 密码」登录(Google 登录仍可用)。user 与 session 同源
    (FastAPI 依赖缓存),改字段后 commit 即落库。
    """
    new_pw = body.get("password") or ""
    if len(new_pw) < 8:
        raise HTTPException(status_code=400, detail="密码至少 8 位")
    if user.password_hash:
        current = body.get("currentPassword") or ""
        if not verify_password(current, user.password_hash):
            raise HTTPException(status_code=400, detail="当前密码不正确")
    user.password_hash = hash_password(new_pw)
    await session.commit()
    return _public_user(user)


@router.post("/profile")
async def update_profile(
    body: dict[str, Any],
    user: User = Depends(require_user),
    session: AsyncSession = Depends(get_session),
):
    """更新当前登录用户的资料:姓名 / 头像。

    只动 name / avatar_url —— **刻意不碰 role**(它是鉴权角色,非首页那个「职位」)、
    也不碰 email / status。name 传空串视为「不修改」(避免误清);头像可显式传空串移除。
    user 与 session 同源(FastAPI 依赖缓存),改字段后 commit 即落库。
    """
    if "name" in body:
        name = (body.get("name") or "").strip()
        if name:
            if len(name) > 100:
                raise HTTPException(status_code=400, detail="姓名过长(上限 100 字)")
            user.name = name
    if "avatarUrl" in body:
        user.avatar_url = body.get("avatarUrl") or ""
    await session.commit()
    return _public_user(user)


@router.get("/google/login")
async def google_login():
    """整页跳转入口:未配置凭据 → 回登录页提示;已配置 → 跳 Google 授权页。"""
    if not google_oauth.is_configured():
        return RedirectResponse("/login?error=google_not_configured", status_code=302)
    state = secrets.token_urlsafe(24)
    resp = RedirectResponse(google_oauth.build_authorize_url(state), status_code=302)
    resp.set_cookie(
        key=STATE_COOKIE,
        value=state,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        max_age=600,
        path="/v1/auth/google",
    )
    return resp


@router.get("/google/callback")
async def google_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    g_oauth_state: str | None = Cookie(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Google 回调:校验 state → 换 token/userinfo → 按 email 找/建号 → 签 session → 回 /。"""

    def _fail(reason: str) -> RedirectResponse:
        r = RedirectResponse(f"/login?error={reason}", status_code=302)
        r.delete_cookie(STATE_COOKIE, path="/v1/auth/google")
        return r

    if error or not code:
        return _fail("google_failed")
    if not state or not g_oauth_state or not secrets.compare_digest(state, g_oauth_state):
        return _fail("google_state")
    try:
        token = await google_oauth.exchange_code(code)
        info = await google_oauth.fetch_userinfo(token["access_token"])
    except Exception:  # noqa: BLE001 — 任何上游失败都回登录页,不暴露细节
        logging.getLogger("eval-platform").exception("Google OAuth 失败")
        return _fail("google_failed")

    email = info["email"]
    picture = info.get("picture") or ""
    user = (
        await session.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()
    if user is None:
        # 不查允许名单:任意 Google 账号首次登录即自动建号(无密码)。
        user = User(
            id=uuid4().hex,
            email=email,
            password_hash="",
            name=info.get("name") or email.split("@")[0],
            avatar_url=picture,
        )
        session.add(user)
        await session.commit()
    elif user.status != "active":
        return _fail("google_failed")
    elif picture and user.avatar_url != picture:
        # 已有账户:用 Google 头像刷新(保持最新)
        user.avatar_url = picture
        await session.commit()

    redirect = RedirectResponse("/", status_code=302)
    await issue_session(session, redirect, user)  # 把 qa_session cookie 设到重定向响应上
    redirect.delete_cookie(STATE_COOKIE, path="/v1/auth/google")
    return redirect
