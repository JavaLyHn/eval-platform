#!/usr/bin/env bash
# Install the SkillOpt-Sleep Codex integration into the user's ~/.codex and
# ~/.agents directories. Idempotent; prints what it does.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
AGENTS_SKILLS="${HOME}/.agents/skills"

echo "[install] repo: $REPO_ROOT"

# 1) custom /skillopt-sleep prompt
mkdir -p "$CODEX_HOME/prompts"
cp "$REPO_ROOT/plugins/codex/prompts/skillopt-sleep.md" "$CODEX_HOME/prompts/skillopt-sleep.md"
echo "[install] /skillopt-sleep prompt   -> $CODEX_HOME/prompts/skillopt-sleep.md"

# 2) user-level skill
mkdir -p "$AGENTS_SKILLS/skillopt-sleep"
cp "$REPO_ROOT/plugins/codex/skills/skillopt-sleep/SKILL.md" "$AGENTS_SKILLS/skillopt-sleep/SKILL.md"
echo "[install] skill           -> $AGENTS_SKILLS/skillopt-sleep/SKILL.md"

# 3) record the repo location so the runner is found from anywhere
echo "[install] add to your shell profile:"
echo "    export SKILLOPT_SLEEP_REPO=\"$REPO_ROOT\""

# 4) optional: append an AGENTS.md hint (only if the user opts in)
cat <<EOF

[install] Optional — add this to ~/.codex/AGENTS.md so Codex always knows the tool:

  ## SkillOpt-Sleep
  An offline self-improvement cycle is available. To run it:
  \`bash "$REPO_ROOT/plugins/run-sleep.sh" status\`. Use \`/skillopt-sleep\` for the guided flow.

Done. Try:  /skillopt-sleep status
EOF
