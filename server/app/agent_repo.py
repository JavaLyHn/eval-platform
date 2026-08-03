"""解析 agent-defs 本地 clone 的工作树(纯函数,只读,不碰网络)。"""

import re
from pathlib import Path
from typing import Any

import yaml

_DEF_FILE_ORDER = [
    "IDENTITY.md", "SOUL.md", "AGENTS.md", "TOOLS.md", "MEMORY.md",
    "USER.md", "PANEL.md", "HEARTBEAT.md", "BOOTSTRAP.md", "README.md",
]

_TEXT_EXTS = {".md", ".py", ".js", ".mjs", ".ts", ".sh", ".hbs", ".json", ".yaml", ".yml", ".csv", ".txt"}
_SKIP_DIRS = {"__pycache__"}


def is_ready(root: str) -> bool:
    return (Path(root) / "workspaces").is_dir()


def _split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    try:
        meta = yaml.safe_load(parts[1]) or {}
        if not isinstance(meta, dict):
            meta = {}
    except yaml.YAMLError:
        meta = {}
    return meta, parts[2].lstrip("\n")


def _recover_description(text: str, body: str) -> str:
    """proper `description:` 键缺失时的兜底(agent-defs 仓里 SKILL.md 格式不统一):
    ① 坏 frontmatter(有 --- 块但漏 description: 键,描述成了裸行)→ 取块内首个非已知键的裸行;
    ② 无/无效 frontmatter(如 dex 的 `# Skill:` + `## Purpose` 文档)→ 取正文首个非空非标题行。
    """
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            for line in parts[1].splitlines():
                s = line.strip()
                if not s or line[:1] in (" ", "\t"):  # 空行 / metadata 缩进子项
                    continue
                if re.match(r"^(name|description|version|metadata)\s*:", s):
                    continue
                return s  # 漏了 description: 前缀的裸描述行
    for line in body.splitlines():
        s = line.strip()
        if s and not s.startswith("#"):  # 跳过 markdown 标题
            return s
    return ""


def _parse_skill_md(text: str) -> dict[str, Any]:
    meta, body = _split_frontmatter(text)
    description = str(meta.get("description", "") or "")
    if not description:
        description = _recover_description(text, body)
    version = None
    if meta.get("version") is not None:
        version = str(meta["version"])  # 顶层 version:
    else:
        md = meta.get("metadata")
        if isinstance(md, dict) and md.get("version") is not None:
            version = str(md["version"])  # metadata.version:
    return {
        "name": str(meta.get("name", "") or ""),
        "description": description,
        "version": version,
        "body": body,
    }


def _employee_name(root: str, dir_name: str) -> str:
    idp = Path(root) / "workspaces" / dir_name / "IDENTITY.md"
    if idp.is_file():
        for line in idp.read_text(encoding="utf-8-sig").splitlines():
            if "显示名称" in line:
                # 表格行:"| 显示名称 | Casey |"
                cells = [c.strip() for c in line.split("|") if c.strip()]
                if len(cells) >= 2 and cells[1]:
                    return cells[1]
            elif re.search(r"\bname\s*:", line.lower()):
                # "- **Name:** Aria"(排除 filename:/username:)
                seg = line.replace("*", "").split(":", 1)[-1].strip()
                if seg:
                    return seg
    return dir_name.replace("-", " ").title()


def _skills_dir(root: str, emp: str) -> Path:
    return Path(root) / "workspaces" / emp / "skills"


def list_repo_employees(root: str) -> list[dict[str, Any]]:
    ws = Path(root) / "workspaces"
    out: list[dict[str, Any]] = []
    if not ws.is_dir():
        return out
    for d in sorted(p for p in ws.iterdir() if p.is_dir()):
        emp = d.name
        skills_dir = _skills_dir(root, emp)
        skill_count = len([p for p in skills_dir.iterdir() if p.is_dir()]) if skills_dir.is_dir() else 0
        def_files = sorted(
            (p.name for p in d.iterdir() if p.is_file() and p.suffix == ".md"),
            key=lambda n: (_DEF_FILE_ORDER.index(n) if n in _DEF_FILE_ORDER else 999, n),
        )
        out.append({"dir": emp, "name": _employee_name(root, emp), "skillCount": skill_count, "defFiles": def_files})
    return out


def _list_skill_files(sdir: Path) -> list[str]:
    """技能目录下递归全部文本文件的相对路径(排序);剔除 _SKIP_DIRS 与非文本扩展。"""
    if not sdir.is_dir():
        return []
    out: list[str] = []
    for p in sdir.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(sdir)
        if any(part in _SKIP_DIRS for part in rel.parts):
            continue
        if p.suffix.lower() in _TEXT_EXTS:
            out.append(str(rel))
    return sorted(out)


def read_repo_skill(root: str, emp: str, skill: str) -> dict[str, Any]:
    """返回指定 skill 的完整信息;SKILL.md 不存在时返回 name=skill、body 为空的 stub。"""
    sdir = _skills_dir(root, emp) / skill
    md = sdir / "SKILL.md"
    parsed = _parse_skill_md(md.read_text(encoding="utf-8-sig")) if md.is_file() else {
        "name": skill, "description": "", "version": None, "body": ""
    }
    refs_dir = sdir / "references"
    references = sorted(p.name for p in refs_dir.iterdir() if p.is_file()) if refs_dir.is_dir() else []
    return {
        **parsed,
        # files: 全部文本文件的相对路径(文件浏览用);references: references/ 下裸文件名(向后兼容)
        "references": references,
        "hasScripts": (sdir / "scripts").is_dir(),
        "hasTemplates": (sdir / "templates").is_dir(),
        "files": _list_skill_files(sdir),
    }


def list_repo_skills(root: str, emp: str) -> list[dict[str, Any]]:
    sdir = _skills_dir(root, emp)
    out: list[dict[str, Any]] = []
    if not sdir.is_dir():
        return out
    for d in sorted(p for p in sdir.iterdir() if p.is_dir()):
        md = d / "SKILL.md"
        if not md.is_file():
            continue  # 跳过无 SKILL.md 的目录
        p = _parse_skill_md(md.read_text(encoding="utf-8-sig"))
        out.append({"name": p["name"] or d.name, "description": p["description"], "version": p["version"]})
    return out


def read_common(root: str) -> dict[str, Any]:
    prompts_dir = Path(root) / "common" / "prompts"
    prompts = (
        [{"path": f"common/prompts/{p.name}"} for p in sorted(prompts_dir.iterdir()) if p.is_file() and p.suffix == ".md"]
        if prompts_dir.is_dir() else []
    )
    okr_dir = Path(root) / "common" / "skills" / "okr-executor"
    okr_md = okr_dir / "SKILL.md"
    okr = _parse_skill_md(okr_md.read_text(encoding="utf-8-sig")) if okr_md.is_file() else {
        "name": "okr-executor", "description": "", "version": None, "body": ""
    }
    okr_refs_dir = okr_dir / "references"
    okr = {
        **okr,
        "files": _list_skill_files(okr_dir),
        "references": sorted(p.name for p in okr_refs_dir.iterdir() if p.is_file()) if okr_refs_dir.is_dir() else [],
        "hasScripts": (okr_dir / "scripts").is_dir(),
        "hasTemplates": (okr_dir / "templates").is_dir(),
    }
    return {"prompts": prompts, "okrExecutor": okr}


def read_repo_file(root: str, relpath: str) -> str:
    base = Path(root).resolve()
    target = (base / relpath).resolve()
    if base != target and base not in target.parents:
        raise ValueError("path escapes repo root")
    if target.suffix.lower() not in _TEXT_EXTS:
        raise ValueError("only text files allowed")
    if not target.is_file():
        raise FileNotFoundError(relpath)
    return target.read_text(encoding="utf-8-sig")
