"""设置 / 修改密码端点 /v1/auth/password。

覆盖:me 带 hasPassword 标记;已有密码改密码需校验当前密码、太短拒绝、改后新密码可登录;
Google 式无密码账户首次设置无需当前密码、设置后即可用密码登录;未登录被拒。
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _make_passwordless(email: str) -> tuple[str, str]:
    """直接建一个无密码账户(模拟 Google 建号)+ 一条会话,返回 (user_id, token)。"""
    from app.db import session_scope
    from app.models import AuthSession, User
    from app.security import hash_token

    token = "tok_" + uuid4().hex
    uid = uuid4().hex
    # 先建用户并提交,再建会话(sessions.user_id 有外键,必须用户先落库)。
    async with session_scope() as s:
        s.add(User(id=uid, email=email, password_hash="", name=email.split("@")[0]))
        await s.commit()
    async with session_scope() as s:
        s.add(
            AuthSession(
                id=uuid4().hex,
                token_hash=hash_token(token),
                user_id=uid,
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            )
        )
        await s.commit()
    return uid, token


async def test_me_has_password_flag(client, signup):
    await signup(client, "p1@test.local", "pw123456")
    me = await client.get("/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["hasPassword"] is True


async def test_change_password_requires_correct_current(client, signup):
    await signup(client, "p2@test.local", "pw123456")
    bad = await client.post(
        "/v1/auth/password", json={"password": "newpass12", "currentPassword": "WRONG"}
    )
    assert bad.status_code == 400
    ok = await client.post(
        "/v1/auth/password", json={"password": "newpass12", "currentPassword": "pw123456"}
    )
    assert ok.status_code == 200
    assert ok.json()["hasPassword"] is True
    # 新密码可登录、旧密码失败
    client.cookies.clear()
    assert (
        await client.post(
            "/v1/auth/login", json={"email": "p2@test.local", "password": "newpass12"}
        )
    ).status_code == 200
    client.cookies.clear()
    assert (
        await client.post(
            "/v1/auth/login", json={"email": "p2@test.local", "password": "pw123456"}
        )
    ).status_code == 401


async def test_password_too_short_rejected(client, signup):
    await signup(client, "p3@test.local", "pw123456")
    r = await client.post(
        "/v1/auth/password", json={"password": "short", "currentPassword": "pw123456"}
    )
    assert r.status_code == 400


async def test_passwordless_account_can_set_password(client):
    _, token = await _make_passwordless("g1@test.local")
    cookies = {"qa_session": token}
    me = await client.get("/v1/auth/me", cookies=cookies)
    assert me.status_code == 200
    assert me.json()["hasPassword"] is False
    # 无密码账户首次设置无需 currentPassword
    r = await client.post("/v1/auth/password", json={"password": "setpass12"}, cookies=cookies)
    assert r.status_code == 200, r.text
    assert r.json()["hasPassword"] is True
    # 设置后即可用邮箱 + 密码登录
    client.cookies.clear()
    assert (
        await client.post(
            "/v1/auth/login", json={"email": "g1@test.local", "password": "setpass12"}
        )
    ).status_code == 200


async def test_password_requires_auth(client):
    client.cookies.clear()
    r = await client.post("/v1/auth/password", json={"password": "whatever8"})
    assert r.status_code == 401
