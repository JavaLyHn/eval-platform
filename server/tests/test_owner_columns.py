from app.models import (
    Question, Conversation, Message, Evaluation, EvaluationReport,
    SkillEvalReport, AgentProfile, LLMProfile, Prompt, Setting,
)

ID_PK_MODELS = [
    Question, Conversation, Message, Evaluation, EvaluationReport,
    SkillEvalReport, AgentProfile, LLMProfile,
]


def test_id_pk_models_have_owner_column():
    for m in ID_PK_MODELS:
        assert "owner_user_id" in m.__table__.columns, f"{m.__name__} 缺 owner_user_id"


def test_prompt_composite_pk():
    pk = {c.name for c in Prompt.__table__.primary_key.columns}
    assert pk == {"owner_user_id", "id"}


def test_setting_composite_pk():
    pk = {c.name for c in Setting.__table__.primary_key.columns}
    assert pk == {"owner_user_id", "key"}
