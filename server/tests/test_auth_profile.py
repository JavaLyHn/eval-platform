"""更新资料端点 /v1/auth/profile。

覆盖:改 name(带 trim)落库且 me 反映;空名不清空(忽略);**绝不改鉴权 role**
(即便恶意传 role);头像可设可清;未登录被拒。
"""

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_update_name_persists(client, signup):
    await signup(client, "pf1@test.local", "pw123456")
    r = await client.post("/v1/auth/profile", json={"name": "  新名字  "})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "新名字"  # 前后空白被 trim
    me = await client.get("/v1/auth/me")
    assert me.json()["name"] == "新名字"  # me 反映新名字 → 跨设备一致


async def test_empty_name_does_not_wipe(client, signup):
    await signup(client, "pf2@test.local", "pw123456")
    await client.post("/v1/auth/profile", json={"name": "保留我"})
    r = await client.post("/v1/auth/profile", json={"name": "   "})
    assert r.status_code == 200
    assert r.json()["name"] == "保留我"  # 空名被忽略,不清空既有名字


async def test_profile_never_touches_role(client, signup):
    await signup(client, "pf3@test.local", "pw123456")
    before = (await client.get("/v1/auth/me")).json()["role"]
    # 即便请求体里塞 role,端点也不能改鉴权角色(防越权)。
    r = await client.post("/v1/auth/profile", json={"name": "x", "role": "admin"})
    assert r.status_code == 200
    assert r.json()["role"] == before  # 仍是 member,未被 "admin" 覆盖


async def test_avatar_set_and_clear(client, signup):
    await signup(client, "pf4@test.local", "pw123456")
    r = await client.post(
        "/v1/auth/profile", json={"avatarUrl": "data:image/png;base64,AAA"}
    )
    assert r.json()["avatarUrl"] == "data:image/png;base64,AAA"
    r2 = await client.post("/v1/auth/profile", json={"avatarUrl": ""})
    assert r2.json()["avatarUrl"] == ""  # 显式空串可移除头像


async def test_name_too_long_rejected(client, signup):
    await signup(client, "pf5@test.local", "pw123456")
    r = await client.post("/v1/auth/profile", json={"name": "名" * 101})
    assert r.status_code == 400


async def test_profile_requires_auth(client):
    client.cookies.clear()
    r = await client.post("/v1/auth/profile", json={"name": "x"})
    assert r.status_code == 401
