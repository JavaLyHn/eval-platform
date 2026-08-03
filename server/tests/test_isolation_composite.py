"""Task 13 — 复合主键隔离测试:prompts / settings 按用户作用域。

两人写同一 key,互不覆盖;跨用户 get → 404。
"""

import pytest
import pytest_asyncio


pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_prompts_isolated(make_user):
    a = await make_user(email="pa@test.local")
    b = await make_user(email="pb@test.local")
    # 两人都定制同一 prompt key "llm-judge",互不覆盖
    await a.put("/v1/prompts/llm-judge", json={"id": "llm-judge", "activeVersion": 2, "versions": [{"v": 1}, {"v": 2}]})
    await b.put("/v1/prompts/llm-judge", json={"id": "llm-judge", "activeVersion": 1, "versions": [{"v": 1}]})
    a_rows = (await a.get("/v1/prompts")).json()
    b_rows = (await b.get("/v1/prompts")).json()
    assert len(a_rows) == 1 and a_rows[0]["activeVersion"] == 2
    assert len(b_rows) == 1 and b_rows[0]["activeVersion"] == 1


async def test_settings_isolated(make_user):
    a = await make_user(email="sa@test.local")
    b = await make_user(email="sb@test.local")
    await a.put("/v1/settings/ui", json={"value": {"theme": "dark"}})
    assert (await a.get("/v1/settings")).json() == {"ui": {"theme": "dark"}}
    assert (await b.get("/v1/settings")).json() == {}            # B 看不到 A 的
    assert (await b.get("/v1/settings/ui")).status_code == 404
