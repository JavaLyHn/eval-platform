"""无主(owner_user_id=NULL)题目的认领 —— 修 outbox upsert 撞 404 死信。

线上现象:pre-auth / seed 老数据的 questions 行 owner_user_id 为 NULL,任何登录用户
PUT 它都被 `!= user.id` 判 404 → outbox 重试 8 次进死信。修复:owner=NULL 视为无主,
允许当前用户认领;只有归属【别的真实用户】才 404(防劫持,保持既有隔离)。
"""

import pytest


@pytest.mark.asyncio(loop_scope="session")
async def test_null_owner_question_claimed_on_upsert(make_user):
    from app.db import session_scope
    from app.models import Question

    # 直接插一条无主题(模拟 pre-auth / seed 老数据;API 无法造 NULL owner)。
    async with session_scope() as s:
        s.add(
            Question(
                id="qnull",
                owner_user_id=None,
                data={"id": "qnull", "title": "老题", "prompt": "p"},
            )
        )
        await s.commit()

    a = await make_user(email="claim@test.local")
    # 修复前:404(owner=None != user.id);修复后:认领成功 200。
    r = await a.put("/v1/questions/qnull", json={"id": "qnull", "prompt": "p2", "title": "t2"})
    assert r.status_code == 200, r.text
    # 认领后归 A、A 的列表能看到。
    rows = (await a.get("/v1/questions")).json()
    assert any(x["id"] == "qnull" for x in rows), "认领后 A 应能看到该题"


@pytest.mark.asyncio(loop_scope="session")
async def test_real_other_owner_still_404(make_user):
    # 回归:归属【别的真实用户】的题,B 仍不能用同 id 覆盖(防劫持)。
    a = await make_user(email="owner-a@test.local")
    b = await make_user(email="owner-b@test.local")
    assert (await a.put("/v1/questions/qreal", json={"id": "qreal", "prompt": "p", "title": "t"})).status_code == 200
    assert (
        await b.put("/v1/questions/qreal", json={"id": "qreal", "prompt": "hijack", "title": "t"})
    ).status_code == 404
