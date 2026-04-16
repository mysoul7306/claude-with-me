# CLAUDE.md

## Project Overview

**claude-with-me** — A personal dashboard that visualizes your collaboration journey with Claude Code.
Reads session data recorded by the [claude-mem](https://github.com/thedotmack) plugin, and uses Claude CLI to dynamically generate profile, relationship, and philosophy.

- **Stack:** Node.js (ESM), Express 5, better-sqlite3, vanilla HTML/JS
- **Entry:** `server.js` — Express server + API routes
- **Port:** Configured via `config.json` `port` field (default 3000)
- **License:** Apache-2.0

## Architecture

```
claude-mem DB ──> Express API ──> Claude CLI ──> Dashboard
  (read-only)     (server.js)    (dynamic AI)    (public/index.html)
```

### Source Structure

```
server.js              # Express server, API routes, midnight cache refresh
src/
  config.js            # Loads config.json with defaults
  db.js                # Reads claude-mem SQLite DB (stats, journey, TODO)
  claude-gen.js        # Claude CLI calls for profile/relationship/philosophy/voice + caching
  hooks-patcher.js     # Auto-patches claude-mem hooks (disableReadCache, excludedProjects)
  i18n.js              # i18n support (en/ko)
public/
  index.html           # SPA dashboard (vanilla JS)
i18n/
  en.json, ko.json     # Translation files
scripts/
  install.sh           # Install (npm install + LaunchAgent/systemd registration)
  uninstall.sh         # Uninstall
  launcher.sh          # Node.js runtime detection wrapper
```

## Development

```bash
npm run dev            # node --watch server.js
npm start              # node server.js (production)
```

### Configuration

`config.json` (gitignored) — see `config.json.example` for reference.

Key settings:
- `userName`, `role`, `avatar` — Dashboard display info
- `accentColor` — User accent color applied to avatar, role label, journey line
- `journey.todoTtlDays` — Auto-expire TODOs older than N days (default 14)
- `journey.excludedProjectNames` — Noise project names filtered from TODO/History (default: `["Workspaces", "Workspace", "observer-sessions"]`)
- `claude.model` — AI generation model (`opus` / `sonnet`)
- `claudeMem.disableReadCache` — Disable file-read caching hook
- `claudeMem.excludedProjects` — Paths to exclude from tracking

## Conventions

- **ESM only** — `import/export`, no `require()`
- **Immutability** — Create new objects instead of mutating existing ones
- **No test suite** — Manual verification + team testing after deployment
- **Commit message:** `<type>: <description>` (feat, fix, refactor, docs, chore)
- **Branch:** `feat/`, `fix/`, `refactor/`, `chore/` prefix — no direct commits to develop/main
- **Git flow:** feature branch → develop (merge --no-ff) → main (PR)

## Key Behaviors

- **Caching:** AI-generated content from claude-gen.js is stored as JSON files in `cache/`, auto-refreshed at midnight
- **DB:** Accesses claude-mem SQLite DB in **read-only** mode — never writes to it
- **Hooks patching:** Auto-syncs claude-mem hook settings on app startup
