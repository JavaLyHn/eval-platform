from app.routes.skill_reports import _from_body


def test_from_body_strips_logs_and_maps_id():
    body = {
        "id": "sr1", "title": "t",
        "meta": {"targetLabel": "Sam"},
        "frame": {"type": "done"},
        "logs": ["line1", "line2"],
    }
    out = _from_body(body)
    assert out["id"] == "sr1"
    assert out["data"]["logs"] == []          # logs 落库前清空
    assert out["data"]["title"] == "t"        # 其余字段原样保留
    assert out["data"]["frame"] == {"type": "done"}


def test_from_body_handles_missing_logs():
    out = _from_body({"id": "sr2", "meta": {}})
    assert out["data"]["logs"] == []
