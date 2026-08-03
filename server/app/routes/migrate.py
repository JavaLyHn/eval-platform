"""One-shot localStorage → postgres migration.

Frontend POSTs a single JSON dump of every persistence key. Server upserts each
entity by id. Idempotent — safe to retry. Returns per-bucket counts.
"""

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth_user import CurrentUser
from ..db import get_session
from ..models import (
    AgentProfile,
    Conversation,
    Evaluation,
    EvaluationReport,
    LLMProfile,
    Message,
    Question,
    Setting,
)
from .agents import _from_body as agent_from_body
from .conversations import _from_body as conv_from_body
from .evaluations import _from_body as eval_from_body
from .llms import _from_body as llm_from_body
from .messages import _from_body as msg_from_body
from .questions import _from_body as q_from_body
from .reports import _from_body as report_from_body

# Provider ids that map to the LLM table (kind=llm). Anything else lands in
# agent_profiles. Keep this list in sync with the frontend's providers/registry.
LLM_PROVIDER_IDS = {"openai-compat", "anthropic"}

router = APIRouter(prefix="/migrate", tags=["migrate"])


async def _upsert(session: AsyncSession, Model, pk_value: str, kwargs: dict[str, Any], owner_user_id: str) -> bool:
    kwargs = {**kwargs, "owner_user_id": owner_user_id}
    existing = await session.get(Model, pk_value)
    if existing is not None and getattr(existing, "owner_user_id", None) not in (None, owner_user_id):
        return False  # 别人的行,不动
    if existing:
        for k, v in kwargs.items():
            setattr(existing, k, v)
        return False
    session.add(Model(**kwargs))
    return True


@router.post("")
async def migrate(body: dict[str, Any], user: CurrentUser, session: AsyncSession = Depends(get_session)):
    """Body shape (all optional):
    {
      "questions": [Question, ...],
      "conversations": [Conversation, ...],   # each has nested messages[]
      "evaluations": [Evaluation, ...],
      "reports": [EvaluationReport, ...],
      "agents": [AgentProfile, ...],
      "settings": { key: value, ... }
    }
    """
    counts = {
        "questions": 0,
        "conversations": 0,
        "messages": 0,
        "evaluations": 0,
        "reports": 0,
        "agents": 0,
        "llms": 0,
        "settings": 0,
    }

    for q in body.get("questions") or []:
        if not q.get("id"):
            continue
        await _upsert(session, Question, q["id"], q_from_body(q), user.id)
        counts["questions"] += 1

    for c in body.get("conversations") or []:
        if not c.get("id"):
            continue
        cid = c["id"]
        # Strip messages for the conversation row itself (they go to their own table).
        msgs = c.get("messages") or []
        c_no_msgs = {**c, "messages": []}
        await _upsert(session, Conversation, cid, conv_from_body(c_no_msgs), user.id)
        counts["conversations"] += 1
        for m in msgs:
            if not m.get("id"):
                continue
            await _upsert(session, Message, m["id"], msg_from_body(m, cid), user.id)
            counts["messages"] += 1

    for e in body.get("evaluations") or []:
        if not e.get("id"):
            continue
        await _upsert(session, Evaluation, e["id"], eval_from_body(e), user.id)
        counts["evaluations"] += 1

    for r in body.get("reports") or []:
        if not r.get("id"):
            continue
        await _upsert(session, EvaluationReport, r["id"], report_from_body(r), user.id)
        counts["reports"] += 1

    # Frontend dumps everything as `agents` (legacy key) — split here by
    # providerId. Anything in LLM_PROVIDER_IDS goes to llm_profiles, the rest
    # stays in agent_profiles.
    for a in body.get("agents") or []:
        if not a.get("id"):
            continue
        pid = a.get("providerId") or a.get("type") or a.get("kind")
        if pid in LLM_PROVIDER_IDS:
            await _upsert(session, LLMProfile, a["id"], llm_from_body(a), user.id)
            counts["llms"] += 1
        else:
            await _upsert(session, AgentProfile, a["id"], agent_from_body(a), user.id)
            counts["agents"] += 1

    # Explicit "llms" key (frontend may also split before upload).
    for a in body.get("llms") or []:
        if not a.get("id"):
            continue
        await _upsert(session, LLMProfile, a["id"], llm_from_body(a), user.id)
        counts["llms"] += 1

    settings_dict = body.get("settings") or {}
    if isinstance(settings_dict, dict):
        for key, value in settings_dict.items():
            existing = await session.get(Setting, {"owner_user_id": user.id, "key": key})
            if existing:
                existing.value = value
            else:
                session.add(Setting(owner_user_id=user.id, key=key, value=value))
            counts["settings"] += 1

    await session.commit()
    return {"ok": True, "imported": counts}
