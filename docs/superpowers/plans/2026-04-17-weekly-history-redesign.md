# Weekly & History Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Weekly activity section (observation-based) and improve History data quality (sdk_sessions as primary source), with no AI calls for either.

**Architecture:** `src/db.js` gets two functions: `getWeeklyActivity()` (observation aggregation by project/type for current week) and a rewritten `getJourneyHistory()` (sdk_sessions-first with improved title/description logic). `server.js` adds `/api/weekly` endpoint with cache. `public/index.html` renders the Weekly section above History. i18n files get new labels.

**Tech Stack:** Node.js (ESM), Express 5, better-sqlite3, vanilla HTML/JS

---

### Task 1: Add `getWeeklyActivity()` to `src/db.js`

**Files:**
- Modify: `src/db.js`

- [ ] **Step 1: Add `getWeeklyActivity()` function**

Add after the existing `getLatestSummaryEpoch()` function. This queries observations for the current week, grouped by project and type.

```javascript
export function getWeeklyActivity() {
  if (!db) return { projects: [], stats: { totalObservations: 0, totalSessions: 0, totalProjects: 0 } };

  const weekStartDay = config.journey.weekStartDay ?? 1; // 0=Sun, 1=Mon
  const now = new Date();
  const currentDay = now.getDay();
  const diffToStart = (currentDay - weekStartDay + 7) % 7;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - diffToStart);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const weekStartEpoch = weekStart.getTime();
  const weekEndEpoch = weekEnd.getTime();

  const excluded = buildExcludedProjectsClause("project");

  const rows = db
    .prepare(
      `SELECT project, type, COUNT(*) as count
       FROM observations
       WHERE created_at_epoch >= ? AND created_at_epoch < ?
         AND type IS NOT NULL
         AND ${excluded.sql}
       GROUP BY project, type
       ORDER BY project, count DESC`
    )
    .all(weekStartEpoch, weekEndEpoch, ...excluded.params);

  const sessionCount = db
    .prepare(
      `SELECT COUNT(DISTINCT memory_session_id) as count
       FROM observations
       WHERE created_at_epoch >= ? AND created_at_epoch < ?
         AND ${excluded.sql}`
    )
    .get(weekStartEpoch, weekEndEpoch, ...excluded.params);

  // Group by project
  const projectMap = new Map();
  for (const row of rows) {
    const existing = projectMap.get(row.project) ?? { name: row.project, total: 0, types: {} };
    existing.types[row.type] = row.count;
    existing.total += row.count;
    projectMap.set(row.project, existing);
  }

  // Sort projects by total descending
  const projects = [...projectMap.values()].sort((a, b) => b.total - a.total);

  const totalObservations = projects.reduce((sum, p) => sum + p.total, 0);

  return {
    weekStart: weekStart.toISOString().split("T")[0],
    weekEnd: new Date(weekEnd.getTime() - 1).toISOString().split("T")[0],
    projects,
    stats: {
      totalObservations,
      totalSessions: sessionCount?.count || 0,
      totalProjects: projects.length,
    },
  };
}
```

- [ ] **Step 2: Verify no syntax errors**

Run: `node -e "import('./src/db.js').then(m => { console.log(Object.keys(m)); })"`
Expected: Array including `getWeeklyActivity`

- [ ] **Step 3: Quick smoke test**

Run: `node -e "import('./src/db.js').then(m => { const w = m.getWeeklyActivity(); console.log(JSON.stringify(w, null, 2)); })"`
Expected: JSON with `weekStart`, `weekEnd`, `projects` array, `stats` object

---

### Task 2: Rewrite `getJourneyHistory()` in `src/db.js`

**Files:**
- Modify: `src/db.js`

- [ ] **Step 1: Replace `getJourneyHistory()` with sdk_sessions-first query**

Replace the entire existing `getJourneyHistory()` function:

```javascript
export function getJourneyHistory() {
  if (!db) return [];

  const excluded = buildExcludedProjectsClause("sdk.project");
  const recentCutoff = Date.now() - 5 * 60 * 1000;

  const rows = db
    .prepare(
      `SELECT
         sdk.memory_session_id,
         sdk.project,
         sdk.custom_title,
         sdk.started_at,
         sdk.started_at_epoch,
         first_ss.request,
         first_ss.investigated,
         latest_ss.completed
       FROM sdk_sessions sdk
       LEFT JOIN (
         SELECT memory_session_id, request, investigated,
                ROW_NUMBER() OVER (
                  PARTITION BY memory_session_id
                  ORDER BY created_at_epoch ASC
                ) as rn
         FROM session_summaries
       ) first_ss ON first_ss.memory_session_id = sdk.memory_session_id AND first_ss.rn = 1
       LEFT JOIN (
         SELECT memory_session_id, completed,
                ROW_NUMBER() OVER (
                  PARTITION BY memory_session_id
                  ORDER BY created_at_epoch DESC
                ) as rn
         FROM session_summaries
         WHERE completed IS NOT NULL AND completed != ''
       ) latest_ss ON latest_ss.memory_session_id = sdk.memory_session_id AND latest_ss.rn = 1
       WHERE sdk.memory_session_id IS NOT NULL
         AND sdk.status != 'active'
         AND sdk.started_at_epoch < ?
         AND ${excluded.sql}
       ORDER BY sdk.started_at_epoch DESC
       LIMIT ${config.journey.historyLimit}`
    )
    .all(recentCutoff, ...excluded.params);

  if (rows.length === 0) return [];

  // Fetch observation types for matched sessions
  const sessionIds = rows.map((r) => r.memory_session_id);
  const obsPlaceholders = sessionIds.map(() => "?").join(",");
  const obsRows = db
    .prepare(
      `SELECT memory_session_id, type
       FROM observations
       WHERE memory_session_id IN (${obsPlaceholders}) AND type IS NOT NULL
       GROUP BY memory_session_id, type`
    )
    .all(...sessionIds);

  const typesMap = new Map();
  for (const obs of obsRows) {
    const existing = typesMap.get(obs.memory_session_id) ?? [];
    typesMap.set(obs.memory_session_id, [...existing, obs.type]);
  }

  return rows.map((r) => ({
    date: r.started_at ? r.started_at.split("T")[0] : "unknown",
    project: r.project || "General",
    title: r.custom_title || r.request || r.investigated || "Session",
    description: r.completed || "",
    types: typesMap.get(r.memory_session_id) ?? [],
  }));
}
```

- [ ] **Step 2: Verify query works**

Run: `node -e "import('./src/db.js').then(m => { const h = m.getJourneyHistory(); console.log('Count:', h.length); if (h[0]) console.log('First:', JSON.stringify(h[0], null, 2)); })"`
Expected: History items with proper titles (custom_title preferred)

---

### Task 3: Add `/api/weekly` endpoint and update `server.js`

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add import for `getWeeklyActivity`**

Update the import line at the top of `server.js`:

```javascript
import { getStats, getJourneyHistory, getLatestSummaryEpoch, getWeeklyActivity } from "./src/db.js";
```

- [ ] **Step 2: Add `/api/weekly` endpoint**

Add after the existing `/api/journey` route:

```javascript
const WEEKLY_TTL = JOURNEY_TTL; // Same refresh interval

app.get("/api/weekly", async (_req, res) => {
  const cached = readCache("weekly", WEEKLY_TTL);
  if (cached?.content) {
    return res.json({ ...cached.content, generatedAt: cached.generatedAt });
  }
  const result = await buildWeekly();
  res.json(result);
});
```

- [ ] **Step 3: Add `buildWeekly()` and `refreshWeekly()` functions**

Add after the existing `refreshJourney()` function:

```javascript
async function buildWeekly() {
  const weekly = getWeeklyActivity();

  const allProjects = weekly.projects.map((p) => p.name);
  const emojis = await getProjectEmojis(allProjects);

  const projectsWithEmoji = weekly.projects.map((p) => ({
    ...p,
    emoji: emojis[p.name] || "",
  }));

  const payload = { ...weekly, projects: projectsWithEmoji };
  const written = writeCache("weekly", payload);
  return { ...payload, generatedAt: written.generatedAt };
}

async function refreshWeekly() {
  try {
    await buildWeekly();
    console.log(`[${new Date().toISOString()}] Weekly: refreshed`);
  } catch (err) {
    console.warn("[weekly] Refresh failed:", err.message);
  }
}
```

- [ ] **Step 4: Wire `refreshWeekly` into startup**

Update the `app.listen` callback — add `refreshWeekly()` call after `refreshJourney()`:

```javascript
  scheduleRefreshCycles(refreshJourney, refreshWeekly);
  refreshJourney();
  refreshWeekly();
```

- [ ] **Step 5: Update `scheduleRefreshCycles` to accept `refreshWeekly`**

In `src/claude-gen.js`, update the function signature and add weekly to the hourly cron:

```javascript
export function scheduleRefreshCycles(refreshJourney, refreshWeekly) {
  const intervalMin = config.journey.refreshIntervalMin ?? 60;
  const weekDay = config.journey.weekStartDay ?? 1;

  cron.schedule(`*/${intervalMin} * * * *`, () => {
    console.log(`[${new Date().toISOString()}] Cron: journey + weekly refresh`);
    refreshJourney();
    refreshWeekly();
  });

  cron.schedule("0 0 * * *", () => {
    console.log(`[${new Date().toISOString()}] Cron: daily voice refresh`);
    invalidateCaches("voice");
  });

  cron.schedule(`0 0 * * ${weekDay}`, () => {
    console.log(`[${new Date().toISOString()}] Cron: weekly refresh`);
    invalidateCaches("profile", "relationship", "philosophy", "avatar-decor", "accent-color", "weekly");
  });

  console.log(`  Cron: journey+weekly every ${intervalMin}m, voice daily, weekly on day ${weekDay}`);
}
```

- [ ] **Step 6: Verify server starts**

Run: `node server.js &` then `curl -s http://localhost:3000/api/weekly | head -c 500`
Expected: JSON response with `weekStart`, `projects`, `stats`
Cleanup: Kill the server process

---

### Task 4: Add i18n labels

**Files:**
- Modify: `i18n/ko.json`
- Modify: `i18n/en.json`

- [ ] **Step 1: Add Korean labels**

Add to the `"ui"` section of `i18n/ko.json`:

```json
"weeklyTitle": "This Week",
"weeklyObservations": "observations",
"weeklySessions": "sessions",
"weeklyProjects": "projects"
```

- [ ] **Step 2: Add English labels**

Add to the `"ui"` section of `i18n/en.json`:

```json
"weeklyTitle": "This Week",
"weeklyObservations": "observations",
"weeklySessions": "sessions",
"weeklyProjects": "projects"
```

- [ ] **Step 3: Commit**

```bash
git add i18n/en.json i18n/ko.json
git commit -m "feat: add weekly i18n labels"
```

---

### Task 5: Add Weekly section UI to `public/index.html`

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add Weekly section HTML**

Add before the `<!-- JOURNEY TIMELINE -->` comment (before line 721):

```html
  <!-- WEEKLY ACTIVITY -->
  <div class="weekly-section" id="weekly-section" style="display:none;">
    <div class="section-title"><span class="icon">📊</span> <span id="weekly-title">This Week</span> <span class="section-meta" id="weekly-meta"></span></div>
    <div id="weekly-content" class="weekly-content"></div>
  </div>
```

- [ ] **Step 2: Add Weekly CSS**

Add before the `/* ===== ERROR MESSAGE ===== */` comment in the `<style>` section:

```css
  /* ===== WEEKLY ACTIVITY ===== */
  .weekly-section {
    margin-bottom: 56px;
  }

  .weekly-date-range {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.8rem;
    color: var(--text-dim);
    margin-bottom: 16px;
  }

  .weekly-project {
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 12px;
  }

  .weekly-project-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .weekly-project-name {
    font-weight: 700;
    color: var(--text-bright);
    font-size: 0.95rem;
  }

  .weekly-project-count {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  .weekly-types {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .weekly-type-badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 0.7rem;
    font-weight: 500;
  }

  .weekly-stats {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.8rem;
    color: var(--text-dim);
    margin-top: 16px;
    text-align: center;
  }
```

- [ ] **Step 3: Add `renderWeekly()` function and integrate into load**

Add before the `renderJourney` function in the `<script>` section:

```javascript
function renderWeekly(weekly) {
  const section = document.getElementById('weekly-section');
  const content = document.getElementById('weekly-content');
  if (!section || !content) return;

  if (!weekly.projects || weekly.projects.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';

  const TYPE_BADGES = {
    bugfix:    { emoji: '🔴', color: '#ef4444' },
    feature:   { emoji: '🟣', color: '#f59e0b' },
    change:    { emoji: '✅', color: '#22c55e' },
    discovery: { emoji: '🔵', color: '#3b82f6' },
    decision:  { emoji: '⚖️', color: '#06b6d4' },
    refactor:  { emoji: '🔄', color: '#a855f7' },
  };

  const ui = appConfig.ui || {};

  content.innerHTML =
    `<div class="weekly-date-range">${weekly.weekStart} ~ ${weekly.weekEnd}</div>` +
    weekly.projects.map(p => {
      const typeBadges = Object.entries(p.types)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => {
          const badge = TYPE_BADGES[type] || { emoji: '📌', color: '#94a3b8' };
          return `<span class="weekly-type-badge" style="background:${badge.color}15;color:${badge.color};">${badge.emoji} ${type} ×${count}</span>`;
        })
        .join('');

      return `<div class="weekly-project">
        <div class="weekly-project-header">
          <span>${p.emoji || '📂'}</span>
          <span class="weekly-project-name">${p.name}</span>
          <span class="weekly-project-count">(${p.total})</span>
        </div>
        <div class="weekly-types">${typeBadges}</div>
      </div>`;
    }).join('') +
    `<div class="weekly-stats">${weekly.stats.totalObservations} ${ui.weeklyObservations || 'observations'} · ${weekly.stats.totalSessions} ${ui.weeklySessions || 'sessions'} · ${weekly.stats.totalProjects} ${ui.weeklyProjects || 'projects'}</div>`;
}
```

- [ ] **Step 4: Add weekly fetch to `load()` function**

Update the `Promise.all` in `load()` to include weekly:

```javascript
    const [stats, journey, weekly, profile, relationship, philosophy, voice] = await Promise.all([
      fetch('/api/stats').then(r => r.json()),
      fetch('/api/journey').then(r => r.json()),
      fetch('/api/weekly').then(r => r.json()),
      fetch('/api/profile').then(r => r.json()),
      fetch('/api/relationship').then(r => r.json()),
      fetch('/api/philosophy').then(r => r.json()),
      fetch('/api/claude-voice').then(r => r.json()),
    ]);
```

Add after `renderJourney(journey);`:

```javascript
    renderWeekly(weekly);
    setSectionMeta('weekly-meta', weekly);
```

- [ ] **Step 5: Add weekly to `pollJourney()`**

Update `pollJourney()` to also poll weekly:

```javascript
async function pollJourney() {
  try {
    const [journey, weekly] = await Promise.all([
      fetch('/api/journey').then(r => r.json()),
      fetch('/api/weekly').then(r => r.json()),
    ]);
    renderJourney(journey);
    renderWeekly(weekly);
    setSectionMeta('journey-meta', journey);
    setSectionMeta('weekly-meta', weekly);
  } catch (err) {
    console.warn('Journey poll failed:', err);
  }
}
```

- [ ] **Step 6: Set weekly section title from i18n**

Add in `loadConfig()` after the existing `applyI18nSectionTitle` calls:

```javascript
    const weeklyTitleEl = document.getElementById('weekly-title');
    if (weeklyTitleEl) weeklyTitleEl.textContent = ui.weeklyTitle || 'This Week';
```

---

### Task 6: Cleanup obsolete files

**Files:**
- Delete: `docs/superpowers/specs/2026-04-16-todo-history-redesign-design.md`
- Delete: `docs/superpowers/plans/2026-04-16-todo-history-redesign.md`

- [ ] **Step 1: Remove obsolete TODO-era spec and plan**

```bash
git rm docs/superpowers/specs/2026-04-16-todo-history-redesign-design.md
git rm docs/superpowers/plans/2026-04-16-todo-history-redesign.md
```

- [ ] **Step 2: Commit all changes**

After all tasks are done, commit the full implementation:

```bash
git add src/db.js server.js src/claude-gen.js public/index.html i18n/en.json i18n/ko.json
git commit -m "feat: add Weekly activity section and improve History data quality"
```

- [ ] **Step 3: Verify end-to-end**

Run: `npm run dev` and open `http://localhost:3000`
Verify:
- Weekly section appears above History with project/type breakdown
- History shows sessions with proper titles (custom_title preferred)
- No blank/missing sessions in History
- excludedProjectNames filter works on both sections
- Stats and other AI-generated sections still render correctly

---

### Task 7: Cleanup obsolete files commit

- [ ] **Step 1: Commit cleanup separately**

```bash
git commit -m "chore: remove obsolete TODO-era spec and plan"
```
