# ── 后端镜像:FastAPI + uvicorn(Python 3.12,用 uv 装锁定依赖)──
# 启动时 init_db() 自动建表(SQLModel create_all),无需迁移步骤。
# 仅供内部网络访问;不对宿主机映射端口,由前端 nginx 反代。
#
# 构建上下文 = 仓库根(见 docker-compose.yml server.build.context: .),
# 故所有 COPY 路径都带 server/ 前缀;同时把 SkillOpt 引擎纳入镜像。

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# uv:快速、按 uv.lock 复现安装
RUN pip install --no-cache-dir uv

# 先装后端依赖(利用层缓存);package=false 故不构建项目本身,只装依赖树
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev

# SkillOpt 子进程引擎:拷源码(~5MB;.venv/outputs/缓存已被根 .dockerignore 排除),
# 在 skillopt_runner 期望的精确路径 /app/SkillOpt/.venv 现建 Linux venv 并 editable
# 安装(一次装齐依赖 + 让 `import skillopt` 可用);outputs 目录预建好供运行时写入。
COPY SkillOpt /app/SkillOpt
RUN uv venv /app/SkillOpt/.venv \
 && uv pip install --python /app/SkillOpt/.venv/bin/python -e /app/SkillOpt \
 && mkdir -p /app/SkillOpt/outputs

# AI 员工源定义(agent-defs)固化进镜像 —— /skills-repo / 出题 等只读页读它(SAGE_REPO_DIR=/app/agent-defs)
COPY agent-defs /app/agent-defs

# 拷后端应用代码(放最后:改 app/ 不会让上面的依赖 / SkillOpt 层失效)
COPY server/app ./app

EXPOSE 18791
# 直接用 venv 里的 uvicorn(PATH 已含 /app/.venv/bin)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "18791"]
