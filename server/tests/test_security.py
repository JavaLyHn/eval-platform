from app.security import hash_password, verify_password, generate_token, hash_token


def test_hash_password_roundtrip():
    h = hash_password("hunter2")
    assert h != "hunter2"          # 不是明文
    assert verify_password("hunter2", h) is True
    assert verify_password("wrong", h) is False


def test_hash_password_unique_salt():
    # 同一密码两次哈希结果不同(随机 salt),但都能校验通过
    a = hash_password("same")
    b = hash_password("same")
    assert a != b
    assert verify_password("same", a)
    assert verify_password("same", b)


def test_generate_token_is_random_and_urlsafe():
    t1 = generate_token()
    t2 = generate_token()
    assert t1 != t2
    assert len(t1) >= 32
    # urlsafe:不含 + / =(t1 和 t2 都查)
    assert all(c not in t1 for c in "+/=")
    assert all(c not in t2 for c in "+/=")


def test_hash_token_is_deterministic_sha256_hex():
    h = hash_token("abc")
    assert h == hash_token("abc")          # 确定性
    assert len(h) == 64                     # sha256 hex
    assert h != "abc"
    # 已知向量:sha256("abc") 的真实值,防止被换成别的 64 位 hex 函数蒙混
    assert h == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
