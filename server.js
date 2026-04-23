import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./src/config.js";
import { t } from "./src/i18n.js";
import { getStats, getJourneyHistory } from "./src/db.js";
import {
  getProfile, getRelationship, getPhilosophy, getVoice,
  getAvatarDecor, getAccentColor, getWeeklySummary,
  getProjectEmojis, scheduleCacheInvalidation,
} from "./src/claude-gen.js";
import { patchClaudeMemHooks, syncExcludedProjects } from "./src/hooks-patcher.js";
import { registerLogPrunerJobs } from "./src/log-pruner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = config.port;

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
  const history = getJourneyHistory();

  const allProjects = [...new Set(history.map((h) => h.project))];
  const emojis = await getProjectEmojis(allProjects);

  const historyWithEmoji = history.map((h) => ({
    ...h,
    projectEmoji: emojis[h.project] || "",
  }));

  const weeklySummary = await getWeeklySummary(historyWithEmoji);
  res.json({ history: historyWithEmoji, weeklySummary });
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

app.listen(PORT, () => {
  console.log(`\n  claude-with-me is running at http://localhost:${PORT}`);

  scheduleCacheInvalidation();
  registerLogPrunerJobs();

  const hookResult = patchClaudeMemHooks(config.claudeMem);
  console.log(`  [hooks] ${hookResult.patched ? hookResult.message : "No patch needed: " + hookResult.message}`);

  const excludeResult = syncExcludedProjects(config.claudeMem);
  console.log(`  [exclude] ${excludeResult.synced ? excludeResult.message : excludeResult.message}`);
});
