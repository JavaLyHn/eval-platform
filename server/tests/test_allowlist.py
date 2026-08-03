from app.allowlist import email_allowed
from app.config import settings


def test_both_empty_means_closed(monkeypatch):
    monkeypatch.setattr(settings, "auth_allowed_emails", "")
    monkeypatch.setattr(settings, "auth_allowed_email_domains", "")
    assert email_allowed("anyone@example.com") is False


def test_domain_allowlist(monkeypatch):
    monkeypatch.setattr(settings, "auth_allowed_emails", "")
    monkeypatch.setattr(settings, "auth_allowed_email_domains", "example.com,example.com")
    assert email_allowed("demo-user@example.com") is True
    assert email_allowed("x@example.com") is True
    assert email_allowed("x@gmail.com") is False


def test_explicit_email_allowlist(monkeypatch):
    monkeypatch.setattr(settings, "auth_allowed_emails", "boss@gmail.com")
    monkeypatch.setattr(settings, "auth_allowed_email_domains", "")
    assert email_allowed("boss@gmail.com") is True
    assert email_allowed("BOSS@GMAIL.COM") is True
    assert email_allowed("other@gmail.com") is False
