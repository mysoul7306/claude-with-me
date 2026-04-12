#!/usr/bin/env bash
# Common launcher for claude-with-me
# Detects Node.js runtime via mise/nvm/system and launches the server.
# Used by macOS LaunchAgent (.app wrapper) and Linux systemd service.

export HOME="${HOME:-$(eval echo ~)}"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Activate Node.js version manager (mise > nvm > system)
if [ -x "$HOME/.local/bin/mise" ]; then
  eval "$("$HOME/.local/bin/mise" activate bash 2>/dev/null)"
elif [ -x "/opt/homebrew/bin/mise" ]; then
  eval "$(/opt/homebrew/bin/mise activate bash 2>/dev/null)"
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

exec node "$SRC_DIR/server.js"
