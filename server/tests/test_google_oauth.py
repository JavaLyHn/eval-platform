"""Google OAuth 端点 + 辅助函数测试,以及 register 端点已移除 / 无密码账户登录被拒。"""

from uuid import uuid4

import pytest

from app import google_oauth
from app.config import settings

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _set_google(monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "cid.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "google_client_secret", "secret")
    monkeypatch.setattr(
        settings, "google_redirect_uri", "http://localhost:5173/v1/auth/google/callback"
    )


def _unset_google(monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "")
    monkeypatch.setattr(settings, "google_client_secret", "")
    monkeypatch.setattr(settings, "google_redirect_uri", "")


# ---- 纯函数 ----

async def test_is_configured_false_by_default(monkeypatch):
    _unset_google(monkeypatch)
    assert google_oauth.is_configured() is False


async def test_is_configured_true_when_set(monkeypatch):
    _set_google(monkeypatch)
    assert google_oauth.is_configured() is True


async def test_build_authorize_url(monkeypatch):
    _set_google(monkeypatch)
    url = google_oauth.build_authorize_url("st8")
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "client_id=cid.apps.googleusercontent.com" in url
    assert "state=st8" in url
    assert "response_type=code" in url
    assert "scope=openid" in url
    assert "redirect_uri=http" in url


# ---- /google/login ----

async def test_google_login_not_configured_redirects(client, monkeypatch):
    _unset_google(monkeypatch)
    r = await client.get("/v1/auth/google/login")
    assert r.status_code == 302
    assert r.headers["location"] == "/login?error=google_not_configured"


async def test_google_login_configured_redirects_to_google(client, monkeypatch):
    _set_google(monkeypatch)
    r = await client.get("/v1/auth/google/login")
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://accounts.google.com/")
    assert "g_oauth_state" in r.cookies


# ---- /google/callback ----

async def test_google_callback_no_code_fails(client):
    r = await client.get("/v1/auth/google/callback")
    assert r.status_code == 302
    assert "error=google_failed" in r.headers["location"]


async def test_google_callback_bad_state_fails(client):
    r = await client.get("/v1/auth/google/callback?code=abc&state=mismatch")
    assert r.status_code == 302
    assert "error=google_state" in r.headers["location"]


# ---- 注册已移除 / 无密码账户 ----

async def test_register_endpoint_removed(client):
    r = await client.post(
        "/v1/auth/register", json={"email": "x@test.local", "password": "pw123456"}
    )
    assert r.status_code in (404, 405)


async def test_password_login_rejected_for_passwordless_account(client):
    from app.db import session_scope
    from app.models import User

    async with session_scope() as s:
        s.add(User(id=uuid4().hex, email="g@test.local", password_hash="", name="g"))
        await s.commit()
    r = await client.post(
        "/v1/auth/login", json={"email": "g@test.local", "password": "anything"}
    )
    assert r.status_code == 401
