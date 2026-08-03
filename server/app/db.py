import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import inspect, text
from sqlalchemy.engine import Dialect
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.sql.schema import Column
from sqlmodel import SQLModel

from .config import settings

logger = logging.getLogger(__name__)

# Pin every connection's session timezone to Asia/Shanghai.
#
# Postgres still stores TIMESTAMPTZ in UTC internally (good — instant-stable),
# but every SELECT formats the value with +08:00 offset, and TIMESTAMP inputs
# without an explicit tz are interpreted as China time. Affects both reads and
# func.now() defaults, so created_at / updated_at land in CST by default.
engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    connect_args={"server_settings": {"timezone": "Asia/Shanghai"}},
)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


def build_add_column_sql(table_name: str, column: Column, dialect: Dialect) -> str:
    """生成"安全补列"的 ALTER 语句:只新增、一律 NULLABLE,绝不带 NOT NULL / DEFAULT。

    create_all 只建不存在的表、从不给已存在的表加列;故模型新增列后,旧库会缺列、
    导致 select(模型) 报 column does not exist → 500。这里启动时补回缺列。
    一律 NULLABLE:对有数据的表 ADD COLUMN 永不失败;新列默认值由应用层(_from_body
    的 `or 'agent'`、前端 `?? default`)兜底,全新库走 create_all 仍是正确的 NOT NULL/默认。
    """
    type_sql = column.type.compile(dialect=dialect)
    return f'ALTER TABLE "{table_name}" ADD COLUMN IF NOT EXISTS "{column.name}" {type_sql}'


async def _reconcile_missing_columns() -> None:
    """对每张已存在的表,补回"模型声明了但库里缺"的列(只增、NULLABLE)。每列独立 try,
    单列失败只告警、不阻断启动。"""
    async with engine.begin() as conn:
        def _collect_missing(sync_conn) -> list[tuple[str, Column]]:
            insp = inspect(sync_conn)
            existing_tables = set(insp.get_table_names())
            out: list[tuple[str, Column]] = []
            for table in SQLModel.metadata.sorted_tables:
                if table.name not in existing_tables:
                    continue  # create_all 刚建的新表已含全部列
                have = {c["name"] for c in insp.get_columns(table.name)}
                for column in table.columns:
                    if column.name not in have:
                        out.append((table.name, column))
            return out

        missing = await conn.run_sync(_collect_missing)
        for table_name, column in missing:
            sql = build_add_column_sql(table_name, column, conn.dialect)
            try:
                await conn.execute(text(sql))
                logger.warning("init_db reconciled missing column: %s", sql)
            except Exception:  # noqa: BLE001 — 单列失败不阻断启动
                logger.exception("init_db failed to add column %s.%s", table_name, column.name)


async def init_db() -> None:
    # Import models so SQLModel.metadata picks them up before create_all.
    from . import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

    # create_all 不会给已存在的表加新列 → 补回模型新增、旧库缺失的列(防 column-missing 500)。
    await _reconcile_missing_columns()

    # One-shot migration: move any kind=llm rows that historically landed in
    # `agent_profiles` over to the new `llm_profiles` table. Idempotent —
    # only moves rows whose id isn't already in llm_profiles, then deletes
    # them from agent_profiles. Safe to run on every startup.
    await _migrate_llm_rows_out_of_agents()


async def _migrate_llm_rows_out_of_agents() -> None:
    """Move any rows that should be LLMs from agent_profiles → llm_profiles.

    Implemented as a server-side INSERT...SELECT + DELETE so JSONB stays
    typed throughout (asyncpg refuses Python dicts for bind params with raw
    text() statements).
    """
    from sqlalchemy import text

    async with engine.begin() as conn:
        # Single-statement move: copy first, then delete. ON CONFLICT keeps
        # the migration idempotent across restarts.
        await conn.execute(
            text(
                """
                INSERT INTO llm_profiles (id, name, kind, owner_user_id, data, created_at, updated_at)
                SELECT id, name, kind, owner_user_id, data, COALESCE(created_at, now()), COALESCE(updated_at, now())
                FROM agent_profiles
                WHERE kind IN ('openai-compat', 'anthropic')
                   OR data->>'providerId' IN ('openai-compat', 'anthropic')
                ON CONFLICT (id) DO NOTHING
                """
            )
        )
        await conn.execute(
            text(
                """
                DELETE FROM agent_profiles
                WHERE kind IN ('openai-compat', 'anthropic')
                   OR data->>'providerId' IN ('openai-compat', 'anthropic')
                """
            )
        )


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
