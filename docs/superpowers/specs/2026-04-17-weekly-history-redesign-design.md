# Weekly & History Redesign

## Background

claude-with-me is a personal dashboard that visualizes a developer's collaboration journey with Claude Code. After the TODO feature was removed (2026-04-16 council decision), the dashboard's identity is "honest historian" — showing what we've done, not what to do next.

The current History section has data quality issues, and there's no way to see "what we did this week" at a glance. This redesign adds a Weekly activity section and fixes History to properly represent our sessions.

## Goals

1. **Weekly section** — Show this week's activity using observation data, grouped by project and type
2. **History improvement** — Fix data gaps, use `sdk_sessions` as source of truth, accurate session titles
3. **No AI interpretation** — Weekly and History use DB data directly. No Claude CLI calls for content generation.
4. **Preserve existing sections** — Profile, Relationship, Philosophy, Voice, Avatar Decor remain unchanged (they ARE claude-with-me's identity)

## Non-Goals

- No task management / TODO features
- No AI-generated summaries for Weekly or History
- No milestone detection or automatic event highlighting

## Design

### Weekly Section (New)

**Data source**: `observations` table, filtered to current week (Monday 00:00 ~ Sunday 23:59, based on `config.journey.weekStartDay`).

**Structure**:
- Grouped by project, then by observation type
- Per-project count with type breakdown (discovery, bugfix, feature, refactor, change, decision)
- Week-level summary stats: total observations, total sessions, total projects

**Display** (positioned above History):
```
This Week  4/14 (Mon) ~ 4/20 (Sun)

  🛰️ dcms (12)
    🔵 discovery ×5  🟣 feature ×3  🔄 refactor ×2  🔴 bugfix ×2

  🤝 claude-with-me (8)
    🔵 discovery ×4  🟣 feature ×2  ⚖️ decision ×1  🔴 bugfix ×1

  23 observations · 14 sessions · 3 projects
```

**Filters**:
- `config.journey.excludedProjectNames` applied (same as History)
- Only observations with non-null `type` field

**Refresh**: Same `refreshIntervalMin` cron cycle as History. Also refreshes on `weekStartDay` cron (full reset for new week).

**API**: `GET /api/weekly`

**Response**:
```json
{
  "weekStart": "2026-04-14",
  "weekEnd": "2026-04-20",
  "projects": [
    {
      "name": "dcms",
      "emoji": "🛰️",
      "total": 12,
      "types": {
        "discovery": 5,
        "feature": 3,
        "refactor": 2,
        "bugfix": 2
      }
    }
  ],
  "stats": {
    "totalObservations": 23,
    "totalSessions": 14,
    "totalProjects": 3
  },
  "generatedAt": "2026-04-17T09:00:00.000Z"
}
```

### History Section (Improved)

**Current problems**:
- `session_summaries` as primary table causes sessions without summaries to be invisible
- `completed` field often empty, making many sessions show blank descriptions
- `observer-sessions` project name pollution from claude-mem worker cwd bug
- `ROW_NUMBER()` partition logic sometimes selects wrong summary row

**New query design**:
- **Primary table**: `sdk_sessions` (every session has a record here)
- **JOIN**: `session_summaries` for request/completed text (LEFT JOIN, may be absent)
- **JOIN**: `observations` for type badges (LEFT JOIN, aggregated)
- Filter: `memory_session_id IS NOT NULL` (exclude untracked sessions)
- Filter: `status != 'active'` (exclude in-progress sessions)
- Filter: `started_at_epoch < (now - 5 minutes)` (exclude very recent sessions)
- Filter: `excludedProjectNames` applied on `sdk_sessions.project`

**Title priority**:
1. `sdk_sessions.custom_title`
2. `session_summaries.request` (first row by epoch)
3. `session_summaries.investigated`
4. `"Session"` (fallback)

**Description priority**:
1. `session_summaries.completed` (latest row by epoch)
2. Empty string (don't force content)

**Display** (unchanged structure, better data):
```
📅 2026-04-16 | 🛰️ dcms | claude-mem memory_session_id NULL 버그 디버깅
  orphan 12.1.3 삭제, SDK --setting-sources 패치로 최종 해결
  [🔵 discovery] [🔴 bugfix]
```

**API**: `GET /api/journey` (existing endpoint, improved response)

**Response** (same shape as current, better data):
```json
{
  "history": [
    {
      "date": "2026-04-16",
      "project": "dcms",
      "title": "claude-mem memory_session_id NULL 버그 디버깅",
      "description": "orphan 12.1.3 삭제, SDK --setting-sources 패치로 최종 해결",
      "types": ["discovery", "bugfix"]
    }
  ],
  "generatedAt": "2026-04-17T09:00:00.000Z"
}
```

### Observation Type Badge Mapping

| Type | Emoji | Label |
|------|-------|-------|
| bugfix | 🔴 | bugfix |
| feature | 🟣 | feature |
| change | ✅ | change |
| discovery | 🔵 | discovery |
| decision | ⚖️ | decision |
| refactor | 🔄 | refactor |

### Cache & Refresh Strategy

No changes to existing cron structure. Weekly uses the same cycles:

| Schedule | Items |
|----------|-------|
| Every `refreshIntervalMin` (default 60m) | Weekly, History (DB query only, no AI) |
| Weekly on `weekStartDay` | Profile, Relationship, Philosophy, Avatar Decor, Accent Color |
| Daily midnight | Voice |

Weekly and History refresh are pure DB queries — no token cost.

## File Changes

### Modified

| File | Changes |
|------|---------|
| `src/db.js` | Add `getWeeklyActivity()`. Rewrite `getJourneyHistory()`: sdk_sessions as primary, 5-min cutoff, improved title/description logic |
| `server.js` | Add `GET /api/weekly` endpoint with cache. Update journey cache to use improved query |
| `public/index.html` | Add Weekly section UI above History. Update History rendering if data shape changes |
| `i18n/en.json` | Add Weekly labels (`thisWeek`, `observations`, `sessions`, `projects`) |
| `i18n/ko.json` | Add Weekly labels (Korean) |

### No Changes

| File | Reason |
|------|--------|
| `src/claude-gen.js` | Weekly has no AI calls. Existing cron handles refresh. |
| `src/config.js` | `weekStartDay`, `excludedProjectNames`, `refreshIntervalMin` already exist |
| `src/hooks-patcher.js` | Unrelated |

### Cleanup Candidates

Review and remove if no longer needed:
- Previous TODO-related spec: `docs/superpowers/specs/2026-04-16-todo-history-redesign-design.md`
- Previous TODO-related plan: `docs/superpowers/plans/2026-04-16-todo-history-redesign.md`

## Token Cost Impact

**Net change: 0 additional tokens.** Weekly and History improvements are pure DB queries. No new Claude CLI calls introduced. Existing AI-generated sections (Profile, Relationship, Philosophy, Voice, Avatar Decor) remain on their current schedules.

## Key Design Decisions

1. **No AI interpretation for Weekly/History** — "honest historian" principle. DB data presented as-is. AI generates personality (Profile/Relationship/Philosophy), not facts.

2. **sdk_sessions as History source of truth** — Every interactive session creates an sdk_sessions record. session_summaries may be absent for short sessions. Using sdk_sessions as primary ensures no session is invisible.

3. **Observation-based Weekly, Session-based History** — Clean separation: Weekly shows granular activities (what type of work), History shows session narratives (what was accomplished). No overlap.

4. **5-minute recent session exclusion** — Prevents showing the current active session in History. Shorter than previous 10-minute window for faster feedback.

5. **excludedProjectNames shared filter** — Same config drives both Weekly and History exclusions. Single source of truth.
