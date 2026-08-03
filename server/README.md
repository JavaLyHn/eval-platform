# eval-platform server

Postgres-backed REST API for the eval-platform frontend.
**FastAPI + SQLModel + asyncpg**, managed with `uv`.

## Topology

```
[ Vite SPA (5173/5174) ]  ──HTTP──►  [ FastAPI :18791 ]  ──asyncpg──►  [ postgres :5433 ]
                                                                          (docker container
                                                                           agent-evaluator-db-1,
                                                                           db = qa_platform)
```

## Quick start

```bash
cd server
uv sync                                   # install deps into .venv
uv run uvicorn app.main:app --reload \
    --host 127.0.0.1 --port 18791
```

Health check: <http://127.0.0.1:18791/health> · OpenAPI docs: <http://127.0.0.1:18791/docs>

## Config (`.env`)

```
DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/qa_platform
SERVER_PORT=18791
SERVER_TOKEN=                              # empty = open (dev). set for prod.
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174
```

## Schema strategy

Each table has typed indexed columns for hot filter fields (employee, severity,
status, etc.) plus a JSONB `data` column holding the full payload. Frontend
sends/receives the original TypeScript shape unchanged.

| Table | Hot columns | Notes |
| --- | --- | --- |
| `questions` | `target_employee_id`, `severity`, `intent`, `out_of_scope`, `status` | full Question payload in `data` |
| `conversations` | `active_question_id`, `agent_profile_id`, `gateway_session_id` | messages in own table |
| `messages` | `conversation_id (FK)`, `role`, `question_id`, `turn_index` | append-only style |
| `evaluations` | `question_id`, `message_id`, `verdict`, `judge_profile_id` | scores/annotations in `data` |
| `evaluation_plans` | `employee_id`, `plan_type`, `status`, `revision_of` | plan body in `data` |
| `agent_profiles` | `kind`, `is_active` | only one row should have `is_active=true` |
| `settings` | `key` (PK) | catch-all kv for ui / categories / user / etc. |

## Endpoints

| Method · Path | Purpose |
| --- | --- |
| `GET /health` | service liveness |
| `GET /v1/{entity}` | list (supports filter query params for `questions` / `plans`) |
| `GET /v1/{entity}/{id}` | fetch one |
| `PUT /v1/{entity}/{id}` | upsert |
| `DELETE /v1/{entity}/{id}` | delete |
| `GET /v1/conversations/{cid}/messages` | list messages of a conversation |
| `PUT /v1/conversations/{cid}/messages/{mid}` | upsert one message |
| `POST /v1/agents/{aid}/activate` | flip the single-active flag |
| `GET / PUT / DELETE /v1/settings/{key}` | generic kv |
| `POST /admin/migrate` | one-shot localStorage → DB (idempotent upsert per id) |

`entity` ∈ { questions, conversations, evaluations, plans, agents }.

## DB management

```bash
# inspect tables
docker exec agent-evaluator-db-1 psql -U postgres -d qa_platform -c "\dt"

# wipe (dev only — no Alembic yet)
docker exec agent-evaluator-db-1 psql -U postgres -c "DROP DATABASE qa_platform;"
docker exec agent-evaluator-db-1 psql -U postgres -c "CREATE DATABASE qa_platform;"
# then restart the server — init_db will recreate tables on startup
```

## Roadmap

**Phase 1 (current — shipped)**

- Schema + REST CRUD for all 7 tables.
- One-shot localStorage → DB migration via `POST /admin/migrate`.
- Frontend banner at top of UI offers the migration when local has data and DB is empty.
- localStorage remains primary read/write source — DB is a *destination* you push to.

**Phase 2 (next iteration)**

- App boot reads from DB → store state (replacing localStorage as truth).
- Every store mutation mirrors to server (debounced bulk PUT per entity type).
- Alembic migrations replace `create_all` on startup.
- Optional bearer-token auth (set `SERVER_TOKEN`).
