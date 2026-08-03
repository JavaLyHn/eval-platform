"""注册允许名单判定:邮箱白名单 ∪ 域名白名单。两者都空 = 注册关闭。"""

from .config import settings


def _split(raw: str) -> set[str]:
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


def email_allowed(email: str) -> bool:
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return False
    emails = _split(settings.auth_allowed_emails)
    domains = {d.lstrip("@") for d in _split(settings.auth_allowed_email_domains)}
    if not emails and not domains:
        return False  # 都没配 = 关闭注册(安全默认)
    if email in emails:
        return True
    domain = email.rsplit("@", 1)[-1]
    return domain in domains
