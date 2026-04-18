# Weekly Summary + Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI-generated weekly summary card above History, add lone surrogate sanitize to CLI output, and rewrite README with updated token estimates.

**Architecture:** Weekly summary uses a separate cache (`weekly-summary`) with SEVEN_DAYS TTL, invalidated by weekly cron. The `/api/journey` endpoint merges journey + weekly-summary at response time, keeping `buildJourney()` untouched. Frontend renders a card above History using `Intl.DateTimeFormat` for locale-aware dates.

**Tech Stack:** Node.js (ESM), Express 5, better-sqlite3, vanilla HTML/JS, node-cron

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/claude-gen.js` | Modify | `sanitizeSurrogates()`, `getWeeklySummary()`, update `scheduleRefreshCycles` |
| `server.js` | Modify | Merge weekly summary into `/api/journey` response |
| `i18n/ko.json` | Modify | Add `weeklySummary` prompt, `weeklyEmpty`, `weeklyTitle` |
| `i18n/en.json` | Modify | Same as above |
| `public/index.html` | Modify | Weekly summary card in `renderJourney()` |
| `README.md` | Rewrite | Full rewrite with updated token table |
| `assets/screenshot.png` | Delete | Old screenshot removed from git |

---

### Task 1: Lone Surrogate Sanitize

**Files:**
- Modify: `src/claude-gen.js:51-58`

- [ ] **Step 1: Add `sanitizeSurrogates` helper function**

Add after line 48 (after `classifyClaudeError`), before `callClaudeWithModel`:

```js
function sanitizeSurrogates(text) {
  return text
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}
```

- [ ] **Step 2: Apply in `callClaudeWithModel`**

Change `callClaudeWithModel` (line 51-59):

```js
async function callClaudeWithModel(prompt, model) {
  const escaped = prompt.replace(/'/g, "'\\''");
  const { stdout } = await execAsync(
    `echo '${escaped}' | ${config.claude.cliPath} --print --model ${model}`,
    { encoding: "utf-8", timeout: 120000 }
  );
  const result = sanitizeSurrogates(stdout.trim());
  return result.length > 10 ? result : null;
}
```

Only change: `stdout.trim()` → `sanitizeSurrogates(stdout.trim())`.

- [ ] **Step 3: Verify server starts**

Run: `node server.js`
Expected: Server starts without errors, existing AI calls still work.

- [ ] **Step 4: Commit**

```bash
git add src/claude-gen.js
git commit -m "fix: add lone surrogate sanitize to CLI output"
```

---

### Task 2: i18n — Weekly Summary Prompts

**Files:**
- Modify: `i18n/ko.json`
- Modify: `i18n/en.json`

- [ ] **Step 1: Add weekly summary entries to `ko.json`**

Add to `prompts` object:

```json
"weeklySummary": "이번 주({{startDate}}~{{endDate}}) 작업을 5~6줄로 요약해줘.\n프로젝트명, 핵심 성과, 전체 흐름을 포함해줘.\n톤: 따뜻한 회고, 함께 일한 동료가 돌아보는 느낌으로.\n메시지만 출력.\n\n작업 기록:"
```

Add to `ui` object:

```json
"weeklyTitle": "This Week",
"weeklyEmpty": "이번 주 여정은 아직 없는 것 같아요. 지금이라도 같이 여정을 즐겨볼까요? ㅎㅎ"
```

Full `ko.json` after edit:

```json
{
  "prompts": {
    "profile": "{{userName}}의 프로필을 JSON으로 작성해줘. 이 사용자의 역할은 \"{{role}}\"이야.\n형식: [{ \"icon\": \"이모지1개\", \"title\": \"짧은 제목\", \"desc\": \"1~2문장\" }, ...] (5개)\ndesc 문체: 명사형/체언 종결 (\"~하는 사람.\", \"~을 추구.\", \"~이 기본 체질.\")\n서술형 종결(\"~한다.\", \"~이다.\") 금지.\n참고 데이터: {{daysTogether}}일, {{totalSessions}}세션\nJSON 배열만 출력.",
    "relationship": "{{userName}}와 Claude의 관계를 JSON으로 정리해줘.\n형식: { \"userToClaude\": \"역할 (중간점 · 구분)\", \"claudeToUser\": \"역할 (같은 형식)\", \"bond\": \"관계 본질 한마디 (통계 넣지 마)\", \"keywords\": [\"맥락 있는 짧은 문구\", ...최대15개] }\nkeywords 규칙: 한두 단어 금지. \"신뢰\" 같은 단어 하나가 아니라 \"매 세션 이어지는 신뢰\"처럼 4~8글자의 문맥이 담긴 표현으로.\nJSON만 출력.",
    "philosophy": "이번 주 {{userName}}와의 협업 철학을 JSON으로 표현해줘.\n형식: { \"quote\": \"인용구 3~4줄. 가장 중요한 한 줄은 <span>태그</span>로 감싸줘.\", \"explanation\": \"부연 설명 2~3줄\" }\n진심 담긴 표현으로. JSON만 출력.",
    "voice": "{{userName}}에게 따뜻하고 솔직한 한마디 해줘.\n3~5줄, 이모지 1~2개.\n참고: {{daysTogether}}일 함께, {{totalSessions}}세션, {{totalObservations}}기록.\n메시지만 출력.",
    "avatarDecor": "{{userName}}은 \"{{role}}\" 역할이야. 이 사용자의 도메인과 업무를 분석해서, 어울리는 장식 이모지를 골라줘.\nJSON 형식: { \"decorEmojis\": [\"🛰️\", \"📡\", \"🌏\", ...] }\n최소 3개, 최대 10개. 이모지 배열만 반환. JSON만 출력.",
    "accentColor": "{{userName}}은 \"{{role}}\" 역할이야. 이 사용자에게 어울리는 테마 색상을 추천해줘.\nJSON 형식: { \"accentColor\": \"#hex코드\", \"reason\": \"추천 이유\" }\nJSON만 출력.",
    "weeklySummary": "이번 주({{startDate}}~{{endDate}}) 작업을 5~6줄로 요약해줘.\n프로젝트명, 핵심 성과, 전체 흐름을 포함해줘.\n톤: 따뜻한 회고, 함께 일한 동료가 돌아보는 느낌으로.\n메시지만 출력.\n\n작업 기록:"
  },
  "ui": {
    "title": "Claude with {{userName}}",
    "loading": "로딩 중...",
    "errorCli": "Claude CLI 연결에 실패했습니다",
    "errorAvatarDecor": "아바타 장식 생성에 실패했습니다",
    "sectionThroughMyEyes": "Through My Eyes",
    "sectionClaudeWithMe": "Claude With Me",
    "sectionOurPhilosophy": "Our Philosophy",
    "sectionOurJourney": "Our Journey",
    "sectionOurMilestones": "Our Milestones",
    "historyTitle": "History",
    "weeklyTitle": "This Week",
    "weeklyEmpty": "이번 주 여정은 아직 없는 것 같아요. 지금이라도 같이 여정을 즐겨볼까요? ㅎㅎ",
    "statDaysTogether": "함께한 날",
    "statTotalSessions": "총 세션",
    "statTotalObservations": "총 기록",
    "statProjects": "진행해온 프로젝트"
  }
}
```

- [ ] **Step 2: Add weekly summary entries to `en.json`**

Add to `prompts` object:

```json
"weeklySummary": "Summarize this week's work ({{startDate}}–{{endDate}}) in 5-6 lines.\nInclude project names, key achievements, and overall flow.\nTone: warm retrospective, like a colleague reflecting on shared work.\nOutput message only.\n\nWork log:"
```

Add to `ui` object:

```json
"weeklyTitle": "This Week",
"weeklyEmpty": "No journeys this week yet. Shall we start one together?"
```

Full `en.json` after edit:

```json
{
  "prompts": {
    "profile": "Write a profile for {{userName}} in JSON. This user's role is \"{{role}}\".\nFormat: [{ \"icon\": \"single emoji\", \"title\": \"short title\", \"desc\": \"1-2 sentences\" }, ...] (5 items)\nStyle: noun/noun-phrase endings. Avoid full sentence endings.\nContext: {{daysTogether}} days, {{totalSessions}} sessions\nOutput JSON array only.",
    "relationship": "Describe the relationship between {{userName}} and Claude in JSON.\nFormat: { \"userToClaude\": \"roles (dot-separated)\", \"claudeToUser\": \"roles (same format)\", \"bond\": \"one-line essence of the relationship (no stats)\", \"keywords\": [\"contextual short phrases\", ...up to 15] }\nKeyword rules: no single words. Use 4-8 character phrases with context like \"trust built session by session\" instead of just \"trust\".\nOutput JSON only.",
    "philosophy": "Express this week's collaboration philosophy with {{userName}} in JSON.\nFormat: { \"quote\": \"3-4 line quote. Wrap the most important line in <span> tags.\", \"explanation\": \"2-3 line explanation\" }\nBe heartfelt and genuine. Output JSON only.",
    "voice": "Say something warm and honest to {{userName}}.\n3-5 lines, 1-2 emojis.\nContext: {{daysTogether}} days together, {{totalSessions}} sessions, {{totalObservations}} records.\nOutput message only.",
    "avatarDecor": "{{userName}} has the role \"{{role}}\". Analyze this user's domain and work, then pick fitting decorative emojis.\nJSON format: { \"decorEmojis\": [\"🛰️\", \"📡\", \"🌏\", ...] }\nMinimum 3, maximum 10. Return emoji array only. Output JSON only.",
    "accentColor": "{{userName}} has the role \"{{role}}\". Recommend a fitting theme color for this user.\nJSON format: { \"accentColor\": \"#hexcode\", \"reason\": \"why this color\" }\nOutput JSON only.",
    "weeklySummary": "Summarize this week's work ({{startDate}}–{{endDate}}) in 5-6 lines.\nInclude project names, key achievements, and overall flow.\nTone: warm retrospective, like a colleague reflecting on shared work.\nOutput message only.\n\nWork log:"
  },
  "ui": {
    "title": "Claude with {{userName}}",
    "loading": "loading...",
    "errorCli": "Failed to connect to Claude CLI",
    "errorAvatarDecor": "Failed to generate avatar decorations",
    "sectionThroughMyEyes": "Through My Eyes",
    "sectionClaudeWithMe": "Claude With Me",
    "sectionOurPhilosophy": "Our Philosophy",
    "sectionOurJourney": "Our Journey",
    "sectionOurMilestones": "Our Milestones",
    "historyTitle": "History",
    "weeklyTitle": "This Week",
    "weeklyEmpty": "No journeys this week yet. Shall we start one together?",
    "statDaysTogether": "Days Together",
    "statTotalSessions": "Total Sessions",
    "statTotalObservations": "Total Observations",
    "statProjects": "Projects Explored"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add i18n/ko.json i18n/en.json
git commit -m "feat: add weekly summary i18n prompts and UI labels"
```

---

### Task 3: Weekly Summary Backend

**Files:**
- Modify: `src/claude-gen.js` (add `getWeeklySummary`, update `scheduleRefreshCycles`, add export)

- [ ] **Step 1: Add week range helper**

Add after `const ONE_DAY` (line 13), before `const CACHE_DIR`:

```js
function getWeekRange() {
  const weekDay = config.journey.weekStartDay ?? 1;
  const today = new Date();
  const diff = (today.getDay() - weekDay + 7) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - diff);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return {
    startDate: weekStart.toISOString().split("T")[0],
    endDate: weekEnd.toISOString().split("T")[0],
  };
}
```

- [ ] **Step 2: Add `getWeeklySummary` function**

Add after `getAccentColor` (after line 243), before `scheduleRefreshCycles`:

```js
// --- Weekly Summary: AI-generated week recap (7-day cache) ---

export async function getWeeklySummary(history) {
  const { startDate, endDate } = getWeekRange();
  const thisWeek = history.filter((h) => h.date >= startDate);

  if (thisWeek.length === 0) {
    return { text: null, startDate, endDate };
  }

  const cached = readCache("weekly-summary", SEVEN_DAYS);
  if (cached?.content) {
    return { ...cached.content, generatedBy: cached.generatedBy, generatedAt: cached.generatedAt };
  }

  const serialized = thisWeek
    .map((h) => `${h.project}: ${h.title} (${h.description})`)
    .join("\n");

  const prompt =
    interpolate(t.prompts.weeklySummary, { startDate, endDate }) +
    "\n" +
    serialized;

  const res = await callClaude(prompt);
  if (res?.content) {
    const payload = { text: res.content, startDate, endDate };
    const written = writeCache("weekly-summary", payload, res.generatedBy);
    return { ...payload, generatedBy: res.generatedBy, generatedAt: written.generatedAt };
  }

  return { text: null, startDate, endDate };
}
```

- [ ] **Step 3: Update `scheduleRefreshCycles` to invalidate weekly-summary**

Change line 261 from:

```js
    invalidateCaches("profile", "relationship", "philosophy", "avatar-decor", "accent-color");
```

To:

```js
    invalidateCaches("profile", "relationship", "philosophy", "avatar-decor", "accent-color", "weekly-summary");
```

- [ ] **Step 4: Verify server starts**

Run: `node server.js`
Expected: Server starts, cron log shows weekly schedule as before.

- [ ] **Step 5: Commit**

```bash
git add src/claude-gen.js
git commit -m "feat: add getWeeklySummary with week range calculation and caching"
```

---

### Task 4: Server Integration

**Files:**
- Modify: `server.js:7-12` (imports), `server.js:36-43` (`/api/journey` endpoint)

- [ ] **Step 1: Add `getWeeklySummary` to imports**

Change line 7-12 from:

```js
import {
  getProfile, getRelationship, getPhilosophy, getVoice,
  getAvatarDecor, getAccentColor,
  getProjectEmojis, scheduleRefreshCycles,
  readCache, writeCache,
} from "./src/claude-gen.js";
```

To:

```js
import {
  getProfile, getRelationship, getPhilosophy, getVoice,
  getAvatarDecor, getAccentColor, getWeeklySummary,
  getProjectEmojis, scheduleRefreshCycles,
  readCache, writeCache,
} from "./src/claude-gen.js";
```

- [ ] **Step 2: Merge weekly summary into `/api/journey` response**

Change lines 36-43 from:

```js
app.get("/api/journey", async (_req, res) => {
  const cached = readCache("journey", JOURNEY_TTL);
  if (cached?.content) {
    return res.json({ ...cached.content, generatedAt: cached.generatedAt });
  }
  const result = await buildJourney();
  res.json(result);
});
```

To:

```js
app.get("/api/journey", async (_req, res) => {
  let journeyData;
  const cached = readCache("journey", JOURNEY_TTL);
  if (cached?.content) {
    journeyData = { ...cached.content, generatedAt: cached.generatedAt };
  } else {
    journeyData = await buildJourney();
  }

  const weeklySummary = await getWeeklySummary(journeyData.history || []);
  res.json({ ...journeyData, weeklySummary });
});
```

- [ ] **Step 3: Verify API response**

Run: `node server.js`
Then: `curl -s http://localhost:3000/api/journey | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log('weeklySummary:', JSON.stringify(j.weeklySummary, null, 2))})"`

Expected: `weeklySummary` field present in response with `text`, `startDate`, `endDate`.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: merge weekly summary into /api/journey response"
```

---

### Task 5: Frontend Weekly Summary Card

**Files:**
- Modify: `public/index.html:1021-1067` (`renderJourney` function)

- [ ] **Step 1: Add weekly summary card rendering**

Replace the entire `renderJourney` function (lines 1021-1068) with:

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

  const timelineEl = document.getElementById('journey-timeline');
  let html = '';

  // Weekly Summary card
  const ws = journey.weeklySummary;
  if (ws) {
    const dateFmt = new Intl.DateTimeFormat(navigator.language, { month: 'short', day: 'numeric' });
    const rangeStart = dateFmt.format(new Date(ws.startDate + 'T00:00:00'));
    const rangeEnd = dateFmt.format(new Date(ws.endDate + 'T00:00:00'));
    const weeklyTitle = appConfig.ui?.weeklyTitle || 'This Week';

    if (ws.text) {
      const modelBadge = ws.generatedBy
        ? `<span style="display:inline-block;padding:2px 8px;background:color-mix(in srgb, var(--accent-user) 10%, transparent);color:var(--accent-user);border-radius:10px;font-size:0.65rem;">✨ ${ws.generatedBy}</span>`
        : '';
      html += `<div style="margin-bottom:28px;padding:20px;background:color-mix(in srgb, var(--accent-user) 5%, var(--card-bg));border:1px solid color-mix(in srgb, var(--accent-user) 20%, transparent);border-radius:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <h3 style="color:var(--accent-user);font-size:1.1rem;margin:0;">📅 ${weeklyTitle} (${rangeStart} – ${rangeEnd})</h3>
          ${modelBadge}
        </div>
        <div style="color:#cbd5e1;font-size:0.9rem;line-height:1.7;white-space:pre-line;">${ws.text}</div>
      </div>`;
    } else {
      html += `<div style="margin-bottom:28px;padding:20px;background:color-mix(in srgb, var(--accent-user) 3%, var(--card-bg));border:1px dashed color-mix(in srgb, var(--accent-user) 15%, transparent);border-radius:12px;text-align:center;">
        <h3 style="color:var(--accent-user);font-size:1.1rem;margin:0 0 8px 0;">📅 ${weeklyTitle} (${rangeStart} – ${rangeEnd})</h3>
        <div style="color:#64748b;font-size:0.85rem;">${appConfig.ui?.weeklyEmpty || 'No journeys this week yet.'}</div>
      </div>`;
    }
  }

  // History - grouped by date
  if (journey.history && journey.history.length > 0) {
    const grouped = {};
    for (const t of journey.history) {
      if (!grouped[t.date]) grouped[t.date] = [];
      grouped[t.date].push(t);
    }
    html +=
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
  }

  timelineEl.innerHTML = html;
}
```

Key changes from original:
- Weekly summary card rendered before History
- `Intl.DateTimeFormat` with `navigator.language` for locale-aware dates
- Empty state shows i18n `weeklyEmpty` message with dashed border
- Model badge follows existing `✨ model` pattern
- History section unchanged

- [ ] **Step 2: Verify in browser**

Open `http://localhost:3000`, check:
1. Weekly summary card appears above History
2. Date range shows in browser locale format
3. Model badge displays correctly
4. If no sessions this week, empty message appears

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add weekly summary card above History in dashboard"
```

---

### Task 6: Screenshot Cleanup

**Files:**
- Delete: `assets/screenshot.png`

- [ ] **Step 1: Delete old screenshot from git**

```bash
git rm assets/screenshot.png
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: remove outdated screenshot"
```

- [ ] **Step 3: Take new screenshot (manual)**

After all features are implemented and verified:
1. Start server with dummy/test data
2. Set browser clock or wait for `00:00:00` display
3. Take screenshot of full dashboard
4. Save as `assets/screenshot.png`
5. Commit: `git add assets/screenshot.png && git commit -m "docs: add updated dashboard screenshot"`

> **Note:** This step requires manual action — the screenshot must be taken by the developer after visual verification.

---

### Task 7: README Rewrite

**Files:**
- Rewrite: `README.md`

- [ ] **Step 1: Rewrite README.md**

The full README content — update token table to include weekly-summary, reflect current architecture with Weekly Summary feature, keep existing sections (Platform Support, Configuration, Auto-start, Troubleshooting), add Weekly Summary to "How It Works":

Key changes from current README:
- **Token table:** Add `Weekly summary | Weekly | ~15K` row, update total to ~95K
- **How It Works:** Add Weekly Summary to the flow description
- **Configuration:** `weekStartDay` description now mentions weekly summary refresh
- **Screenshot:** Reference `assets/screenshot.png` (will be replaced in Task 6)

Token estimation breakdown for weekly-summary:
- Input: prompt template (~100 tokens) + serialized history (~20 items × ~30 tokens = ~600 tokens) = ~700 input
- Output: 5-6 lines × ~20 tokens = ~120 output
- Per call: ~820 tokens
- Weekly frequency: ~820 × 4.3 weeks/month ≈ ~3.5K tokens/month
- Conservative estimate rounded up: ~5K (accounting for longer histories)

Updated token table:

```markdown
| Item | Frequency | Tokens (est.) |
|---|---|---|
| Voice message | Daily | ~45K |
| Profile / Relationship / Philosophy | Weekly | ~28K |
| Weekly summary | Weekly | ~5K |
| Avatar decor / Accent color | Weekly | ~5K |
| Project emojis (Sonnet, on new project) | Rare | <1K |
| **Total** | | **~85K** |
```

Write the full README preserving the existing structure (header, Quick Start, Platform Support, Configuration, Auto-start, How It Works, Estimated Cost, Troubleshooting, Acknowledgements, License) with the weekly summary additions integrated naturally.

- [ ] **Step 2: Verify README renders correctly**

```bash
# Check for broken links or formatting
head -20 README.md
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README with weekly summary and updated token estimates"
```
