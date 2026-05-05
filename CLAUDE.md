# CLAUDE.md

## Project Overview

**claude-with-me** — A personal Journey view that captures and visualizes your collaboration with Claude Code.
Reads session data recorded by the [claude-mem](https://github.com/thedotmack) plugin, and uses Claude CLI to dynamically generate profile, relationship, philosophy, and today's mood.

- **Stack:** Bun (ESM), Express 5, `bun:sqlite`, vanilla HTML/JS
- **Entry:** `server.js` — Express server + API routes
- **Port:** Configured via `config.json` `port` field (default 3000)
- **License:** Apache-2.0

## Architecture

```
claude-mem DB ──> Express API ──> Claude CLI ──> Journey View
  (read-only)     (server.js)    (dynamic AI)    (public/index.html)
```

### Source Structure

```
server.js              # Express server, API routes, midnight cache refresh
src/
  config.js            # Loads config.json with defaults
  db.js                # Reads claude-mem SQLite DB (stats, journey history)
  claude-gen.js        # Claude CLI calls for profile/relationship/philosophy/voice + caching
  hooks-patcher.js     # Auto-patches claude-mem hooks (disableReadCache, excludedProjects)
  i18n.js              # i18n support (en/ko)
  log-pruner.js        # Opt-in weekly cleanup of ~/.claude-mem/logs/*.log
public/
  index.html           # SPA Journey view (vanilla JS)
i18n/
  en.json, ko.json     # Translation files
scripts/
  install.sh           # Install (bun install + LaunchAgent/systemd registration)
  uninstall.sh         # Uninstall
  launcher.sh          # Bun runtime detection wrapper
```

## Development

```bash
bun run dev            # bun --hot server.js
bun start              # bun run server.js (production)
```

### Configuration

`config.json` (gitignored) — see `config.json.example` for reference.

Key settings:
- `userName`, `role`, `avatar` — Journey display info
- `accentColor` — User accent color applied to avatar, role label, journey line
- `language` — Journey language (`en` / `ko`)
- `claude.modelPriority` — Models tried in order; fallback only on operational failure (`["sonnet", "opus"]`, sonnet-first for Pro tier comfort)
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
- **Log pruning:** Opt-in weekly cleanup of `~/.claude-mem/logs/*.log` via `config.claudeMem.logPruner`
