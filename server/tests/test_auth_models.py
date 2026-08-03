from app.models import User, AuthSession, PasswordResetToken


def test_user_table_columns():
    cols = User.__table__.columns
    for name in ("id", "email", "password_hash", "name", "role", "status", "created_at"):
        assert name in cols, f"User 缺列 {name}"
    assert User.__tablename__ == "users"


def test_session_and_reset_tablenames():
    assert AuthSession.__tablename__ == "sessions"
    assert PasswordResetToken.__tablename__ == "password_reset_tokens"
    assert "token_hash" in AuthSession.__table__.columns
    assert "used_at" in PasswordResetToken.__table__.columns
