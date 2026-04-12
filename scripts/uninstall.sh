#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Claude With Me"
APP_PATH="/Applications/${APP_NAME}.app"
LABEL="com.rok-root.claude-with-me"

OS="$(uname -s)"

case "$OS" in
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

    # Stop and remove LaunchAgent
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
    if [ -f "$PLIST" ]; then
      rm "$PLIST"
      echo "LaunchAgent removed."
    else
      echo "LaunchAgent not found."
    fi

    # Remove from Login Items (legacy cleanup)
    osascript -e "tell application \"System Events\" to delete login item \"${APP_NAME}\"" 2>/dev/null || true

    # Remove .app bundle
    if [ -d "$APP_PATH" ]; then
      rm -rf "$APP_PATH"
      echo "App bundle removed."
    fi
    ;;
  Linux)
    SERVICE="$HOME/.config/systemd/user/claude-with-me.service"
    if [ -f "$SERVICE" ]; then
      systemctl --user disable --now claude-with-me 2>/dev/null || true
      rm "$SERVICE"
      systemctl --user daemon-reload
      echo "systemd service removed."
    else
      echo "systemd service not found."
    fi
    ;;
esac

echo "claude-with-me uninstalled."
