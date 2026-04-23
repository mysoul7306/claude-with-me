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

**Requirements:** Node.js 20+, [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) signed in with a **Claude Pro/Max subscription or Anthropic API key** (free tier not sufficient), [claude-mem](https://github.com/thedotmack) plugin (used at least once)

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
| `journey.weekStartDay` | Day of week for weekly refresh — profile, relationship, philosophy, and weekly summary (0=Sun, 1=Mon) | `1` |
| `claude.modelPriority` | Models tried in order; fallback only on operational failure | `["opus", "sonnet"]` |
| `claude.cliPath` | Path to Claude CLI | `"claude"` |

### claude-mem Integration

| Field | Description | Default |
|-------|-------------|---------|
| `claudeMem.disableReadCache` | Disable file-read caching hook (prevents stale reads) | `false` |
| `claudeMem.excludedProjects` | Directories to exclude from tracking (glob patterns) | `[]` |
| `claudeMem.logPruner.enabled` | Enable weekly pruning of claude-mem log files | `false` |
| `claudeMem.logPruner.retentionDays` | Days to retain log files before deletion | `7` |

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

### claude-mem log pruner (opt-in)

Automatically delete old `~/.claude-mem/logs/*.log` files. Disabled by default.

```json
{
  "claudeMem": {
    "logPruner": {
      "enabled": true,
      "retentionDays": 7
    }
  }
}
```

When enabled, runs on server startup and every week at 05:00 on the day set by `journey.weekStartDay`.

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
3. **Claude CLI** dynamically generates profile, relationship, philosophy, and weekly summary (cached)
4. **Dashboard** visualizes everything in a single page

The launcher automatically detects your Node.js runtime (mise, nvm, or system), so upgrading Node.js requires no reinstallation.

## Estimated Cost

claude-with-me uses Claude Code CLI (`claude --print`) for dynamic content generation.

### Model Priority

By default, Opus is tried first; Sonnet is used as fallback only on **explicit operational failures** (rate limit, timeout, provider unavailable). The current model is shown next to each section title (e.g., `· ✨ opus · 5m ago`).

```json
"claude": {
  "modelPriority": ["opus", "sonnet"]
}
```

To prefer Sonnet (cheaper, faster), reorder: `["sonnet", "opus"]`. To force a single model, use one entry: `["sonnet"]`.

### Estimated Monthly Tokens

| Item | Frequency | Tokens (Opus) |
|---|---|---|
| Voice message | Daily | ~45K |
| Profile / Relationship / Philosophy | Weekly | ~28K |
| Weekly summary | Weekly | ~5K |
| Avatar decor / Accent color | Weekly | ~5K |
| Project emojis (Sonnet, on new project) | Rare | <1K |
| **Total** | | **~85K** |

### Cost in Practice

- **Claude Code subscription (Pro $20, Max $100):** Tokens are included in your plan — **no separate charges**. ~85K/month is roughly 1–2 typical chat sessions worth of usage.
- **Direct API:** Roughly $2–3/month at Opus prices, less if Sonnet-first.

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

## Acknowledgements

Built on [claude-mem](https://github.com/thedotmack) by [@thedotmack](https://github.com/thedotmack) — a Claude Code plugin that records collaboration sessions into a persistent SQLite database. Without claude-mem, there would be no memories to display.

## License

[Apache License 2.0](LICENSE)
