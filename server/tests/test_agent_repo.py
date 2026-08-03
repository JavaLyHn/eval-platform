from pathlib import Path

from app import agent_repo
from app.config import settings

ROOT = str(Path(__file__).parent / "fixtures" / "agent_repo")


def test_list_employees():
    emps = agent_repo.list_repo_employees(ROOT)
    aria = next(e for e in emps if e["dir"] == "aria")
    assert aria["name"] == "Aria"
    assert aria["skillCount"] == 3
    assert "IDENTITY.md" in aria["defFiles"]
    assert "SOUL.md" in aria["defFiles"]


def test_read_skill_full():
    s = agent_repo.read_repo_skill(ROOT, "aria", "copywriting")
    assert s["name"] == "copywriting"
    assert s["description"] == "Write marketing copy."
    assert s["version"] == "1.1.0"
    assert "Body line one." in s["body"]
    assert "frameworks.md" in s["references"]
    assert s["hasScripts"] is True
    assert s["hasTemplates"] is False


def test_read_skill_missing_version():
    s = agent_repo.read_repo_skill(ROOT, "aria", "no-version")
    assert s["version"] is None


def test_list_skills_summary():
    skills = agent_repo.list_repo_skills(ROOT, "aria")
    names = sorted(s["name"] for s in skills)
    assert names == ["copywriting", "no-version"]
    assert all("body" not in s for s in skills)


def test_read_common():
    c = agent_repo.read_common(ROOT)
    assert any(p["path"].endswith("SOUL.md") for p in c["prompts"])
    assert c["okrExecutor"]["name"] == "okr-executor"
    assert c["okrExecutor"]["version"] == "2.0.0"


def test_read_common_okr_has_files():
    c = agent_repo.read_common(ROOT)
    okr = c["okrExecutor"]
    assert "SKILL.md" in okr["files"]
    assert okr["references"] == []
    assert okr["hasScripts"] is False


def test_read_file_ok():
    body = agent_repo.read_repo_file(ROOT, "workspaces/aria/IDENTITY.md")
    assert "Aria" in body


def test_read_file_rejects_traversal():
    import pytest
    with pytest.raises(ValueError):
        agent_repo.read_repo_file(ROOT, "../../../../etc/passwd")
    with pytest.raises(ValueError):
        agent_repo.read_repo_file(ROOT, "workspaces/aria/skills/copywriting")  # 无后缀目录 → 不在 _TEXT_EXTS


def test_not_ready_when_missing():
    assert agent_repo.is_ready("/no/such/path") is False
    assert agent_repo.is_ready(ROOT) is True


def test_employee_name_table_format():
    emps = agent_repo.list_repo_employees(ROOT)
    casey = next(e for e in emps if e["dir"] == "casey")
    assert casey["name"] == "Casey"          # 表格行正确抽取,不是 "显示名称 Casey"
    assert casey["skillCount"] == 0           # 无 skills 目录


def test_list_skills_skips_dir_without_skill_md():
    skills = agent_repo.list_repo_skills(ROOT, "aria")
    names = sorted(s["name"] for s in skills)
    assert names == ["copywriting", "no-version"]  # broken/ 无 SKILL.md 被跳过


def test_employee_skillcount_excludes_broken():
    # aria skills 目录有 copywriting / no-version / broken(无 SKILL.md)
    # skillCount 统计目录数(含 broken),但 list_repo_skills 只列有 SKILL.md 的
    emps = agent_repo.list_repo_employees(ROOT)
    aria = next(e for e in emps if e["dir"] == "aria")
    assert aria["skillCount"] == 3  # 目录计数含 broken


def test_split_frontmatter_preserves_dashes_in_body(tmp_path):
    # body 内含 markdown 分隔线 --- 不应被截断
    text = "---\nname: x\n---\n\nIntro\n\n---\n\nAfter rule\n"
    meta, body = agent_repo._split_frontmatter(text)
    assert meta["name"] == "x"
    assert "After rule" in body
    assert "---" in body  # 正文里的 --- 保留


# ── Route tests ────────────────────────────────────────────────────────────


async def test_route_employees_ok(make_user, monkeypatch):
    monkeypatch.setattr(settings, "agent_repo_dir", ROOT)
    c = await make_user(email="sage-ok@test.local")
    r = await c.get("/v1/agent-repo/employees")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert any(e["dir"] == "aria" for e in body["employees"])


async def test_route_not_ready(make_user, monkeypatch):
    monkeypatch.setattr(settings, "agent_repo_dir", "/no/such/path")
    c = await make_user(email="sage-nr@test.local")
    r = await c.get("/v1/agent-repo/employees")
    assert r.status_code == 200
    assert r.json()["ok"] is False
    assert "未就位" in r.json()["detail"]


async def test_route_file_traversal_rejected(make_user, monkeypatch):
    monkeypatch.setattr(settings, "agent_repo_dir", ROOT)
    c = await make_user(email="sage-tr@test.local")
    r = await c.get("/v1/agent-repo/file", params={"path": "../../etc/passwd"})
    assert r.status_code == 400


def test_read_skill_files_lists_all_text_files():
    s = agent_repo.read_repo_skill(ROOT, "aria", "copywriting")
    files = s["files"]
    assert "SKILL.md" in files
    assert "references/frameworks.md" in files
    assert "scripts/run.py" in files
    assert "data/cfg.json" in files
    assert not any(f.endswith(".pyc") for f in files)
    assert not any("__pycache__" in f for f in files)


def test_read_skill_files_empty_for_missing_skill():
    s = agent_repo.read_repo_skill(ROOT, "aria", "no-such-skill")
    assert s["files"] == []


def test_read_file_allows_py():
    body = agent_repo.read_repo_file(ROOT, "workspaces/aria/skills/copywriting/scripts/run.py")
    assert "hello from copywriting script" in body


# .pyc 按扩展名拒绝(非内容嗅探);fixture 是文本占位,故意如此
def test_read_file_rejects_pyc():
    import pytest
    with pytest.raises(ValueError):
        agent_repo.read_repo_file(ROOT, "workspaces/aria/skills/copywriting/scripts/__pycache__/run.cpython-312.pyc")


def test_list_skill_files_excludes_pycache_even_whitelisted_ext(tmp_path):
    # 真正考验 _SKIP_DIRS:__pycache__ 内即便是白名单扩展(.py)也要排除
    (tmp_path / "scripts" / "__pycache__").mkdir(parents=True)
    (tmp_path / "scripts" / "__pycache__" / "keep.py").write_text("cached", encoding="utf-8")
    (tmp_path / "scripts" / "real.py").write_text("real", encoding="utf-8")
    (tmp_path / "SKILL.md").write_text("# s", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("n", encoding="utf-8")
    files = agent_repo._list_skill_files(tmp_path)
    assert "scripts/real.py" in files
    assert "SKILL.md" in files
    assert "notes.txt" in files
    # __pycache__ 内的 keep.py 必须被排除(靠 _SKIP_DIRS,不是靠扩展名)
    assert not any("__pycache__" in f for f in files)
    assert "scripts/__pycache__/keep.py" not in files


def test_parse_skill_md_recovers_missing_description_key():
    # social-content 式:有 --- 块但漏 description: 键(裸描述行,行内含冒号)+ 顶层 version
    text = "---\nname: social-content\nSocial media content generation; triggers on keywords: tweet, post.\nversion: 1.0.0\n---\n\n# Social Content\nbody"
    p = agent_repo._parse_skill_md(text)
    assert p["name"] == "social-content"
    assert "Social media content" in p["description"]
    assert p["version"] == "1.0.0"  # 顶层 version 也认


def test_parse_skill_md_top_level_version():
    text = "---\nname: x\ndescription: D\nversion: 2.3.0\n---\nbody"
    assert agent_repo._parse_skill_md(text)["version"] == "2.3.0"


def test_parse_skill_md_metadata_version_still_works():
    text = "---\nname: x\ndescription: D\nmetadata:\n  version: 1.1.0\n---\nbody"
    p = agent_repo._parse_skill_md(text)
    assert p["version"] == "1.1.0"
    assert p["description"] == "D"  # proper description 不被兜底覆盖


def test_parse_skill_md_no_frontmatter_falls_back_to_body_line():
    # dex 式:无 --- frontmatter,# 标题 + 正文
    text = "# Skill: brand-name-check\n\n## Purpose\n\nComprehensive brand name viability assessment across 6 dimensions.\n"
    p = agent_repo._parse_skill_md(text)
    assert p["name"] == ""  # 无 frontmatter name(list_repo_skills 回落 dir)
    assert "Comprehensive brand name viability" in p["description"]
    assert p["version"] is None
