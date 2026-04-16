# TODO & History Redesign

## Problem

The current TODO/History implementation in `src/db.js` has several issues:

1. **Project name pollution** — `Workspaces` (365), `Workspace` (105), `observer-sessions` (4) noise entries caused by claude-mem worker cwd resolution quirks
2. **TODO noise** — `session_summaries.next_steps` contains 50%+ non-actionable items (session status messages, completion announcements, vague items)
3. **History gaps** — Sessions without `session_summaries` records are invisible; `GROUP BY` non-determinism causes wrong request/investigated selection
4. **Cache inefficiency** — `clearAllCaches()` at midnight deletes 7-day-TTL items daily, causing unnecessary daily Opus CLI regeneration of profile/relationship/philosophy
5. **No observations usage** — 16,000+ observations (bugfix/feature/change/decision/refactor/discovery) are available but unused

## Solution Overview

### TODO Pipeline
1. DB query with pattern-matching noise filter + `excludedProjectNames`
2. Cross-session completion detection (existing `weightedContainment`)
3. TTL expiry filter (`todoTtlDays`, default 14)
4. **Sonnet CLI refinement** — extract actionable items only, rewrite as concise verb-first single lines
5. Cache result in `cache/todo-refined.json` (1-hour TTL)

### History Pipeline
1. `session_summaries` as primary source with `ROW_NUMBER()` for deterministic first-row selection
2. `LEFT JOIN sdk_sessions` for `custom_title` (preferred over `request` for title)
3. `LEFT JOIN observations` aggregated by `type` per `memory_session_id` — displayed as type badges
4. `excludedProjectNames` config-driven filter (shared with TODO)
5. Active session exclusion (sdk_sessions.status='active' + 10-minute activity cutoff)
6. Cache result in `cache/history.json` (1-hour TTL)

### Project Emojis
- On-demand generation via Sonnet CLI when a new project name appears
- Cumulative cache in `cache/project-emojis.json` (never expires, only grows)
- Displayed alongside project name badge in both TODO and History

### Cache & Refresh Strategy (cron-based)

Replace `scheduleMidnightRefresh()` (setTimeout recursion + `clearAllCaches()`) with `node-cron`:

| Schedule | Cron Expression | Items |
|---|---|---|
| Every hour | `0 * * * *` | TODO (Sonnet, on DB change), History (DB query) |
| Daily midnight | `0 0 * * *` | voice |
| Weekly (configurable start day) | `0 0 * * {weekStartDay}` | profile, relationship, philosophy, avatarDecor, accentColor |
| On-demand | — | project-emojis (new project detected) |

TODO refresh includes DB change detection: compare latest `session_summaries.created_at_epoch` with previous run; skip Sonnet CLI call if unchanged.

## Config Changes

New fields in `config.json` under `journey`:

```json
{
  "journey": {
    "todoLimit": 10,
    "todoTtlDays": 14,
    "historyLimit": 30,
    "excludedProjectNames": ["Workspaces", "Workspace", "observer-sessions"],
    "weekStartDay": 1,
    "refreshIntervalMin": 60
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `excludedProjectNames` | string[] | `["Workspaces", "Workspace", "observer-sessions"]` | Noise project names filtered from TODO and History |
| `weekStartDay` | number | `1` | Weekly refresh day (0=Sun, 1=Mon, ..., 6=Sat) |
| `refreshIntervalMin` | number | `60` | TODO/History refresh interval in minutes |

## File Changes

### Modified

| File | Changes |
|---|---|
| `src/config.js` | Add `weekStartDay`, `refreshIntervalMin`, `excludedProjectNames` with defaults |
| `src/db.js` | Rewrite `getJourney()`: split into `getJourneyTodo()` + `getJourneyHistory()`, add observations type aggregation, `ROW_NUMBER()` for both subqueries, unified project filter |
| `src/claude-gen.js` | Add `refineTodo()` (Sonnet CLI), `getProjectEmojis()` (Sonnet CLI + cumulative cache), replace `scheduleMidnightRefresh()` with cron-based `scheduleRefreshCycles()`, remove `clearAllCaches()` |
| `server.js` | Update `/api/journey` to use new cache-aware functions, wire up cron scheduler |
| `public/index.html` | `renderJourney()`: add observations type badges, project emoji rendering |
| `config.json.example` | Add new config fields |
| `CLAUDE.md` | Document new config fields |

### New

| File | Purpose |
|---|---|
| `cache/todo-refined.json` | Sonnet-refined TODO items (1h TTL) |
| `cache/history.json` | History query results (1h TTL) |
| `cache/project-emojis.json` | Cumulative project emoji map |

### New Dependency

| Package | Purpose |
|---|---|
| `node-cron` | Cron-based refresh scheduling |

## Data Model

### /api/journey Response

```json
{
  "todo": [
    {
      "text": "Implement AtomicLong in BandwidthLimiter + REST override endpoint",
      "project": "dcms",
      "projectEmoji": "🛰️",
      "date": "2026-04-15"
    }
  ],
  "history": [
    {
      "date": "2026-04-15",
      "project": "dcms",
      "projectEmoji": "🛰️",
      "title": "DB Param Renaming Continuation (Part 7)",
      "description": "PostgresJooqConfig: separated database and schema...",
      "types": ["bugfix", "refactor", "change", "discovery"]
    }
  ]
}
```

### Observations Type Badge Mapping

| Type | Emoji | Color |
|---|---|---|
| bugfix | 🐛 | `#ef4444` (red) |
| feature | 🟣 | `#f59e0b` (amber) |
| change | ✅ | `#22c55e` (green) |
| discovery | 🔵 | `#3b82f6` (blue) |
| decision | ⚖️ | `#06b6d4` (cyan) |
| refactor | 🔄 | `#a855f7` (purple) |

## TODO Refinement Prompt (Sonnet CLI)

Fixed model: `sonnet` (not configurable — validated as best cost/quality for this task).

```
You are a TODO filter for a developer dashboard. Given a list of "next_steps"
from AI session summaries, extract ONLY genuinely actionable TODO items.

RULES:
- KEEP: Concrete technical tasks (implement X, fix Y, add Z, configure W)
- KEEP: Decisions that need user input (choose A vs B)
- REMOVE: Session status messages ("session ending", "no work remaining")
- REMOVE: Already-completed items ("확정 완료", "등록 완료")
- REMOVE: Vague/passive items ("가능성 있음", "대기 중" without concrete action)
- REMOVE: Session lifecycle procedures ("session close", "develop merge")

For each kept item:
- Rewrite as a concise action starting with a verb (max 1 line)
- Keep the project tag and date

Output JSON array: [{"text": "...", "project": "...", "date": "..."}]
Only output the JSON array.
```

## Key Design Decisions

1. **Sonnet forced for TODO refinement** — Opus is more conservative but Sonnet produces cleaner, deduplicated output with better borderline-item inclusion. Cost is 1/5 of Opus. No config option exposed.

2. **session_summaries remains the source of truth** — `sdk_sessions.status='failed'` has 202 sessions with valid `completed` records. Switching to sdk_sessions-first would lose these. LEFT JOIN only for metadata.

3. **No user dismiss/complete UI** — Full automation: pattern matching + Sonnet refinement + cross-session completion detection + TTL expiry. No manual intervention needed.

4. **Observations as badges, not standalone entries** — Observations enrich existing History cards (via type badge aggregation per session) rather than creating their own timeline entries. Sessions without `session_summaries` are excluded from History — observations alone do not qualify a session for display. This preserves the session-centric narrative and avoids showing in-progress/incomplete sessions.

5. **DB change detection for TODO refresh** — Compare `MAX(created_at_epoch)` from `session_summaries` with cached value. Skip Sonnet CLI call if unchanged. Saves ~80% of hourly CLI calls.

6. **Cron replaces setTimeout recursion** — `node-cron` for all scheduling. Cleaner, more readable, standard pattern.

## Token Cost Estimate

| Item | Frequency | Tokens/call | Monthly |
|---|---|---|---|
| TODO (Sonnet) | ~3-5/day (DB change only) | ~1,550 | ~186K |
| Project Emojis (Sonnet) | Rare (new project) | ~500 | negligible |
| voice (config model) | 1/day | ~1,500 | ~45K |
| profile (config model) | 1/week | ~3,000 | ~12K |
| relationship (config model) | 1/week | ~2,000 | ~8K |
| philosophy (config model) | 1/week | ~2,000 | ~8K |
| avatarDecor (config model) | 1/week | ~1,000 | ~4K |
| **Monthly total** | | | **~263K** |

Previous monthly total (all daily): ~315K tokens. New design saves ~17% while adding TODO refinement.
