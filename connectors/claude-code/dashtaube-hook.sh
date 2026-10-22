#!/usr/bin/env bash
# Dashtaube-Hook für Claude Code (macOS, Linux, WSL, Git Bash).
# Reicht die Hook-Eingabe von Claude Code unverändert an Dashtaube weiter.
# Braucht nur curl. Schlägt nie fehl, damit Claude Code nie blockiert wird.
#
# Erwartet DASHTAUBE_URL und DASHTAUBE_TOKEN in der Umgebung,
# z. B. über den "env"-Block in ~/.claude/settings.json.

if [ -z "${DASHTAUBE_URL:-}" ] || [ -z "${DASHTAUBE_TOKEN:-}" ]; then
  cat >/dev/null
  exit 0
fi

curl --silent --show-error --max-time 5 \
  -X POST "${DASHTAUBE_URL%/}/v1/hooks/claude-code" \
  -H "Authorization: Bearer ${DASHTAUBE_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @- >/dev/null 2>&1 || true

exit 0
