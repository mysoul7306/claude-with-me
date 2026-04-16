<div align="center">
  <img src="assets/icon-1024.png" alt="claude-with-me" width="120" />
  <h1>claude-with-me</h1>
  <p>Your AI remembers. This dashboard shows the journey.</p>

[English](README.md) | [한국어](README.ko.md)

</div>

![Screenshot](assets/screenshot.png)

A personal dashboard that visualizes your collaboration journey with Claude.
Built on session memories recorded by the [claude-mem](https://github.com/thedotmack) plugin,
Claude dynamically generates your profile, relationship, and philosophy.

For those who see Claude not as a mere tool, but as a collaborator.

This project was built entirely with [Claude Code](https://claude.ai/code).

## Quick Start

**Requirements:** Node.js 20+, [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code), [claude-mem](https://github.com/thedotmack) plugin (used at least once)

```bash
git clone https://github.com/mysoul7306/claude-with-me.git
cd claude-with-me
./scripts/install.sh
```

The installer will:
1. Detect your Node.js (mise, nvm, or system)
2. Install dependencies (`npm install`)
3. Walk you through configuration (name, role, avatar, etc.)
4. Register the service for auto-start

Open `http://localhost:3000` in your browser (port depends on your config).

## Platform Support

| OS | Status | Notes |
|---|---|---|
| macOS 13+ | Supported | LaunchAgent auto-start, `.app` wrapper |
| Linux (Ubuntu 20.04+ / Debian 10+) | Supported | Native execution, systemd auto-start |
| Windows 10+ (WSL2) | Supported | Run inside WSL2 recommended |

> **Windows users:** WSL2 is recommended for `better-sqlite3` native compilation.
> Run **all commands inside the WSL2 terminal**, not in PowerShell or CMD.

<details>
<summary><strong>Build tools for native compilation</strong></summary>

**macOS:**
```bash
xcode-select --install
```

**Linux / WSL2 (Ubuntu/Debian):**
```bash
sudo apt update && sudo apt install -y build-essential python3 make g++
```

**Windows (WSL2 setup):**
```powershell
wsl --install
```
Then follow the Linux instructions inside WSL2.

> **Tip:** Always clone to the Linux filesystem (`~/`), not under `/mnt/c/`.

</details>

<details>
<summary><strong>Configuration reference</strong></summary>

Open `config.json` to customize:

| Field | Description | Default |
|-------|-------------|---------|
| `userName` | Name displayed on the dashboard **(required)** | — |
| `role` | Role badge **(required)** | `"Developer"` |
| `avatar` | Avatar emoji **(required)** | `"🧑‍💻"` |
| `port` | Server port | `3000` |
| `language` | Dashboard language (`en` / `ko`) | `"en"` |
| `accentColor` | Theme color (hex). Claude suggests one if omitted | `"#419BFF"` |
| `journey.historyLimit` | History entries to display | `20` |
| `journey.excludedProjectNames` | Project names filtered as noise | `["Workspaces", "Workspace", "observer-sessions"]` |
| `journey.weekStartDay` | Day of week for weekly cache refresh (0=Sun, 1=Mon) | `1` |
| `journey.refreshIntervalMin` | History refresh interval in minutes | `60` |
| `claude.model` | Claude model (`opus` / `sonnet`) | `"opus"` |
| `claude.cliPath` | Path to Claude CLI | `"claude"` |

### claude-mem Integration

| Field | Description | Default |
|-------|-------------|---------|
| `claudeMem.disableReadCache` | Disable file-read caching hook (prevents stale reads) | `false` |
| `claudeMem.excludedProjects` | Directories to exclude from tracking (glob patterns) | `[]` |

```json
{
  "claudeMem": {
    "disableReadCache": true,
    "excludedProjects": [
      "~/Workspaces",
      "~/private-project"
    ]
  }
}
```

Settings are synced to claude-mem on app startup.

</details>

<details>
<summary><strong>Auto-start management</strong></summary>

### macOS (LaunchAgent)

```bash
./scripts/install.sh      # install & start
./scripts/uninstall.sh     # remove
```

| Command | Description |
|---------|-------------|
| `launchctl bootout gui/$(id -u)/com.rok-root.claude-with-me` | Stop |
| `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rok-root.claude-with-me.plist` | Start |
| `launchctl kickstart -k gui/$(id -u)/com.rok-root.claude-with-me` | Restart |

### Linux (systemd user service)

```bash
./scripts/install.sh      # install & start
./scripts/uninstall.sh     # remove
```

| Command | Description |
|---------|-------------|
| `systemctl --user stop claude-with-me` | Stop |
| `systemctl --user start claude-with-me` | Start |
| `systemctl --user restart claude-with-me` | Restart |
| `journalctl --user-unit claude-with-me -f` | View logs |

### Windows (WSL2 + systemd)

Same as Linux if systemd is enabled. Otherwise run `node server.js` manually.

> **Tip:** Enable systemd in WSL2: add `[boot] systemd=true` to `/etc/wsl.conf`, then `wsl --shutdown`.

</details>

## How It Works

```
claude-mem DB ──> Express API ──> Claude CLI ──> Dashboard
  (read-only)     (server.js)    (dynamic AI)    (index.html)
```

1. **claude-mem** records Claude Code sessions into a SQLite DB
2. **Server** reads the DB for stats and history
3. **Claude CLI** dynamically generates profile, relationship, and philosophy (cached)
4. **Dashboard** visualizes everything in a single page

The launcher automatically detects your Node.js runtime (mise, nvm, or system), so upgrading Node.js requires no reinstallation.

## Estimated Cost

claude-with-me uses Claude Code CLI (`claude --print`) for dynamic content generation. This is included in your [Claude Code subscription](https://claude.ai/code) — **no separate API charges**.

| Content | Cache Duration | Regenerations / Month |
|---------|---------------|----------------------|
| Profile, Relationship, Philosophy | 7 days | ~4 each |
| Avatar Decoration, Accent Color | 7 days | ~4 each |
| Voice (footer message) | 1 day | ~30 |

**Impact on subscription usage:** Minimal. Approximately 50 CLI calls/month, mostly cached.

To reduce usage further, set `claude.model` to `"sonnet"` in `config.json`.

<details>
<summary><strong>Troubleshooting</strong></summary>

| Problem | Solution |
|---------|----------|
| `claude: command not found` | Verify Claude Code CLI is installed and in your PATH |
| `claude-mem.db` not found | Ensure claude-mem plugin is installed and used at least once |
| `better-sqlite3` build failure | Install build tools (see above), then `npm rebuild better-sqlite3` |
| systemd unavailable in WSL2 | Add `[boot] systemd=true` to `/etc/wsl.conf` |
| Cannot access localhost from Windows | Run `hostname -I` in WSL2, use that IP |
| "File unchanged since last read" | Set `claudeMem.disableReadCache` to `true` in config.json |

</details>

## Resource Usage

claude-with-me uses Claude CLI for AI-generated content. Estimated monthly token usage:

| Item | Model | Frequency | Monthly Tokens |
|---|---|---|---|
| Project emojis | Sonnet | On new project (rare) | <1K |
| Voice message | Config model | Daily | ~45K |
| Profile/Relationship/Philosophy | Config model | Weekly | ~28K |
| Avatar decor | Config model | Weekly | ~4K |
| **Total** | | | **~77K** |

**Cost:** With Claude CLI (Pro/Max subscription), these tokens are included in your plan at no additional charge. If using the API directly, estimated cost is ~$3/month.

## Acknowledgements

Built on [claude-mem](https://github.com/thedotmack) by [@thedotmack](https://github.com/thedotmack) — a Claude Code plugin that records collaboration sessions into a persistent SQLite database. Without claude-mem, there would be no memories to display.

## License

[Apache License 2.0](LICENSE)
