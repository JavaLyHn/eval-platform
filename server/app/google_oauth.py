"""Google OAuth2 授权码流的辅助函数(纯逻辑 + httpx 调用,与路由解耦,便于单测)。

三项凭据(client_id / client_secret / redirect_uri)齐全才算「已配置」;
否则路由层走「未配置」分支,不在这里报错。
"""

from urllib.parse import urlencode

import httpx

from .config import settings

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

SCOPE = "openid email profile"


def is_configured() -> bool:
    return bool(
        settings.google_client_id
        and settings.google_client_secret
        and settings.google_redirect_uri
    )


def build_authorize_url(state: str) -> str:
    """拼 Google 授权页 URL。state 用于回调防 CSRF。"""
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code(code: str) -> dict:
    """用授权码换 token。返回 Google token 响应(含 access_token)。"""
    data = {
        "code": code,
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "redirect_uri": settings.google_redirect_uri,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(TOKEN_URL, data=data)
        resp.raise_for_status()
        return resp.json()


async def fetch_userinfo(access_token: str) -> dict:
    """拿用户信息。返回 {sub, email, name};email 缺失或未验证 → 抛 ValueError。"""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        info = resp.json()
    email = (info.get("email") or "").strip().lower()
    if not email:
        raise ValueError("Google 未返回 email")
    # email_verified 缺省按 Google 文档应为 true;显式为 false 才拒。
    if info.get("email_verified") is False:
        raise ValueError("Google email 未验证")
    return {
        "sub": info.get("sub") or "",
        "email": email,
        "name": info.get("name") or "",
        "picture": info.get("picture") or "",
    }
