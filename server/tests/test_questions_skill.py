from app.routes.questions import _from_body


def test_from_body_maps_skill_fields():
    out = _from_body({
        "id": "q_sk1", "kind": "skill",
        "targetEmployeeId": "aria", "targetSkill": "social-content",
        "prompt": "写条推文", "title": "t",
    })
    assert out["kind"] == "skill"
    assert out["target_skill"] == "social-content"
    assert out["target_employee_id"] == "aria"
    assert out["data"]["targetSkill"] == "social-content"


def test_from_body_defaults_kind_agent_when_missing():
    out = _from_body({"id": "q_ag1", "prompt": "x", "title": "y"})
    assert out["kind"] == "agent"
    assert out["target_skill"] is None
