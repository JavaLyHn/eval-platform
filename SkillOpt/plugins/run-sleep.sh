#!/usr/bin/env bash
# SkillOpt-Sleep shared runner — used by all platform plugins (Claude Code,
# Codex, Copilot). Resolves the repo root (which contains the skillopt_sleep
# package), picks a Python >= 3.10, and execs the engine CLI.
#
# Usage: run-sleep.sh <run|dry-run|status|adopt|harvest|...> [args...]
set -euo pipefail

# This script lives at <repo>/plugins/run-sleep.sh, so the repo root (which
# holds skillopt_sleep/) is one level up. CLAUDE_PLUGIN_ROOT (if set by Claude
# Code) points at the plugin dir; the engine is then two levels above it.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$SCRIPT_DIR/../skillopt_sleep" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -d "$CLAUDE_PLUGIN_ROOT/../../skillopt_sleep" ]; then
  REPO_ROOT="$(cd "$CLAUDE_PLUGIN_ROOT/../.." && pwd)"
elif [ -n "${SKILLOPT_SLEEP_REPO:-}" ] && [ -d "$SKILLOPT_SLEEP_REPO/skillopt_sleep" ]; then
  REPO_ROOT="$SKILLOPT_SLEEP_REPO"
else
  # last resort: search upward from CWD
  d="$PWD"
  while [ "$d" != "/" ]; do
    [ -d "$d/skillopt_sleep" ] && { REPO_ROOT="$d"; break; }
    d="$(dirname "$d")"
  done
fi
if [ -z "${REPO_ROOT:-}" ]; then
  echo "[sleep] ERROR: could not locate the skillopt_sleep package. Set SKILLOPT_SLEEP_REPO to the repo root." >&2
  exit 1
fi

PY=""
for cand in python3.12 python3.11 python3.10 python3; do
  if command -v "$cand" >/dev/null 2>&1; then
    ver="$("$cand" -c 'import sys; print("%d%d" % sys.version_info[:2])' 2>/dev/null || echo 0)"
    if [ "${ver:-0}" -ge 310 ]; then PY="$cand"; break; fi
  fi
done
if [ -z "$PY" ]; then
  echo "[sleep] ERROR: need Python >= 3.10 (found none)." >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then set -- status; fi
cd "$REPO_ROOT"
exec "$PY" -m skillopt_sleep "$@"
