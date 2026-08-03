async def test_health_open(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_protected_route_requires_auth(client):
    r = await client.get("/v1/questions")
    assert r.status_code == 401
