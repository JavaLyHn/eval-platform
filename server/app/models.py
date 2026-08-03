"""SQLModel tables for eval-platform.

Hybrid schema strategy: hot-filter fields are promoted to typed indexed columns;
everything else lives in a JSONB `data` column. Frontend sends/receives the full
TypeScript-shaped object — the server splits it on write and merges on read.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import Column, DateTime, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


def _ts_col_created() -> Column:
    return Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def _ts_col_updated() -> Column:
    return Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


def _jsonb_col(nullable: bool = False) -> Column:
    return Column(JSONB, nullable=nullable, server_default="{}")


# --------------------------------------------------------------------------- #
# questions                                                                    #
# --------------------------------------------------------------------------- #


class Question(SQLModel, table=True):
    __tablename__ = "questions"

    id: str = Field(primary_key=True)
    owner_user_id: str | None = Field(default=None, foreign_key="users.id", index=True)
    target_employee_id: str | None = Field(default=None, index=True)
    severity: str | None = Field(default=None, index=True)
    intent: str | None = Field(default=None, index=True)
    out_of_scope: bool = Field(default=False, index=True)
    status: str = Field(default="untested", index=True)
    kind: str = Field(default="agent", index=True)
    target_skill: str | None = Field(default=None, index=True)
    data: dict[str, Any] = Field(default_factory=dict, sa_column=_jsonb_col())
    created_at: datetime | None = Field(default=None, sa_column=_ts_col_created())
    updated_at: datetime | None = Field(default=None, sa_column=_ts_col_updated())


# --------------------------------------------------------------------------- #
# conversations + messages                                                     #
# --------------------------------------------------------------------------- #


class Conversation(SQLModel, table=True):
    __tablename__ = "conversations"

    id: str = Field(primary_key=True)
    owner_user_id: str | None = Field(default=None, foreign_key="users.id", index=True)
    title: str = ""
    active_question_id: str | None = Field(default=None, index=True)
    gateway_session_id: str | None = Field(default=None)
    agent_profile_id: str | None = Field(default=None, index=True)
    data: dict[str, Any] = Field(default_factory=dict, sa_column=_jsonb_col())
    created_at: datetime | None = Field(default=None, sa_column=_ts_col_created())
    updated_at: datetime | None = Field(default=None, sa_column=_ts_col_updated())


class Message(SQLModel, table=True):
    __tablename__ = "messages"

    id: str = Field(primary_key=True)
    owner_user_id: str | None = Field(default=None, foreign_key="users.id", index=True)
    conversation_id: str = Field(
        sa_column=Column(Text, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True),
    )
    role: str = Field(index=True)  # user / assistant / system / tool
    content: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    question_id: str | None = Field(default=None, index=True)
    agent_profile_id: str | None = Field(default=None)
    turn_index: int | None = Field(default=None)
    turn_total: int | None = Field(default=None)
    interrupted: bool = Field(default=False)
    duration_ms: int | None = Field(default=None)
    tokens: int | None = Field(default=None)
    model_version: str | None = Field(default=None)
    is_streaming: bool = Field(default=False)
    data: dict[str, Any] = Field(default_factory=dict, sa_column=_jsonb_col())
    created_at: datetime | None = Field(default=None, sa_column=_ts_col_created())


# --------------------------------------------------------------------------- #
# evaluations                                                                  #
# --------------------------------------------------------------------------- #


class Evaluation(SQLModel, table=True):
    __tablename__ = "evaluations"

    id: str = Field(primary_key=True)
    owner_user_id: str | None = Field(default=None, foreign_key="users.id", index=True)
    question_id: str = Field(index=True)
    message_id: str = Field(index=True)
    sub_index: int | None = Field(default=None)
    verdict: str = Field(index=True)  # passed / failed / partial
    auto_score: float | None = Field(default=None)
    notes: str = Field(default="", sa_column=Column(Text, server_default=""))
    agent_profile_id: str | None = Field(default=None, index=True)
    judge_profile_id: str | None = Field(default=None, index=True)
    model_version: str | None = Field(default=None)
    submitted_at: datetime | None = Field(default=None, sa_column=_ts_col_created())
    data: dict[str, Any] = Field(default_factory=dict, sa_column=_jsonb_col())


# --------------------------------------------------------------------------- #
# evaluation reports — read-only snapshots manually generated from 数据看板    #
# --------------------------------------------------------------------------- #


class EvaluationReport(SQLModel, table=True):
    __tablename__ = "evaluation_reports"

    id: str = Field(primary_key=True)
    owner_user_id: str | None = Field(default=None, foreign_key="users.id", index=True)
    title: str = ""
    agent_profile_id: str | None = Field(default=None, index=True)
    agent_name: str = ""
    # The `items` array (question, answer, scores per row) lives in the JSONB
    # blob — it's a frozen snapshot so we don't normalize it into a separate
    # table.
    data: dict[str, Any] = Field(default_factory=dict, sa_column=_jsonb_col())
    created_at: datetime | None = Field(default=None, sa_column=_ts_col_created())
    updated_at: datetime | None = Field(default=None, sa_column=_ts_col_updated())


# --------------------------------------------------------------------------- #
# skill 评测报告 —— 跑完手动保存的只读快照(logs 不入库,见 routes/skill_reports)#
# --------------------------------------------------------------------------- #


class SkillEvalReport(SQLModel, table=True):
    __tablename__ = "skill_eval_reports"

    id: str = Field(primary_key=True)
    owner_user_id: str | None = Field(default=None, foreign_key="users.id", index=True)
    # 整份前端 SkillEvalReport(meta + frame);logs 由路由层落库前清空。
    data: dict[str, Any] = Field(default_factory=dict, sa_column=_jsonb_col())
    created_at: datetime | None = Field(default=None, sa_column=_ts_col_created())
    updated_at: datetime | None = Field(default=None, sa_column=_ts_col_updated())


# --------------------------------------------------------------------------- #
# prompts (Prompt 管理:每个 prompt key 一行;不可变版本数组在 data.versions)      #
# --------------------------------------------------------------------------- #


class Prompt(SQLModel, table=True):
    __tablename__ = "prompts"

    # prompt key,如 "llm-judge" / "ai-question-gen" / "skillopt-case-gen"。
    owner_user_id: str = Field(primary_key=True, foreign_key="users.id")
    id: str = Field(primary_key=True)
    # 生效版本指针(1 = 前端代码内置默认,不落库)。
    active_version: int = Field(default=1, index=True)
    # 自定义版本数(typed 列便于审计查询;权威数据在 data.versions)。
    version_count: int = Field(default=0)
    # 完整覆盖状态:versions[] / activeVersion / customVars / varDescOverrides。
    data: dict[str, Any] = Field(default_factory=dict, sa_column=_jsonb_col())
    created_at: datetime | None = Field(default=None, sa_column=_ts_col_created())
    updated_at: datetime | None = Field(default=None, sa_column=_ts_col_updated())


# --------------------------------------------------------------------------- #
# agent profiles (kind=agent: 走 bridge 的完整智能体, 被测对象)                  #
# --------------------------------------------------------------------------- #


class AgentProfile(SQLModel, table=True):
    __tablename__ = "agent_profiles"

    id: str = Field(primary_key=True)
    owner_user_id: str | None = Field(default=None, foreign_key="users.id", index=True)
    name: str = ""
    # `provider_id` mirrors the frontend's `providerId` (agentcli-bridge / mock).
    # Kept here for filter/joining; not used as a discriminator since the table
    # only holds agent-kind profiles.
    kind: str | None = Field(default=None, index=True)
    is_active: bool = Field(default=False, index=True)
    data: dict[str, Any] = Field(default_factory=dict, sa_column=_jsonb_col())
    created_at: datetime | None = Field(default=None, sa_column=_ts_col_created())
    updated_at: datetime | None = Field(default=None, sa_column=_ts_col_updated())


# --------------------------------------------------------------------------- #
# llm profiles (kind=llm: 直连 API 的纯 LLM, 用于裁判 / AI 出题 / 反思)         #
# --------------------------------------------------------------------------- #


class LLMProfile(SQLModel, table=True):
    __tablename__ = "llm_profiles"

    id: str = Field(primary_key=True)
    owner_user_id: str | None = Field(default=None, foreign_key="users.id", index=True)
    name: str = ""
    # `provider_id` mirrors openai-compat / anthropic / ... — useful for
    # grouping or routing in queries.
    kind: str | None = Field(default=None, index=True)
    data: dict[str, Any] = Field(default_factory=dict, sa_column=_jsonb_col())
    created_at: datetime | None = Field(default=None, sa_column=_ts_col_created())
    updated_at: datetime | None = Field(default=None, sa_column=_ts_col_updated())


# --------------------------------------------------------------------------- #
# settings (kv store for ui prefs / categories / user / default-criteria etc.) #
# --------------------------------------------------------------------------- #


class Setting(SQLModel, table=True):
    __tablename__ = "settings"

    owner_user_id: str = Field(primary_key=True, foreign_key="users.id")
    key: str = Field(primary_key=True)
    value: dict[str, Any] | list[Any] | str | int | float | bool | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    updated_at: datetime | None = Field(default=None, sa_column=_ts_col_updated())


# --------------------------------------------------------------------------- #
# 鉴权:users / sessions / password_reset_tokens(登录系统)                     #
# --------------------------------------------------------------------------- #


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: str = Field(primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str = ""
    name: str = ""
    avatar_url: str = ""  # Google 登录带来的头像 URL(密码账户为空)
    # 预留:v1 永远是 member,不写任何 admin 代码路径。
    role: str = Field(default="member", index=True)
    status: str = Field(default="active", index=True)  # active / disabled
    created_at: datetime | None = Field(default=None, sa_column=_ts_col_created())
    updated_at: datetime | None = Field(default=None, sa_column=_ts_col_updated())


class AuthSession(SQLModel, table=True):
    __tablename__ = "sessions"

    id: str = Field(primary_key=True)
    token_hash: str = Field(index=True, unique=True)  # sha256(明文 token)
    user_id: str = Field(foreign_key="users.id", index=True)
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False, index=True))
    created_at: datetime | None = Field(default=None, sa_column=_ts_col_created())
    last_seen_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))


class PasswordResetToken(SQLModel, table=True):
    __tablename__ = "password_reset_tokens"

    id: str = Field(primary_key=True)
    token_hash: str = Field(index=True, unique=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    used_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    created_at: datetime | None = Field(default=None, sa_column=_ts_col_created())


# Composite / extra indexes (declared after class defs so Index() can reach cols)
Index("ix_questions_emp_severity", Question.__table__.c.target_employee_id, Question.__table__.c.severity)
Index("ix_messages_conv_created", Message.__table__.c.conversation_id, Message.__table__.c.created_at)
