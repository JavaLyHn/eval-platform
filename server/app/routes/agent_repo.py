"""agent-defs 本地 clone 只读浏览 + 刷新。clone 未就位 → {ok:false, detail}。"""

import asyncio
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from .. import agent_repo
from ..config import settings

router = APIRouter(prefix="/agent-repo", tags=["agent-repo"])

# 合法分支名(防止把 `--upload-pack=…` 之类的 git 选项当分支注入)。
_BRANCH_RE = re.compile(r"^[A-Za-z0-9._][A-Za-z0-9._/-]*$")


def _root() -> str:
    return settings.agent_repo_root


def _not_ready() -> dict[str, Any]:
    return {
        "ok": False,
        "detail": f"agent-repo 未就位:找不到 {_root()}。请先 clone:git clone <your-agent-defs-repo> <agent_repo_root>",
    }


async def _run_git(*args: str) -> tuple[int, str]:
    """跑 git 子命令,返回 (returncode, 合并后的 stdout+stderr 文本)。"""
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "-C", _root(), *args,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
    except FileNotFoundError:
        return 127, "git executable not found"
    out, _ = await proc.communicate()
    return proc.returncode or 0, out.decode("utf-8", "replace").strip()


async def _remote_branches() -> tuple[list[str], str]:
    """列出 Bitbucket 远端分支(需 SSH);返回 (分支名列表, 出错原文)。"""
    code, out = await _run_git("ls-remote", "--heads", "origin")
    if code != 0:
        return [], out
    names: list[str] = []
    for line in out.splitlines():
        _, _, ref = line.partition("refs/heads/")
        ref = ref.strip()
        if ref:
            names.append(ref)
    return names, ""


@router.get("/employees")
async def employees():
    if not agent_repo.is_ready(_root()):
        return _not_ready()
    return {"ok": True, "employees": agent_repo.list_repo_employees(_root())}


@router.get("/employees/{emp}")
async def employee(emp: str):
    if not agent_repo.is_ready(_root()):
        return _not_ready()
    emps = {e["dir"]: e for e in agent_repo.list_repo_employees(_root())}
    if emp not in emps:
        raise HTTPException(status_code=404, detail="employee not found")
    return {
        "ok": True,
        "name": emps[emp]["name"],
        "defFiles": emps[emp]["defFiles"],
        "skills": agent_repo.list_repo_skills(_root(), emp),
    }


@router.get("/skill")
async def get_skill(emp: str = Query(...), skill: str = Query(...)):
    if not agent_repo.is_ready(_root()):
        return _not_ready()
    return {"ok": True, "skill": agent_repo.read_repo_skill(_root(), emp, skill)}


@router.get("/common")
async def common():
    if not agent_repo.is_ready(_root()):
        return _not_ready()
    return {"ok": True, **agent_repo.read_common(_root())}


@router.get("/file")
async def file(path: str = Query(...)):
    if not agent_repo.is_ready(_root()):
        return _not_ready()
    try:
        body = agent_repo.read_repo_file(_root(), path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="file not found")
    return {"ok": True, "path": path, "body": body}


@router.get("/branches")
async def branches():
    """列出可同步的分支(Bitbucket 远端 + 当前所在分支)。远端拉不到时仍返回当前分支并带 detail。"""
    if not agent_repo.is_ready(_root()):
        return _not_ready()
    _, cur = await _run_git("rev-parse", "--abbrev-ref", "HEAD")
    current = cur.strip()
    remote, err = await _remote_branches()
    merged = sorted(set(remote) | ({current} if current else set()))
    res: dict[str, Any] = {"ok": True, "branches": merged, "current": current}
    if err:
        res["detail"] = f"无法列出远端分支(SSH/网络?):{err[:200]}"
    return res


@router.post("/refresh")
async def refresh(branch: str | None = Query(None)):
    """刷新本地 clone。
    - 不带 branch:对当前分支做 `git pull --ff-only`(向后兼容,对比页在用)。
    - 带 branch:校验是远端真实分支后,fetch 并把 clone 切到该分支的远端最新。
    """
    if not agent_repo.is_ready(_root()):
        return _not_ready()

    if branch is not None:
        branch = branch.strip()
        if not branch or not _BRANCH_RE.match(branch):
            raise HTTPException(status_code=400, detail="非法分支名")
        valid, err = await _remote_branches()
        if err and not valid:
            return {"ok": False, "detail": f"无法连接远端列分支:{err[:300]}"}
        if branch not in valid:
            raise HTTPException(status_code=404, detail=f"远端没有分支「{branch}」")
        code, out = await _run_git("fetch", "origin", branch, "--prune")
        if code != 0:
            return {"ok": False, "detail": out[:500] or "git fetch 失败"}
        # 只读浏览镜像,无本地改动可丢 → 直接把分支重置到远端最新并切过去。
        code, out2 = await _run_git("checkout", "-B", branch, f"origin/{branch}")
        if code != 0:
            return {"ok": False, "detail": out2[:500] or "git checkout 失败"}
        output = f"{out}\n{out2}".strip()
    else:
        code, output = await _run_git("pull", "--ff-only")
        if code != 0:
            # 把 git 的真实报错原样回传(SSH 鉴权 / ff-only 分叉 / 网络都在这里现形)。
            return {"ok": False, "detail": output[:500] or "git pull 失败(无输出)"}

    _, head = await _run_git("rev-parse", "--short", "HEAD")
    _, cur = await _run_git("rev-parse", "--abbrev-ref", "HEAD")
    return {
        "ok": True,
        "head": head.strip(),
        "branch": cur.strip(),
        "output": output[:500],
    }
