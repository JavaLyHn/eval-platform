"""Shared helpers for hybrid (typed-col + JSONB data) entity routes."""

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlmodel import SQLModel

_TS_FIELDS_CAMEL = {
    "created_at": "createdAt",
    "updated_at": "updatedAt",
    "submitted_at": "submittedAt",
    "locked_at": "lockedAt",
}

# Project-wide display timezone. Storage stays TIMESTAMPTZ (UTC internally) —
# we only re-anchor on serialization so API consumers see China time directly.
DISPLAY_TZ = ZoneInfo("Asia/Shanghai")


def _to_display(dt: datetime) -> str:
    """Convert a (possibly naive) datetime to Asia/Shanghai ISO format."""
    if dt.tzinfo is None:
        # asyncpg should always return aware datetimes for TIMESTAMPTZ; this
        # branch only fires if a model snuck in a naive timestamp.
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(DISPLAY_TZ).isoformat()


def to_payload(row: SQLModel, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return the row as the frontend-shaped dict.

    The original full payload lives in `data` (JSONB). Typed columns are
    duplicated there on write, so we just return `data` and overlay the
    server-managed timestamps converted to camelCase ISO strings (CST).
    """
    base: dict[str, Any] = {}
    data = getattr(row, "data", None)
    if isinstance(data, dict):
        base.update(data)

    for snake, camel in _TS_FIELDS_CAMEL.items():
        val = getattr(row, snake, None)
        if not isinstance(val, datetime):
            continue
        # I-1:createdAt 是客户端的事件时刻(消息真正发生的那一刻),列值 created_at
        # 只是这一行入库的时刻——两者在设备时钟偏移、outbox 失败退避重排、6 路并发排空时
        # (见 outbox.ts flush())都可能不一致,尤其是 Postgres func.now() 取的是事务开始
        # 时刻,同一轮问答的 user/assistant 两行入库序都可能颠倒。data(JSONB)里本来就存着
        # 客户端写入时的原始 createdAt,只是被这里的列值覆盖丢弃了——现在改成"data 里已经
        # 有 createdAt 就不要用列值覆盖"。这对历史行也是追溯修正(老数据的 data 里早就存着
        # 正确值);只有 data 里压根没有 createdAt 的行(极旧/异常写入路径)才退回列值兜底。
        # updatedAt / submittedAt / lockedAt 三个字段是服务器管的,不受影响,继续用列值覆盖。
        if snake == "created_at" and base.get(camel):
            continue
        base[camel] = _to_display(val)

    if extra:
        base.update(extra)
    return base
