import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth_user import require_user
from .config import settings
from .db import init_db
from .routes import (
    agents,
    auth_routes,
    conversations,
    evaluations,
    gateway,
    llms,
    messages,
    migrate,
    platform,
    prompts,
    questions,
    reports,
    agent_repo,
    settings_kv,
    skill_reports,
    skillopt,
)


logger = logging.getLogger("eval-platform")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 数据库不可达(如本地没起 docker Postgres)不应让整个后端启动失败 ——
    # 以降级模式启动,前端仍可走 localStorage,依赖库的接口到时各自报错。
    try:
        await init_db()
    except Exception:
        logger.warning(
            "init_db 失败(数据库不可达?)—— 后端以降级模式启动,"
            "依赖数据库的接口会报错;起本地 Postgres 后重启即恢复。",
            exc_info=True,
        )
    yield


app = FastAPI(title="eval-platform server", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "eval-platform-server", "version": "0.1.0"}


app.include_router(auth_routes.router, prefix="/v1")  # 开放:不挂 require_user

api_deps = [Depends(require_user)]
app.include_router(questions.router, prefix="/v1", dependencies=api_deps)
app.include_router(conversations.router, prefix="/v1", dependencies=api_deps)
app.include_router(messages.router, prefix="/v1", dependencies=api_deps)
app.include_router(platform.router, prefix="/v1", dependencies=api_deps)
app.include_router(gateway.router, prefix="/v1", dependencies=api_deps)
app.include_router(agent_repo.router, prefix="/v1", dependencies=api_deps)
app.include_router(skillopt.router, prefix="/v1", dependencies=api_deps)
app.include_router(evaluations.router, prefix="/v1", dependencies=api_deps)
app.include_router(reports.router, prefix="/v1", dependencies=api_deps)
app.include_router(skill_reports.router, prefix="/v1", dependencies=api_deps)
app.include_router(agents.router, prefix="/v1", dependencies=api_deps)
app.include_router(llms.router, prefix="/v1", dependencies=api_deps)
app.include_router(settings_kv.router, prefix="/v1", dependencies=api_deps)
app.include_router(prompts.router, prefix="/v1", dependencies=api_deps)
app.include_router(migrate.router, prefix="/admin", dependencies=api_deps)
