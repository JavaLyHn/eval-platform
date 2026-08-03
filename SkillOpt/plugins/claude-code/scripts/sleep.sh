#!/usr/bin/env bash
# Claude Code plugin runner — thin wrapper over the shared runner so all three
# platform plugins share one engine launcher. The shared runner lives at
# <repo>/plugins/run-sleep.sh and handles repo-root + interpreter resolution.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # <repo>/plugins/claude-code/scripts
SHARED="$(cd "$HERE/../.." && pwd)/run-sleep.sh"        # <repo>/plugins/run-sleep.sh
if [ ! -f "$SHARED" ] && [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  SHARED="$(cd "$CLAUDE_PLUGIN_ROOT/.." && pwd)/run-sleep.sh"
fi
exec bash "$SHARED" "$@"
