import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./src/config.js";
import { t, interpolate } from "./src/i18n.js";
import { getStats, getJourney } from "./src/db.js";
import { getProfile, getRelationship, getPhilosophy, getVoice, getAvatarDecor, getAccentColor, clearAllCaches } from "./src/claude-gen.js";
import { patchClaudeMemHooks, syncExcludedProjects } from "./src/hooks-patcher.js";

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
app.get("/api/journey", (_req, res) => res.json(getJourney()));
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

function scheduleMidnightRefresh() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  const msUntilMidnight = midnight - now;

  setTimeout(() => {
    clearAllCaches();
    console.log(`[${new Date().toISOString()}] Midnight cache refresh done`);
    scheduleMidnightRefresh();
  }, msUntilMidnight);

  console.log(`  Next cache refresh in ${Math.round(msUntilMidnight / 60000)}m`);
}

app.listen(PORT, () => {
  console.log(`\n  claude-with-me is running at http://localhost:${PORT}`);
  scheduleMidnightRefresh();

  const hookResult = patchClaudeMemHooks(config.claudeMem);
  console.log(`  [hooks] ${hookResult.patched ? hookResult.message : "No patch needed: " + hookResult.message}`);

  const excludeResult = syncExcludedProjects(config.claudeMem);
  console.log(`  [exclude] ${excludeResult.synced ? excludeResult.message : excludeResult.message}`);
});
