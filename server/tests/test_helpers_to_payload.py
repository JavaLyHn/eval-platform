"""I-1:to_payload 不应该用入库时刻覆盖客户端事件时刻 createdAt。

纯函数测试,不需要数据库——to_payload 只用 getattr 读字段,用 SimpleNamespace 假装一行即可。
"""

from datetime import datetime, timezone
from types import SimpleNamespace

from app.routes._helpers import _to_display, to_payload

_COL_TS = datetime(2026, 7, 25, 10, 0, 0, tzinfo=timezone.utc)  # 入库时刻(列值)


def test_created_at_prefers_client_value_in_data():
    """data 里已有客户端写入的 createdAt → 不被列值(入库时刻)覆盖。"""
    row = SimpleNamespace(
        data={"id": "m1", "createdAt": "2026-07-25T09:00:00.000Z"},
        created_at=_COL_TS,
    )
    out = to_payload(row)
    assert out["createdAt"] == "2026-07-25T09:00:00.000Z"


def test_created_at_falls_back_to_column_when_data_missing_it():
    """data 里没有 createdAt(极旧/异常写入路径)→ 退回列值兜底,行为不变。"""
    row = SimpleNamespace(data={"id": "m1"}, created_at=_COL_TS)
    out = to_payload(row)
    assert out["createdAt"] == _to_display(_COL_TS)


def test_created_at_falls_back_when_data_value_is_falsy():
    """data 里 createdAt 是空字符串/None(视为"没有")→ 仍退回列值,不留空字符串。"""
    row = SimpleNamespace(data={"id": "m1", "createdAt": ""}, created_at=_COL_TS)
    out = to_payload(row)
    assert out["createdAt"] != ""


def test_updated_at_still_overridden_by_column():
    """updatedAt / submittedAt / lockedAt 三个字段行为不变——仍然用列值覆盖 data 里的值。"""
    row = SimpleNamespace(
        data={"id": "m1", "updatedAt": "2020-01-01T00:00:00.000Z"},
        updated_at=_COL_TS,
    )
    out = to_payload(row)
    assert out["updatedAt"] != "2020-01-01T00:00:00.000Z"
