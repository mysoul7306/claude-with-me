#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCHER="$SRC_DIR/scripts/launcher.sh"

# ── Colors & Helpers ──────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()    { echo -e "  ${BLUE}i${NC} $1"; }
success() { echo -e "  ${GREEN}✓${NC} $1"; }
warn()    { echo -e "  ${YELLOW}!${NC} $1"; }
error()   { echo -e "  ${RED}✗${NC} $1"; }

header() {
  echo ""
  echo -e "  ${BOLD}${CYAN}$1${NC}"
  echo -e "  ${DIM}$(printf '─%.0s' $(seq 1 50))${NC}"
}

prompt_yn() {
  local msg="$1" default="${2:-Y}"
  if [ "$default" = "Y" ]; then
    read -rp "  > $msg [Y/n]: " ans
    [ -z "$ans" ] || [[ "$ans" =~ ^[Yy] ]]
  else
    read -rp "  > $msg [y/N]: " ans
    [[ "$ans" =~ ^[Yy] ]]
  fi
}

prompt_value() {
  local label="$1" desc="$2" default="$3" required="${4:-false}"
  echo ""
  echo -e "  ${BOLD}$label${NC}"
  echo -e "  ${DIM}$desc${NC}"
  local value=""
  while true; do
    if [ -n "$default" ]; then
      read -rp "  > [$default]: " value
      value="${value:-$default}"
    else
      read -rp "  > " value
    fi
    if [ -n "$value" ] || [ "$required" != "true" ]; then
      break
    fi
    warn "This field is required. Please enter a value."
  done
  echo "$value"
}

# ── Welcome ───────────────────────────────────────────────────────────────────

echo ""
echo -e "  ${BOLD}${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "  ${BOLD}${CYAN}║         claude-with-me installer             ║${NC}"
echo -e "  ${BOLD}${CYAN}╚══════════════════════════════════════════════╝${NC}"

# ── Step 1: Detect Bun ────────────────────────────────────────────────────────

header "Step 1/4 — Detecting Bun"

BUN_CMD=""
BUN_SOURCE=""

# 1) mise
if [ -z "$BUN_CMD" ]; then
  for mise_bin in "$HOME/.local/bin/mise" "/opt/homebrew/bin/mise"; do
    if [ -x "$mise_bin" ]; then
      if actual=$("$mise_bin" which bun 2>/dev/null); then
        BUN_CMD="$actual"
        BUN_SOURCE="mise ($mise_bin)"
      fi
      break
    fi
  done
fi

# 2) System bun (common paths)
if [ -z "$BUN_CMD" ]; then
  for p in "$HOME/.bun/bin/bun" /usr/local/bin/bun /opt/homebrew/bin/bun /usr/bin/bun; do
    if [ -x "$p" ]; then
      BUN_CMD="$p"
      BUN_SOURCE="system ($p)"
      break
    fi
  done
fi

if [ -z "$BUN_CMD" ]; then
  error "Bun not found!"
  echo ""
  echo "  Please install Bun 1.1+ using one of the following:"
  echo ""
  echo "    mise:   mise use --global bun@latest"
  echo "    curl:   curl -fsSL https://bun.sh/install | bash"
  echo "    brew:   brew install bun"
  echo ""
  exit 1
fi

BUN_VERSION=$("$BUN_CMD" -v)
BUN_MAJOR=$(echo "$BUN_VERSION" | cut -d. -f1)
BUN_MINOR=$(echo "$BUN_VERSION" | cut -d. -f2)

if [ "$BUN_MAJOR" -lt 1 ] || { [ "$BUN_MAJOR" -eq 1 ] && [ "$BUN_MINOR" -lt 1 ]; }; then
  error "Bun $BUN_VERSION found, but version 1.1 or higher is required."
  echo ""
  echo "  Current:  $BUN_CMD ($BUN_VERSION)"
  echo "  Required: 1.1.0+"
  echo ""
  echo "  Upgrade with:"
  echo "    mise: mise use --global bun@latest"
  echo "    bun:  bun upgrade"
  echo ""
  exit 1
fi

echo ""
info "Found Bun ${BOLD}$BUN_VERSION${NC} via $BUN_SOURCE"
info "Path: $BUN_CMD"
echo ""

if ! prompt_yn "Use this Bun?"; then
  echo ""
  info "Installation cancelled. Please configure your preferred Bun and try again."
  exit 0
fi

# Add bun's bin directory to PATH
BUN_BIN_DIR="$(dirname "$BUN_CMD")"
export PATH="$BUN_BIN_DIR:$PATH"

# ── Step 2: Install dependencies ──────────────────────────────────────────────

header "Step 2/4 — Installing dependencies"

if [ -d "$SRC_DIR/node_modules" ]; then
  info "node_modules already exists."
  echo ""
  if prompt_yn "Re-run bun install to sync with bun.lock?"; then
    (cd "$SRC_DIR" && "$BUN_CMD" install 2>&1 | tail -5)
    success "Dependencies synced."
  else
    info "Skipped install."
  fi
else
  info "Running bun install..."
  (cd "$SRC_DIR" && "$BUN_CMD" install 2>&1 | tail -5)
  success "Dependencies installed."
fi

# ── Step 3: Configuration ─────────────────────────────────────────────────────

header "Step 3/4 — Configuration"

if [ -f "$SRC_DIR/config.json" ]; then
  info "config.json already exists."
  echo ""
  if prompt_yn "Keep existing config?" "Y"; then
    info "Using existing config.json."
  else
    info "Let's set up a new configuration."
    setup_new_config=true
  fi
else
  info "No config.json found. Let's create one!"
  setup_new_config=true
fi

if [ "${setup_new_config:-false}" = "true" ]; then
  echo ""
  echo -e "  ${DIM}Personalize your Journey. Press Enter to accept [defaults].${NC}"

  echo ""
  echo -e "  ${BOLD}${CYAN}Required${NC}"
  echo -e "  ${DIM}──────────────────────────────────────────────${NC}"

  cfg_userName=$(prompt_value \
    "userName" \
    "The name displayed on your Journey. This is your identity." \
    "" "true")

  cfg_role=$(prompt_value \
    "role" \
    "Your role badge shown next to your name (e.g., Developer, Designer, PM)." \
    "Developer")

  cfg_avatar=$(prompt_value \
    "avatar" \
    "Your avatar emoji displayed on your Journey header." \
    "🧑‍💻")

  echo ""
  echo -e "  ${BOLD}${CYAN}Server${NC}"
  echo -e "  ${DIM}──────────────────────────────────────────────${NC}"

  cfg_port=$(prompt_value \
    "port" \
    "The local port where your Journey runs." \
    "3000")

  cfg_language=$(prompt_value \
    "language" \
    "Journey display language. Available: en (English), ko (한국어)." \
    "en")

  cfg_accentColor=$(prompt_value \
    "accentColor" \
    "Theme accent color in hex. Used for highlights across your Journey." \
    "#419BFF")

  echo ""
  echo -e "  ${BOLD}${CYAN}Claude Integration${NC}"
  echo -e "  ${DIM}──────────────────────────────────────────────${NC}"

  # modelPriority is hardcoded to ["sonnet", "opus"] (Pro tier-friendly default).
  # Edit config.json after install if you want a different priority.

  # Auto-detect Claude CLI
  CLAUDE_CLI=""
  if command -v claude &>/dev/null; then
    CLAUDE_CLI="$(command -v claude)"
  elif [ -x "/opt/homebrew/bin/claude" ]; then
    CLAUDE_CLI="/opt/homebrew/bin/claude"
  fi

  if [ -n "$CLAUDE_CLI" ]; then
    info "Claude CLI found: $CLAUDE_CLI"
    cfg_cliPath="$CLAUDE_CLI"
  else
    cfg_cliPath=$(prompt_value \
      "claude.cliPath" \
      "Path to Claude Code CLI. Required for dynamic content generation." \
      "claude")
  fi

  echo ""
  echo -e "  ${BOLD}${CYAN}claude-mem Integration${NC}"
  echo -e "  ${DIM}──────────────────────────────────────────────${NC}"
  echo ""
  echo -e "  ${DIM}The following settings configure how claude-with-me${NC}"
  echo -e "  ${DIM}interacts with the claude-mem plugin.${NC}"

  echo ""
  echo -e "  ${BOLD}disableReadCache${NC}"
  echo -e "  ${DIM}Disable file-read caching hook in Claude Code to prevent stale reads.${NC}"
  if prompt_yn "Enable disableReadCache?" "N"; then
    cfg_disableReadCache="true"
  else
    cfg_disableReadCache="false"
  fi

  echo ""
  info "excludedProjects can be configured later in config.json."
  info "Add directory paths (glob patterns supported) to exclude from tracking."

  # Generate config.json via bun for safe JSON encoding
  "$BUN_CMD" -e "
    const fs = require('fs');
    const config = {
      userName: process.argv[1],
      role: process.argv[2],
      avatar: process.argv[3],
      port: parseInt(process.argv[4], 10),
      accentColor: process.argv[5],
      language: process.argv[6],
      journey: {
        historyLimit: 20,
        excludedProjectNames: ['Workspaces', 'Workspace', 'observer-sessions'],
        weekStartDay: 1
      },
      claude: {
        modelPriority: ['sonnet', 'opus'],
        cliPath: process.argv[7]
      },
      claudeMem: {
        disableReadCache: process.argv[8] === 'true',
        excludedProjects: [],
        logPruner: { enabled: false, retentionDays: 7 }
      },
      logs: { monthlyTruncate: false }
    };
    fs.writeFileSync(
      process.argv[9],
      JSON.stringify(config, null, 2) + '\n'
    );
  " "$cfg_userName" "$cfg_role" "$cfg_avatar" "$cfg_port" \
    "$cfg_accentColor" "$cfg_language" "$cfg_cliPath" \
    "$cfg_disableReadCache" "$SRC_DIR/config.json"

  echo ""
  success "config.json created!"
fi

# Read port from config for final message
PORT=$("$BUN_CMD" -e "
  const c = JSON.parse(require('fs').readFileSync('$SRC_DIR/config.json','utf8'));
  console.log(c.port || 3000);
" 2>/dev/null || echo "3000")

# ── Step 4: Service Registration ──────────────────────────────────────────────

header "Step 4/4 — Registering service"

mkdir -p "$SRC_DIR/logs"
chmod +x "$LAUNCHER"

OS="$(uname -s)"

case "$OS" in
  Darwin)
    LABEL="com.rok-root.claude-with-me"
    APP_NAME="Claude With Me"
    APP_PATH="/Applications/${APP_NAME}.app"
    APP_MACOS="$APP_PATH/Contents/MacOS"
    APP_RESOURCES="$APP_PATH/Contents/Resources"
    PLIST_FILE="$HOME/Library/LaunchAgents/${LABEL}.plist"

    info "Platform: macOS"

    # Unload existing LaunchAgent
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true

    # Build .app bundle
    info "Building app bundle..."
    mkdir -p "$APP_MACOS"
    mkdir -p "$APP_RESOURCES"

    # Info.plist
    cat > "$APP_PATH/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleDisplayName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>${LABEL}</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleExecutable</key>
    <string>claude-with-me</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSUIElement</key>
    <true/>
    <key>LSBackgroundOnly</key>
    <true/>
</dict>
</plist>
PLIST

    # Launcher wrapper (delegates to scripts/launcher.sh)
    cat > "$APP_MACOS/claude-with-me" <<LAUNCHER_WRAPPER
#!/bin/bash
exec "${LAUNCHER}"
LAUNCHER_WRAPPER
    chmod +x "$APP_MACOS/claude-with-me"

    # Copy app icon
    if [ -f "$SRC_DIR/public/AppIcon.icns" ]; then
      cp "$SRC_DIR/public/AppIcon.icns" "$APP_RESOURCES/AppIcon.icns"
    fi

    # LaunchAgent plist
    info "Creating LaunchAgent..."
    cat > "$PLIST_FILE" <<LPLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${APP_MACOS}/claude-with-me</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${SRC_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${SRC_DIR}/logs/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${SRC_DIR}/logs/stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>${HOME}</string>
    </dict>
    <key>AssociatedBundleIdentifiers</key>
    <array>
        <string>${LABEL}</string>
    </array>
</dict>
</plist>
LPLIST

    # Clean up legacy Login Items
    osascript -e "tell application \"System Events\" to delete login item \"${APP_NAME}\"" 2>/dev/null || true

    # Load LaunchAgent
    launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE"

    success "macOS service registered!"
    echo ""
    echo -e "  ${DIM}App bundle:  $APP_PATH${NC}"
    echo -e "  ${DIM}LaunchAgent: $PLIST_FILE${NC}"
    echo ""
    echo -e "  ${BOLD}Commands:${NC}"
    echo "    Stop:    launchctl bootout gui/\$(id -u)/${LABEL}"
    echo "    Start:   launchctl bootstrap gui/\$(id -u) ${PLIST_FILE}"
    echo "    Restart: launchctl kickstart -k gui/\$(id -u)/${LABEL}"
    ;;

  Linux)
    SERVICE_DIR="$HOME/.config/systemd/user"
    SERVICE_FILE="$SERVICE_DIR/claude-with-me.service"

    info "Platform: Linux"

    # Stop existing service
    systemctl --user stop claude-with-me 2>/dev/null || true

    # Create systemd user service
    mkdir -p "$SERVICE_DIR"
    cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=claude-with-me Journey
After=network.target

[Service]
Type=simple
ExecStart=${LAUNCHER}
WorkingDirectory=${SRC_DIR}
Restart=on-failure
RestartSec=5
StandardOutput=append:${SRC_DIR}/logs/stdout.log
StandardError=append:${SRC_DIR}/logs/stderr.log

[Install]
WantedBy=default.target
SERVICE

    systemctl --user daemon-reload
    systemctl --user enable claude-with-me
    systemctl --user start claude-with-me
    loginctl enable-linger "$USER" 2>/dev/null || true

    success "Linux systemd service registered!"
    echo ""
    echo -e "  ${DIM}Service: $SERVICE_FILE${NC}"
    echo ""
    echo -e "  ${BOLD}Commands:${NC}"
    echo "    Stop:    systemctl --user stop claude-with-me"
    echo "    Start:   systemctl --user start claude-with-me"
    echo "    Restart: systemctl --user restart claude-with-me"
    echo "    Logs:    journalctl --user-unit claude-with-me -f"
    ;;

  *)
    warn "Unsupported OS: $OS"
    info "You can run manually: bun server.js"
    ;;
esac

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "  ${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "  ${BOLD}${GREEN}║     claude-with-me installed successfully!    ║${NC}"
echo -e "  ${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Journey:${NC}  http://localhost:${PORT}"
echo -e "  ${BOLD}Source:${NC}    $SRC_DIR"
echo -e "  ${BOLD}Config:${NC}   $SRC_DIR/config.json"
echo -e "  ${BOLD}Logs:${NC}     $SRC_DIR/logs/"
echo ""
echo -e "  ${DIM}Bun updates are handled automatically via launcher.sh.${NC}"
echo -e "  ${DIM}No reinstall needed when you upgrade Bun.${NC}"
echo ""
