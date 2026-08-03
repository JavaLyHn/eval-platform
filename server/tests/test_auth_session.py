"""登录/登出/会话测试。"""

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_login_wrong_password(client, signup):
    await signup(client, "a@test.local", "pw123456")
    r = await client.post("/v1/auth/login", json={"email": "a@test.local", "password": "WRONG"})
    assert r.status_code == 401


async def test_login_then_me(client, signup):
    await signup(client, "b@test.local", "pw123456")
    # 清掉 cookie,验证 login 重新发
    client.cookies.clear()
    r = await client.post("/v1/auth/login", json={"email": "b@test.local", "password": "pw123456"})
    assert r.status_code == 200
    me = await client.get("/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "b@test.local"


async def test_logout_invalidates_session(client, signup):
    await signup(client, "c@test.local", "pw123456")
    assert (await client.get("/v1/auth/me")).status_code == 200
    r = await client.post("/v1/auth/logout")
    assert r.status_code == 204
    # cookie 已被服务端清 + session 行已删 → me 401
    assert (await client.get("/v1/auth/me")).status_code == 401
