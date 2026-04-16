import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { t, interpolate } from "./i18n.js";
import cron from "node-cron";

const execAsync = promisify(exec);

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'cache');

function cachePath(type) {
  return join(CACHE_DIR, `${type}.json`);
}

export function readCache(type, ttlMs) {
  try {
    const path = cachePath(type);
    const age = Date.now() - statSync(path).mtimeMs;
    if (age < ttlMs) {
      return { ...JSON.parse(readFileSync(path, "utf-8")), cached: true };
    }
  } catch { /* miss */ }
  return null;
}

export function writeCache(type, content) {
  const data = { content, generatedAt: new Date().toISOString() };
  try { writeFileSync(cachePath(type), JSON.stringify(data), "utf-8"); } catch { /* ok */ }
  return data;
}

async function callClaude(prompt) {
  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const { stdout } = await execAsync(
      `echo '${escaped}' | ${config.claude.cliPath} --print --model ${config.claude.model}`,
      { encoding: "utf-8", timeout: 120000 }
    );
    const result = stdout.trim();
    if (result.length > 10) return result;
  } catch (err) {
    console.warn("[claude-gen] CLI call failed:", err.message);
  }
  return null;
}

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

function parseJson(raw) {
  try {
    return JSON.parse(raw.replace(/```json\n?/g, "").replace(/```/g, "").trim());
  } catch { return null; }
}

export function invalidateCaches(...types) {
  for (const type of types) {
    try { unlinkSync(cachePath(type)); } catch { /* miss */ }
  }
}

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

// --- Profile: "Through My Eyes" (7-day cache) ---

export async function getProfile(stats) {
  const cached = readCache("profile", SEVEN_DAYS);
  if (cached) return cached;

  const prompt = interpolate(t.prompts.profile, {
    userName: config.userName,
    role: config.role,
    daysTogether: stats.daysTogether,
    totalSessions: stats.totalSessions,
  });

  const result = await callClaude(prompt);
  if (result) {
    const parsed = parseJson(result);
    if (parsed) return { ...writeCache("profile", parsed), cached: false };
  }

  return { error: true, message: t.ui.errorCli };
}

// --- Relationship: "Claude With Me" (7-day cache) ---

export async function getRelationship(stats) {
  const cached = readCache("relationship", SEVEN_DAYS);
  if (cached) return cached;

  const prompt = interpolate(t.prompts.relationship, {
    userName: config.userName,
  });

  const result = await callClaude(prompt);
  if (result) {
    const parsed = parseJson(result);
    if (parsed) return { ...writeCache("relationship", parsed), cached: false };
  }

  return { error: true, message: t.ui.errorCli };
}

// --- Philosophy: "Our Philosophy" (7-day cache) ---

export async function getPhilosophy(stats) {
  const cached = readCache("philosophy", SEVEN_DAYS);
  if (cached) return cached;

  const prompt = interpolate(t.prompts.philosophy, {
    userName: config.userName,
  });

  const result = await callClaude(prompt);
  if (result) {
    const parsed = parseJson(result);
    if (parsed) return { ...writeCache("philosophy", parsed), cached: false };
  }

  return { error: true, message: t.ui.errorCli };
}

// --- Voice: Footer message (1-day cache) ---

export async function getVoice(stats) {
  const cached = readCache("voice", ONE_DAY);
  if (cached) return cached;

  const prompt = interpolate(t.prompts.voice, {
    userName: config.userName,
    daysTogether: stats.daysTogether,
    totalSessions: stats.totalSessions,
    totalObservations: stats.totalObservations,
  });

  const result = await callClaude(prompt);
  if (result) {
    return { ...writeCache("voice", result), cached: false };
  }

  return { error: true, message: t.ui.errorCli };
}

// --- Avatar Decor: decorative emojis (7-day cache) ---

export async function getAvatarDecor() {
  const cached = readCache("avatar-decor", SEVEN_DAYS);
  if (cached) return cached;

  const prompt = interpolate(t.prompts.avatarDecor, {
    userName: config.userName,
    role: config.role,
  });

  const result = await callClaude(prompt);
  if (result) {
    const parsed = parseJson(result);
    if (parsed) return { ...writeCache("avatar-decor", parsed), cached: false };
  }
  return { error: true, message: t.ui.errorAvatarDecor };
}

// --- Accent Color: theme color (config priority, else 7-day cache) ---

export async function getAccentColor() {
  if (config.accentColor) return { accentColor: config.accentColor };

  const cached = readCache("accent-color", SEVEN_DAYS);
  if (cached) return cached;

  const prompt = interpolate(t.prompts.accentColor, {
    userName: config.userName,
    role: config.role,
  });

  const result = await callClaude(prompt);
  if (result) {
    const parsed = parseJson(result);
    if (parsed) return { ...writeCache("accent-color", parsed), cached: false };
  }
  return { accentColor: "#419BFF" };
}

export function scheduleRefreshCycles(refreshJourney) {
  const intervalMin = config.journey.refreshIntervalMin ?? 60;
  const weekDay = config.journey.weekStartDay ?? 1;

  cron.schedule(`*/${intervalMin} * * * *`, () => {
    console.log(`[${new Date().toISOString()}] Cron: journey refresh`);
    refreshJourney();
  });

  cron.schedule("0 0 * * *", () => {
    console.log(`[${new Date().toISOString()}] Cron: daily voice refresh`);
    invalidateCaches("voice");
  });

  cron.schedule(`0 0 * * ${weekDay}`, () => {
    console.log(`[${new Date().toISOString()}] Cron: weekly refresh`);
    invalidateCaches("profile", "relationship", "philosophy", "avatar-decor", "accent-color");
  });

  console.log(`  Cron: journey every ${intervalMin}m, voice daily, weekly on day ${weekDay}`);
}
