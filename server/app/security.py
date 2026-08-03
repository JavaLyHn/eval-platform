"""密码哈希(bcrypt)+ session/重置 token 的生成与单向哈希。纯函数,无 IO。"""

import hashlib
import secrets

import bcrypt


def hash_password(plain: str) -> str:
    # bcrypt 上限 72 字节;v1 接受静默截断(原型够用)。
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False


def generate_token() -> str:
    """不透明随机 token(明文,只进 Cookie / 重置链接)。"""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """token 入库前的单向哈希(DB 只存这个,泄露也拿不到活会话)。"""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
