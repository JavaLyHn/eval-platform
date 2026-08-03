"""异步集成测试 harness:专用测试库 + ASGITransport 客户端 + 认证客户端工厂。

测试库:本地 Postgres(127.0.0.1:5433,postgres/postgres)上的 qa_platform_test,
自动创建/建表/每个 test 前清空。不碰 dev 库 qa_platform。

loop_scope 策略:所有 async fixture 均使用 "session" loop scope,确保同一个
event loop 贯穿整个测试会话 —— engine(asyncpg 连接池)在同一 loop 内创建和使用,
避免跨 loop 的 "another operation is in progress" 错误。
"""

import os

# 必须在导入任何 app.* 之前设好 env(config 在 import 时实例化 settings)。
os.environ["DATABASE_URL"] = (
    "postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/qa_platform_test"
)
os.environ["AUTH_ALLOWED_EMAIL_DOMAINS"] = "test.local"
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["SERVER_TOKEN"] = ""

from uuid import uuid4  # noqa: E402

import asyncpg  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402


async def _create_user_row(email: str, password: str) -> None:
    """直接在库里建一个密码用户(register 端点已移除,测试不再依赖它)。"""
    from app.db import session_scope
    from app.models import User
    from app.security import hash_password

    async with session_scope() as s:
        s.add(
            User(
                id=uuid4().hex,
                email=email,
                password_hash=hash_password(password),
                name=email.split("@")[0],
            )
        )
        await s.commit()


async def _ensure_test_db() -> None:
    sys_dsn = "postgresql://postgres:postgres@127.0.0.1:5433/postgres"
    conn = await asyncpg.connect(sys_dsn)
    try:
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1", "qa_platform_test"
        )
        if not exists:
            await conn.execute("CREATE DATABASE qa_platform_test")
    finally:
        await conn.close()


@pytest_asyncio.fixture(scope="session", loop_scope="session", autouse=True)
async def _schema():
    await _ensure_test_db()
    from app import models  # noqa: F401 — 注册全部表
    from app.db import engine
    from sqlmodel import SQLModel

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)
        await conn.run_sync(SQLModel.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def _clean_tables(_schema):
    """每个 test 前清空所有表(TRUNCATE ... CASCADE)。"""
    from app.db import engine
    from sqlmodel import SQLModel
    from sqlalchemy import text

    names = ", ".join(f'"{t.name}"' for t in SQLModel.metadata.sorted_tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
    yield


@pytest_asyncio.fixture(loop_scope="session")
async def client():
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(loop_scope="session")
async def make_user():
    from app.main import app

    created: list[AsyncClient] = []

    async def _make(email: str = "u1@test.local", password: str = "pw123456") -> AsyncClient:
        await _create_user_row(email, password)
        transport = ASGITransport(app=app)
        c = AsyncClient(transport=transport, base_url="http://test")
        r = await c.post("/v1/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        created.append(c)
        return c

    yield _make
    for c in created:
        await c.aclose()


@pytest_asyncio.fixture(loop_scope="session")
async def signup():
    """建用户并在给定 client 上登录(替代已移除的 register 端点)。返回 email。"""

    async def _signup(
        client: AsyncClient, email: str = "u@test.local", password: str = "pw123456"
    ) -> str:
        await _create_user_row(email, password)
        r = await client.post("/v1/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        return email

    return _signup
