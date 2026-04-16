# TODO & History Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign TODO/History pipelines with Sonnet CLI refinement, observations type badges, project emojis, and cron-based cache scheduling.

**Architecture:** TODO pipeline adds Sonnet CLI as final refinement step after existing DB filters. History pipeline joins observations for type badges and sdk_sessions for titles. Cache scheduling moves from setTimeout recursion to node-cron with hourly/daily/weekly cycles. All changes build on the existing ESM + Express + better-sqlite3 stack.

**Tech Stack:** Node.js (ESM), Express 5, better-sqlite3, node-cron (new), Claude CLI (sonnet model for TODO)

**Spec:** `docs/superpowers/specs/2026-04-16-todo-history-redesign-design.md`

**Branch:** `feat/journey-query-rewrite` (already exists with partial work from brainstorming session)

**Testing:** This project has no test suite (per CLAUDE.md convention). Each task includes manual verification via `curl` and `node -e` commands.

---

## File Structure

### Modified
| File | Responsibility |
|---|---|
| `src/config.js` | Add `weekStartDay`, `refreshIntervalMin` defaults |
| `src/db.js` | Split `getJourney()` into `getJourneyTodo()` + `getJourneyHistory()`, add observations type aggregation |
| `src/claude-gen.js` | Add `refineTodo()`, `getProjectEmojis()`, replace `scheduleMidnightRefresh` with `scheduleRefreshCycles`, remove `clearAllCaches` |
| `server.js` | Wire cron scheduler, update `/api/journey` to use cached results |
| `public/index.html` | Render observations type badges + project emojis in `renderJourney()` |
| `config.json.example` | Add new config fields |
| `CLAUDE.md` | Document new config fields |

### New
| File | Responsibility |
|---|---|
| (none) | All changes go into existing files. Cache files (`todo-refined.json`, `history.json`, `project-emojis.json`) are generated at runtime. |

---

### Task 1: Add node-cron dependency + config defaults

**Files:**
- Modify: `package.json` (add node-cron)
- Modify: `src/config.js:8-14` (add weekStartDay, refreshIntervalMin to DEFAULTS)
- Modify: `src/config.js:39-45` (load new fields)
- Modify: `config.json.example:8-12` (add new fields)

- [ ] **Step 1: Install node-cron**

```bash
npm install node-cron
```

- [ ] **Step 2: Add weekStartDay and refreshIntervalMin to DEFAULTS in config.js**

In `src/config.js`, update the DEFAULTS object. The `excludedProjectNames` was already added during brainstorming — add the two new fields alongside it:

```js
const DEFAULTS = {
  port: 3000,
  accentColor: null,
  language: "en",
  journey: {
    todoLimit: 10,
    todoTtlDays: 14,
    historyLimit: 20,
    excludedProjectNames: ["Workspaces", "Workspace", "observer-sessions"],
    weekStartDay: 1,       // 0=Sun, 1=Mon, ..., 6=Sat
    refreshIntervalMin: 60,
  },
  claude: { model: "opus", cliPath: "claude" },
};
```

- [ ] **Step 3: Load new fields in loadConfig()**

In the `journey` section of `loadConfig()`:

```js
journey: {
  todoLimit: raw.journey?.todoLimit ?? DEFAULTS.journey.todoLimit,
  todoTtlDays: raw.journey?.todoTtlDays ?? DEFAULTS.journey.todoTtlDays,
  historyLimit: raw.journey?.historyLimit ?? DEFAULTS.journey.historyLimit,
  excludedProjectNames: Array.isArray(raw.journey?.excludedProjectNames)
    ? raw.journey.excludedProjectNames
    : DEFAULTS.journey.excludedProjectNames,
  weekStartDay: raw.journey?.weekStartDay ?? DEFAULTS.journey.weekStartDay,
  refreshIntervalMin: raw.journey?.refreshIntervalMin ?? DEFAULTS.journey.refreshIntervalMin,
},
```

- [ ] **Step 4: Update config.json.example**

```json
{
  "userName": "your-name",
  "role": "Your Role",
  "avatar": "🧑‍💻",
  "port": 3000,
  "accentColor": "#419BFF",
  "language": "en",
  "journey": {
    "todoLimit": 10,
    "todoTtlDays": 14,
    "historyLimit": 20,
    "excludedProjectNames": ["Workspaces", "Workspace", "observer-sessions"],
    "weekStartDay": 1,
    "refreshIntervalMin": 60
  },
  "claude": {
    "model": "opus",
    "cliPath": "claude"
  },
  "claudeMem": {
    "disableReadCache": false,
    "excludedProjects": []
  }
}
```

- [ ] **Step 5: Verify config loads correctly**

```bash
node -e "import('./src/config.js').then(({config}) => { console.log('weekStartDay:', config.journey.weekStartDay); console.log('refreshIntervalMin:', config.journey.refreshIntervalMin); console.log('excludedProjectNames:', config.journey.excludedProjectNames); })"
```

Expected: `weekStartDay: 1`, `refreshIntervalMin: 60`, `excludedProjectNames: [...]`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/config.js config.json.example
git commit -m "chore: add node-cron dependency and new journey config fields"
```

---

### Task 2: Rewrite db.js — split getJourney, add observations type aggregation

**Files:**
- Modify: `src/db.js:158-340` (rewrite getJourney into getJourneyTodo + getJourneyHistory)

- [ ] **Step 1: Replace getJourney() with getJourneyTodo() and getJourneyHistory()**

Keep everything above `getJourney()` unchanged (STOP_WORDS, extractWeightedTokens, weightedContainment, etc.). Replace `getJourney()` with two separate functions:

**getJourneyTodo()** — returns raw TODO candidates (before Sonnet refinement). This is the DB-level filter only. Sonnet refinement happens in claude-gen.js.

```js
export function getJourneyTodo() {
  if (!db) return [];

  const NOISE_PATTERNS = t.filters.noisePatterns;
  const noiseWhere = NOISE_PATTERNS.map(() => "next_steps NOT LIKE ?").join(" AND ");
  const noiseParams = NOISE_PATTERNS.map((p) => `%${p}%`);
  const excluded = buildExcludedProjectsClause("project");

  const ttlMs = (config.journey.todoTtlDays ?? 14) * 24 * 60 * 60 * 1000;
  const ttlCutoff = Date.now() - ttlMs;

  const lastNextStepsPerSession = db
    .prepare(
      `SELECT s.memory_session_id, s.next_steps, s.project, s.created_at_epoch
       FROM session_summaries s
       INNER JOIN (
         SELECT memory_session_id, MAX(created_at_epoch) as max_epoch
         FROM session_summaries
         WHERE next_steps IS NOT NULL AND LENGTH(next_steps) > 5
           AND ${excluded.sql}
           AND created_at_epoch >= ?
           AND ${noiseWhere}
         GROUP BY memory_session_id
       ) last ON s.memory_session_id = last.memory_session_id
         AND s.created_at_epoch = last.max_epoch
       WHERE s.next_steps IS NOT NULL AND LENGTH(s.next_steps) > 5
         AND NOT EXISTS (
           SELECT 1 FROM session_summaries s2
           WHERE s2.memory_session_id = s.memory_session_id
             AND s2.created_at_epoch > s.created_at_epoch
             AND s2.completed IS NOT NULL AND s2.completed != ''
         )
       ORDER BY s.created_at_epoch DESC
       LIMIT ${config.journey.todoLimit * 2}`
    )
    .all(...excluded.params, ttlCutoff, ...noiseParams);

  const sessionOrder = db
    .prepare(
      `SELECT memory_session_id, MIN(created_at_epoch) as session_start
       FROM session_summaries
       GROUP BY memory_session_id
       ORDER BY session_start ASC`
    )
    .all();

  const sessionIndex = new Map(
    sessionOrder.map((r, i) => [r.memory_session_id, i])
  );

  const NEXT_SESSION_RANGE = 5;

  return lastNextStepsPerSession
    .flatMap((r) => {
      const currentIdx = sessionIndex.get(r.memory_session_id);
      const lines = r.next_steps
        .split("\n")
        .map((l) => l.replace(/^[\s\-*]+/, "").trim())
        .filter((l) => l.length > 5);

      const date = r.created_at_epoch
        ? new Date(r.created_at_epoch).toISOString().split("T")[0]
        : "unknown";

      if (currentIdx == null || lines.length === 0) {
        return lines.length > 0
          ? [{ text: r.next_steps, project: r.project || "General", date }]
          : [];
      }

      const nextSessions = sessionOrder
        .slice(currentIdx + 1, currentIdx + 1 + NEXT_SESSION_RANGE)
        .map((s) => s.memory_session_id);

      if (nextSessions.length === 0) {
        return [{ text: r.next_steps, project: r.project || "General", date }];
      }

      const placeholders = nextSessions.map(() => "?").join(",");
      const completedInNext = db
        .prepare(
          `SELECT completed FROM session_summaries
           WHERE memory_session_id IN (${placeholders})
             AND completed IS NOT NULL AND completed != ''`
        )
        .all(...nextSessions);

      if (completedInNext.length === 0) {
        return [{ text: r.next_steps, project: r.project || "General", date }];
      }

      const remainingLines = lines.filter((line) => {
        return !completedInNext.some(
          (c) => weightedContainment(line, c.completed) >= COMPLETED_SIMILARITY_THRESHOLD
        );
      });

      if (remainingLines.length === 0) return [];
      return [{ text: remainingLines.join("\n"), project: r.project || "General", date }];
    })
    .slice(0, config.journey.todoLimit);
}
```

**getJourneyHistory()** — returns History with observations types.

```js
export function getJourneyHistory() {
  if (!db) return [];

  const excluded = buildExcludedProjectsClause("project");
  const recentActivityCutoff = Date.now() - 10 * 60 * 1000;

  const rows = db
    .prepare(
      `SELECT
         COALESCE(first.project, comp.project) as project,
         first.request, first.investigated,
         comp.completed, comp.created_at, comp.created_at_epoch,
         sdk.custom_title,
         first.memory_session_id
       FROM (
         SELECT memory_session_id, project, request, investigated, created_at_epoch
         FROM (
           SELECT memory_session_id, project, request, investigated, created_at_epoch,
                  ROW_NUMBER() OVER (
                    PARTITION BY memory_session_id
                    ORDER BY created_at_epoch ASC
                  ) as rn
           FROM session_summaries
           WHERE ${excluded.sql}
         )
         WHERE rn = 1
       ) first
       INNER JOIN (
         SELECT memory_session_id, project, completed,
                created_at, created_at_epoch,
                ROW_NUMBER() OVER (
                  PARTITION BY memory_session_id
                  ORDER BY created_at_epoch ASC
                ) as rn
         FROM session_summaries
         WHERE completed IS NOT NULL AND completed != ''
       ) comp ON first.memory_session_id = comp.memory_session_id
         AND comp.rn = 1
       LEFT JOIN sdk_sessions sdk
         ON sdk.memory_session_id = first.memory_session_id
       WHERE first.memory_session_id NOT IN (
         SELECT memory_session_id FROM sdk_sessions
         WHERE status = 'active' AND memory_session_id IS NOT NULL
       )
       AND first.memory_session_id NOT IN (
         SELECT memory_session_id FROM session_summaries
         WHERE created_at_epoch >= ?
         GROUP BY memory_session_id
       )
       ORDER BY first.created_at_epoch DESC
       LIMIT ${config.journey.historyLimit}`
    )
    .all(...excluded.params, recentActivityCutoff);

  const sessionIds = rows.map((r) => r.memory_session_id).filter(Boolean);
  const typesMap = new Map();

  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => "?").join(",");
    const typeRows = db
      .prepare(
        `SELECT memory_session_id, type
         FROM observations
         WHERE memory_session_id IN (${placeholders})
           AND type IS NOT NULL
         GROUP BY memory_session_id, type`
      )
      .all(...sessionIds);

    for (const row of typeRows) {
      if (!typesMap.has(row.memory_session_id)) {
        typesMap.set(row.memory_session_id, []);
      }
      typesMap.get(row.memory_session_id).push(row.type);
    }
  }

  return rows.map((r) => ({
    date: r.created_at ? r.created_at.split("T")[0] : "unknown",
    project: r.project || "General",
    title: r.custom_title || r.request || r.investigated || "Session",
    description: r.completed || "",
    types: typesMap.get(r.memory_session_id) || [],
  }));
}
```

**Keep getJourney() as a thin wrapper for backward compatibility:**

```js
export function getJourney() {
  return { todo: getJourneyTodo(), history: getJourneyHistory() };
}
```

Also add a helper to get the latest epoch (used by cache change detection):

```js
export function getLatestSummaryEpoch() {
  if (!db) return 0;
  const row = db
    .prepare("SELECT MAX(created_at_epoch) as latest FROM session_summaries")
    .get();
  return row?.latest || 0;
}
```

- [ ] **Step 2: Verify TODO query returns results**

```bash
node -e "import('./src/db.js').then(({getJourneyTodo}) => { const t = getJourneyTodo(); console.log('TODO count:', t.length); t.slice(0,3).forEach(x => console.log('-', x.project, x.text.slice(0,60))); })"
```

- [ ] **Step 3: Verify History query returns results with types**

```bash
node -e "import('./src/db.js').then(({getJourneyHistory}) => { const h = getJourneyHistory(); console.log('History count:', h.length); h.slice(0,3).forEach(x => console.log('-', x.project, x.types, x.title.slice(0,50))); })"
```

Expected: Each history item should have a `types` array like `["bugfix", "change", "discovery"]`.

- [ ] **Step 4: Verify getJourney wrapper still works**

```bash
node -e "import('./src/db.js').then(({getJourney}) => { const j = getJourney(); console.log('todo:', j.todo.length, 'history:', j.history.length); })"
```

- [ ] **Step 5: Commit**

```bash
git add src/db.js
git commit -m "refactor: split getJourney into getJourneyTodo + getJourneyHistory with observations types"
```

---

### Task 3: Add refineTodo, getProjectEmojis, and cron scheduler to claude-gen.js

**Files:**
- Modify: `src/claude-gen.js` (add new functions, replace scheduler, remove clearAllCaches)

- [ ] **Step 1: Add Sonnet-specific callClaude function**

Add below the existing `callClaude()` function (line ~50):

```js
async function callClaudeSonnet(prompt) {
  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const { stdout } = await execAsync(
      `echo '${escaped}' | ${config.claude.cliPath} --print --model sonnet`,
      { encoding: "utf-8", timeout: 120000 }
    );
    const result = stdout.trim();
    if (result.length > 10) return result;
  } catch (err) {
    console.warn("[claude-gen] Sonnet CLI call failed:", err.message);
  }
  return null;
}
```

- [ ] **Step 2: Add refineTodo() function**

Add after `parseJson()`:

```js
const TODO_REFINE_PROMPT = `You are a TODO filter for a developer dashboard. Given a list of "next_steps" from AI session summaries, extract ONLY genuinely actionable TODO items.

RULES:
- KEEP: Concrete technical tasks (implement X, fix Y, add Z, configure W)
- KEEP: Decisions that need user input (choose A vs B)
- REMOVE: Session status messages ("session ending", "no work remaining")
- REMOVE: Already-completed items ("completed", "done", "finished")
- REMOVE: Vague/passive items without concrete action
- REMOVE: Session lifecycle procedures ("session close", "develop merge")

For each kept item:
- Rewrite as a concise action starting with a verb (max 1 line)
- Keep the project tag and date

Output JSON array: [{"text": "...", "project": "...", "date": "..."}]
Only output the JSON array.`;

export async function refineTodo(rawTodo) {
  if (!rawTodo || rawTodo.length === 0) return [];

  const cached = readCache("todo-refined", config.journey.refreshIntervalMin * 60 * 1000);
  if (cached?.content) return cached.content;

  const input = rawTodo
    .map((t, i) => `[${i + 1}] ${t.text} (${t.project}, ${t.date})`)
    .join("\n");

  const result = await callClaudeSonnet(`${TODO_REFINE_PROMPT}\n\nINPUT:\n${input}`);
  if (result) {
    const parsed = parseJson(result);
    if (Array.isArray(parsed)) {
      const refined = parsed.slice(0, config.journey.todoLimit);
      writeCache("todo-refined", refined);
      return refined;
    }
  }

  console.warn("[claude-gen] TODO refinement failed, returning raw");
  return rawTodo.slice(0, config.journey.todoLimit);
}
```

- [ ] **Step 3: Add getProjectEmojis() function**

```js
const PROJECT_EMOJI_PROMPT = `Given these software project names, assign one emoji that represents each project's likely domain. Output JSON: {"projectName": "emoji", ...}. Only output the JSON object.`;

export async function getProjectEmojis(projectNames) {
  const cached = readCache("project-emojis", Infinity);
  const existing = cached?.content || {};

  const missing = projectNames.filter(
    (n) => n && n !== "General" && !existing[n]
  );
  if (missing.length === 0) return existing;

  const result = await callClaudeSonnet(
    `${PROJECT_EMOJI_PROMPT}\n\nProjects: ${missing.join(", ")}`
  );
  if (result) {
    const parsed = parseJson(result);
    if (parsed && typeof parsed === "object") {
      const merged = { ...existing, ...parsed };
      writeCache("project-emojis", merged);
      return merged;
    }
  }

  return existing;
}
```

- [ ] **Step 4: Replace clearAllCaches with individual invalidation**

Remove the existing `clearAllCaches()` function. Replace with:

```js
export function invalidateCaches(...types) {
  for (const type of types) {
    try { unlinkSync(cachePath(type)); } catch { /* miss */ }
  }
}
```

- [ ] **Step 5: Add cron-based scheduleRefreshCycles()**

Add at the bottom of the file, importing node-cron at the top:

At the top of the file, add:
```js
import cron from "node-cron";
```

Then add the scheduler function:

```js
export function scheduleRefreshCycles(refreshJourney) {
  const intervalMin = config.journey.refreshIntervalMin ?? 60;
  const weekDay = config.journey.weekStartDay ?? 1;

  // Hourly: refresh TODO + History
  cron.schedule(`*/${intervalMin} * * * *`, () => {
    console.log(`[${new Date().toISOString()}] Cron: journey refresh`);
    refreshJourney();
  });

  // Daily midnight: invalidate voice
  cron.schedule("0 0 * * *", () => {
    console.log(`[${new Date().toISOString()}] Cron: daily voice refresh`);
    invalidateCaches("voice");
  });

  // Weekly: invalidate profile, relationship, philosophy, avatarDecor, accentColor
  cron.schedule(`0 0 * * ${weekDay}`, () => {
    console.log(`[${new Date().toISOString()}] Cron: weekly refresh`);
    invalidateCaches("profile", "relationship", "philosophy", "avatar-decor", "accent-color");
  });

  console.log(`  Cron: journey every ${intervalMin}m, voice daily, weekly on day ${weekDay}`);
}
```

- [ ] **Step 6: Verify refineTodo works with Sonnet CLI**

```bash
node -e "
import('./src/db.js').then(async ({getJourneyTodo}) => {
  const { refineTodo } = await import('./src/claude-gen.js');
  const raw = getJourneyTodo();
  console.log('Raw TODO:', raw.length);
  const refined = await refineTodo(raw);
  console.log('Refined TODO:', refined.length);
  refined.slice(0,3).forEach(t => console.log('-', t.text.slice(0,80)));
});
"
```

Expected: Refined TODO items are concise, verb-first, fewer than raw.

- [ ] **Step 7: Commit**

```bash
git add src/claude-gen.js
git commit -m "feat: add Sonnet TODO refinement, project emojis, and cron-based cache scheduler"
```

---

### Task 4: Wire cron scheduler and update API in server.js

**Files:**
- Modify: `server.js` (replace scheduleMidnightRefresh, update journey API)

- [ ] **Step 1: Rewrite server.js**

Replace the entire file:

```js
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./src/config.js";
import { t, interpolate } from "./src/i18n.js";
import { getStats, getJourneyTodo, getJourneyHistory, getLatestSummaryEpoch } from "./src/db.js";
import {
  getProfile, getRelationship, getPhilosophy, getVoice,
  getAvatarDecor, getAccentColor,
  refineTodo, getProjectEmojis, scheduleRefreshCycles,
  readCache, writeCache,
} from "./src/claude-gen.js";
import { patchClaudeMemHooks, syncExcludedProjects } from "./src/hooks-patcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = config.port;
const JOURNEY_TTL = (config.journey.refreshIntervalMin ?? 60) * 60 * 1000;

const app = express();
app.use(express.static(join(__dirname, "public")));

app.get("/api/config", async (_req, res) => {
  const accent = await getAccentColor();
  res.json({
    userName: config.userName,
    role: config.role,
    avatar: config.avatar,
    accentColor: accent.accentColor || "#419BFF",
    language: config.language,
    ui: t.ui,
  });
});

app.get("/api/stats", (_req, res) => res.json(getStats()));

app.get("/api/journey", async (_req, res) => {
  const cached = readCache("journey", JOURNEY_TTL);
  if (cached?.content) return res.json(cached.content);

  const result = await buildJourney();
  res.json(result);
});

app.get("/api/profile", async (_req, res) => res.json(await getProfile(getStats())));
app.get("/api/relationship", async (_req, res) => res.json(await getRelationship(getStats())));
app.get("/api/philosophy", async (_req, res) => res.json(await getPhilosophy(getStats())));
app.get("/api/claude-voice", async (_req, res) => res.json(await getVoice(getStats())));

app.get("/api/avatar-decor", async (_req, res) => {
  const result = await getAvatarDecor();
  res.json(result);
});

app.get("/api/accent-color", async (_req, res) => {
  const result = await getAccentColor();
  res.json(result);
});

let lastKnownEpoch = 0;

async function buildJourney() {
  const rawTodo = getJourneyTodo();
  const history = getJourneyHistory();

  const allProjects = [
    ...new Set([
      ...rawTodo.map((t) => t.project),
      ...history.map((h) => h.project),
    ]),
  ];
  const emojis = await getProjectEmojis(allProjects);

  const todo = await refineTodo(rawTodo);
  const todoWithEmoji = todo.map((t) => ({
    ...t,
    projectEmoji: emojis[t.project] || "",
  }));
  const historyWithEmoji = history.map((h) => ({
    ...h,
    projectEmoji: emojis[h.project] || "",
  }));

  const result = { todo: todoWithEmoji, history: historyWithEmoji };
  writeCache("journey", result);
  return result;
}

async function refreshJourney() {
  const currentEpoch = getLatestSummaryEpoch();
  if (currentEpoch === lastKnownEpoch) {
    console.log(`[${new Date().toISOString()}] Journey: no DB changes, skipping`);
    return;
  }
  lastKnownEpoch = currentEpoch;

  try {
    await buildJourney();
    console.log(`[${new Date().toISOString()}] Journey: refreshed`);
  } catch (err) {
    console.warn("[journey] Refresh failed:", err.message);
  }
}

app.listen(PORT, () => {
  console.log(`\n  claude-with-me is running at http://localhost:${PORT}`);

  scheduleRefreshCycles(refreshJourney);
  refreshJourney();

  const hookResult = patchClaudeMemHooks(config.claudeMem);
  console.log(`  [hooks] ${hookResult.patched ? hookResult.message : "No patch needed: " + hookResult.message}`);

  const excludeResult = syncExcludedProjects(config.claudeMem);
  console.log(`  [exclude] ${excludeResult.synced ? excludeResult.message : excludeResult.message}`);
});
```

- [ ] **Step 2: Export readCache and writeCache from claude-gen.js**

In `src/claude-gen.js`, change the two functions from plain functions to named exports:

```js
export function readCache(type, ttlMs) {
  // ... existing body ...
}

export function writeCache(type, content) {
  // ... existing body ...
}
```

- [ ] **Step 3: Verify server starts and API works**

```bash
node server.js &
sleep 3
curl -s http://localhost:930/api/journey | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const j=JSON.parse(d);
console.log('todo:', j.todo.length, 'history:', j.history.length);
if(j.todo[0]) console.log('todo[0]:', j.todo[0].projectEmoji, j.todo[0].text?.slice(0,60));
if(j.history[0]) console.log('hist[0]:', j.history[0].projectEmoji, j.history[0].types, j.history[0].title?.slice(0,50));
"
kill %1
```

Expected: todo/history counts > 0, projectEmoji present, types array present.

- [ ] **Step 4: Commit**

```bash
git add server.js src/claude-gen.js
git commit -m "feat: wire cron scheduler and journey cache with Sonnet refinement"
```

---

### Task 5: Update renderJourney() in index.html for type badges + project emojis

**Files:**
- Modify: `public/index.html:981-1019` (renderJourney function)

- [ ] **Step 1: Update TODO rendering**

Replace the existing TODO section in `renderJourney()`:

```js
function renderJourney(journey) {
  // Observations type badge config
  const TYPE_BADGES = {
    bugfix:    { emoji: '🐛', color: '#ef4444' },
    feature:   { emoji: '🟣', color: '#f59e0b' },
    change:    { emoji: '✅', color: '#22c55e' },
    discovery: { emoji: '🔵', color: '#3b82f6' },
    decision:  { emoji: '⚖️', color: '#06b6d4' },
    refactor:  { emoji: '🔄', color: '#a855f7' },
  };

  // TODO List
  if (journey.todo && journey.todo.length > 0) {
    document.getElementById('upcoming').innerHTML =
      `<h3 style="color:#f59e0b;font-size:1.2rem;margin-bottom:16px;">📋 ${appConfig.ui?.todoTitle || 'TODO List'}</h3>` +
      journey.todo.map(t => {
        const projLabel = t.projectEmoji ? `${t.projectEmoji} ${t.project}` : t.project;
        const badge = t.project ? `<span style="display:inline-block;padding:1px 8px;background:rgba(245,158,11,0.1);color:#f59e0b;border-radius:10px;font-size:0.7rem;margin-left:6px;">${projLabel}</span>` : '';
        const dateBadge = t.date && t.date !== 'unknown' ? `<span style="display:inline-block;padding:1px 8px;background:rgba(100,116,139,0.1);color:#64748b;border-radius:10px;font-size:0.65rem;margin-left:6px;">${t.date}</span>` : '';
        return `<div style="padding:10px 14px;margin-bottom:8px;background:#111827;border:1px solid #1e293b;border-left:3px solid #f59e0b;border-radius:8px;font-size:0.88rem;color:#94a3b8;line-height:1.6;">
          <div style="margin-bottom:4px;color:#e2e8f0;">${t.text}</div>
          <div>${badge}${dateBadge}</div>
        </div>`;
      }).join('');
  } else {
    document.getElementById('upcoming').innerHTML = '';
  }

  // History - grouped by date
  if (journey.history && journey.history.length > 0) {
    const grouped = {};
    for (const t of journey.history) {
      if (!grouped[t.date]) grouped[t.date] = [];
      grouped[t.date].push(t);
    }
    document.getElementById('journey-timeline').innerHTML =
      `<h3 style="color:var(--accent-cyan);font-size:1.2rem;margin-bottom:16px;">📜 ${appConfig.ui?.historyTitle || 'History'}</h3>` +
      Object.entries(grouped).map(([date, items]) =>
        `<div style="margin-bottom:24px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;color:#f8fafc;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--card-border);">${date}</div>
          ${items.map(t => {
            const projLabel = t.projectEmoji ? `${t.projectEmoji} ${t.project}` : t.project;
            const typeBadges = (t.types || [])
              .map(type => {
                const badge = TYPE_BADGES[type];
                if (!badge) return '';
                return `<span style="display:inline-block;padding:2px 8px;background:${badge.color}15;color:${badge.color};border-radius:12px;font-size:0.65rem;">${badge.emoji} ${type}</span>`;
              })
              .filter(Boolean)
              .join(' ');
            return `<div class="timeline-item">
              <div class="tl-date" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="display:inline-block;padding:1px 8px;background:color-mix(in srgb, var(--accent-user) 10%, transparent);color:var(--accent-user);border-radius:10px;font-size:0.7rem;">${projLabel}</span>
                ${typeBadges}
              </div>
              <div class="tl-title">${t.title}</div>
              <div class="tl-desc">${t.description}</div>
            </div>`;
          }).join('')}
        </div>`
      ).join('');
  } else {
    document.getElementById('journey-timeline').innerHTML = '';
  }
}
```

- [ ] **Step 2: Restart service and verify in browser**

```bash
launchctl kickstart -k gui/$(id -u)/com.rok-root.claude-with-me
sleep 3
curl -s http://localhost:930/api/journey | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('=== TODO ===')
for t in d['todo'][:3]:
    print(f\"  {t.get('projectEmoji','')} [{t['project']}] {t['text'][:60]}\")
print('=== HISTORY ===')
for h in d['history'][:3]:
    print(f\"  {h.get('projectEmoji','')} [{h['project']}] {h.get('types',[])} {h['title'][:50]}\")
"
```

Open http://localhost:930 in browser and verify:
- TODO items show project emoji + concise verb-first text
- History items show project emoji + type badges (colorful pills)

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: render observations type badges and project emojis in dashboard"
```

---

### Task 6: Update documentation — CLAUDE.md + README.md

**Files:**
- Modify: `CLAUDE.md` (add new config docs)
- Modify: `README.md` (add token cost section)

- [ ] **Step 1: Update CLAUDE.md config section**

Add to the Key settings list under Configuration:

```markdown
- `journey.weekStartDay` — Day of week for weekly cache refresh (0=Sun, 1=Mon default)
- `journey.refreshIntervalMin` — TODO/History refresh interval in minutes (default 60)
- `journey.excludedProjectNames` — Noise project names filtered from TODO/History (default: `["Workspaces", "Workspace", "observer-sessions"]`)
```

Also update the Key Behaviors section, replacing the caching bullet:

```markdown
- **Caching:** AI-generated content is cached with tiered refresh: hourly (TODO/History), daily (voice), weekly on `weekStartDay` (profile/relationship/philosophy). Uses `node-cron` for scheduling.
- **TODO refinement:** Raw next_steps are filtered by Sonnet CLI to extract actionable items only. No user configuration needed.
```

- [ ] **Step 2: Update README.md with token cost info**

Add a "Resource Usage" section:

```markdown
## Resource Usage

claude-with-me uses Claude CLI for AI-generated content. Estimated monthly token usage:

| Item | Model | Frequency | Monthly Tokens |
|---|---|---|---|
| TODO refinement | Sonnet | ~3-5×/day | ~186K |
| Voice message | Config model | Daily | ~45K |
| Profile/Relationship/Philosophy | Config model | Weekly | ~28K |
| Avatar decor | Config model | Weekly | ~4K |
| **Total** | | | **~263K** |

**Cost:** With Claude CLI (Pro/Max subscription), these tokens are included in your plan at no additional charge. If using the API directly, estimated cost is ~$3/month.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: update config docs and add resource usage to README"
```

---

## Verification Checklist

After all tasks are complete, verify end-to-end:

- [ ] `npm start` — server starts without errors, cron schedules logged
- [ ] `curl http://localhost:930/api/journey` — returns `todo` with refined items + `projectEmoji`, `history` with `types` array + `projectEmoji`
- [ ] Browser at http://localhost:930 — TODO shows emoji + verb-first items, History shows type badges
- [ ] Wait 1 hour (or temporarily set `refreshIntervalMin: 1`) — cron fires, journal refreshed
- [ ] Cache files exist: `cache/todo-refined.json`, `cache/journey.json`, `cache/project-emojis.json`
