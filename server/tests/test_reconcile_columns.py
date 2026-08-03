"""build_add_column_sql:由模型列生成"安全补列"的 ALTER 语句(只增、NULLABLE)。"""

from sqlalchemy.dialects.postgresql import dialect as pg_dialect
from sqlmodel import SQLModel

from app import models  # noqa: F401 — 注册所有表到 SQLModel.metadata
from app.db import build_add_column_sql

PG = pg_dialect()


def _col(table: str, name: str):
    return SQLModel.metadata.tables[table].columns[name]


def test_nullable_text_column():
    sql = build_add_column_sql("questions", _col("questions", "target_skill"), PG)
    assert sql == 'ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "target_skill" VARCHAR'


def test_not_null_model_column_added_as_nullable_safely():
    # 模型里 kind 是 NOT NULL,但补列一律 NULLABLE(防止给有数据的表加列失败)。
    sql = build_add_column_sql("questions", _col("questions", "kind"), PG)
    assert sql.startswith('ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "kind" ')
    assert "NOT NULL" not in sql
    assert "DEFAULT" not in sql


def test_jsonb_column_type_compiles():
    sql = build_add_column_sql("questions", _col("questions", "data"), PG)
    assert 'ADD COLUMN IF NOT EXISTS "data"' in sql
    assert "JSONB" in sql.upper()
