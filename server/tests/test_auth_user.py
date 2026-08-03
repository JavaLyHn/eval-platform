"""me 端点测试(Task 6 推迟到这里)。"""

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_me_requires_cookie(client):
    r = await client.get("/v1/auth/me")
    assert r.status_code == 401


async def test_me_returns_user_after_register(make_user):
    c = await make_user(email="aria@test.local")
    r = await c.get("/v1/auth/me")
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "aria@test.local"
    assert body["role"] == "member"
    assert "password_hash" not in body and "passwordHash" not in body
