#!/usr/bin/env bash
# Common launcher for claude-with-me
# Detects Bun runtime via mise/system and launches the server.
# Used by macOS LaunchAgent (.app wrapper) and Linux systemd service.

export HOME="${HOME:-$(eval echo ~)}"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Activate version manager (mise) so `bun` resolves on PATH
if [ -x "$HOME/.local/bin/mise" ]; then
  eval "$("$HOME/.local/bin/mise" activate bash 2>/dev/null)"
elif [ -x "/opt/homebrew/bin/mise" ]; then
  eval "$(/opt/homebrew/bin/mise activate bash 2>/dev/null)"
fi

exec bun "$SRC_DIR/server.js"
