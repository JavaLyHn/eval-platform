"""Task 12: id-PK 实体路由隔离测试 — 验证每用户独立作用域。"""

import pytest


@pytest.mark.asyncio(loop_scope="session")
async def test_questions_isolated_between_users(make_user):
    a = await make_user(email="qa@test.local")
    b = await make_user(email="qb@test.local")
    # A 建一道题
    r = await a.put("/v1/questions/q1", json={"id": "q1", "prompt": "hi", "title": "t"})
    assert r.status_code == 200
    # A 看得到,B 看不到
    assert any(x["id"] == "q1" for x in (await a.get("/v1/questions")).json())
    assert (await b.get("/v1/questions")).json() == []
    # B get/delete A 的题 → 404
    assert (await b.get("/v1/questions/q1")).status_code == 404
    assert (await b.delete("/v1/questions/q1")).status_code == 404
    # B 不能用同 id 覆盖 A 的题(防劫持)
    assert (await b.put("/v1/questions/q1", json={"id": "q1", "prompt": "hijack", "title": "t"})).status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_agents_activate_scoped(make_user):
    a = await make_user(email="aa@test.local")
    b = await make_user(email="ab@test.local")
    await a.put("/v1/agents/ag1", json={"id": "ag1", "name": "A1", "isActive": True})
    await b.put("/v1/agents/bg1", json={"id": "bg1", "name": "B1", "isActive": True})
    # A 激活自己的 ag1 不应动到 B 的 bg1
    await a.post("/v1/agents/ag1/activate")
    b_rows = (await b.get("/v1/agents")).json()
    assert any(x["id"] == "bg1" and x.get("isActive") for x in b_rows), "B 的激活态被串改了"


@pytest.mark.asyncio(loop_scope="session")
async def test_evaluations_and_reports_isolated(make_user):
    a = await make_user(email="ea@test.local")
    b = await make_user(email="eb@test.local")
    await a.put("/v1/evaluations/e1", json={"id": "e1", "questionId": "q", "messageId": "m", "verdict": "passed"})
    await a.put("/v1/reports/rp1", json={"id": "rp1", "title": "T"})
    assert (await b.get("/v1/evaluations")).json() == []
    assert (await b.get("/v1/reports")).json() == []
    assert (await b.get("/v1/reports/rp1")).status_code == 404
