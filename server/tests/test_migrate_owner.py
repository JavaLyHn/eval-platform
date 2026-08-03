"""Task 14: migrate 按用户打 owner + 复合主键适配。

TDD: 先写失败测试(RED), 改 migrate.py 后变绿(GREEN)。
"""

import pytest
import pytest_asyncio


@pytest.mark.asyncio(loop_scope="session")
async def test_migrate_stamps_owner(make_user):
    a = await make_user(email="ma@test.local")
    b = await make_user(email="mb@test.local")
    dump = {
        "questions": [{"id": "mq1", "prompt": "x", "title": "t"}],
        "settings": {"ui": {"theme": "dark"}},
    }
    r = await a.post("/admin/migrate", json=dump)
    assert r.status_code == 200
    # A 看得到导入的题与设置,B 看不到
    assert any(x["id"] == "mq1" for x in (await a.get("/v1/questions")).json())
    assert (await b.get("/v1/questions")).json() == []
    assert (await a.get("/v1/settings")).json() == {"ui": {"theme": "dark"}}
    assert (await b.get("/v1/settings")).json() == {}
