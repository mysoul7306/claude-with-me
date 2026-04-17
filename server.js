import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./src/config.js";
import { t, interpolate } from "./src/i18n.js";
import { getStats, getJourneyHistory, getLatestSummaryEpoch, getWeeklyActivity } from "./src/db.js";
import {
  getProfile, getRelationship, getPhilosophy, getVoice,
  getAvatarDecor, getAccentColor,
  getProjectEmojis, scheduleRefreshCycles,
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
  if (cached?.content) {
    return res.json({ ...cached.content, generatedAt: cached.generatedAt });
  }
  const result = await buildJourney();
  res.json(result);
});

const WEEKLY_TTL = JOURNEY_TTL;

app.get("/api/weekly", async (_req, res) => {
  const cached = readCache("weekly", WEEKLY_TTL);
  if (cached?.content) {
    return res.json({ ...cached.content, generatedAt: cached.generatedAt });
  }
  const result = await buildWeekly();
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
  const history = getJourneyHistory();

  const allProjects = [...new Set(history.map((h) => h.project))];
  const emojis = await getProjectEmojis(allProjects);

  const historyWithEmoji = history.map((h) => ({
    ...h,
    projectEmoji: emojis[h.project] || "",
  }));

  const payload = { history: historyWithEmoji };
  const written = writeCache("journey", payload);
  return { ...payload, generatedAt: written.generatedAt };
}

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

  scheduleRefreshCycles(refreshJourney, refreshWeekly);
  refreshJourney();
  refreshWeekly();

  const hookResult = patchClaudeMemHooks(config.claudeMem);
  console.log(`  [hooks] ${hookResult.patched ? hookResult.message : "No patch needed: " + hookResult.message}`);

  const excludeResult = syncExcludedProjects(config.claudeMem);
  console.log(`  [exclude] ${excludeResult.synced ? excludeResult.message : excludeResult.message}`);
});
