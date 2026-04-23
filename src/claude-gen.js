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

export function writeCache(type, content, generatedBy = null) {
  const data = { content, generatedBy, generatedAt: new Date().toISOString() };
  try { writeFileSync(cachePath(type), JSON.stringify(data), "utf-8"); } catch { /* ok */ }
  return data;
}

// Errors that legitimately warrant fallback to the next model in priority.
// Quality heuristics (short response, malformed JSON) do NOT trigger fallback —
// returning null lets the caller decide.
const FALLBACK_TRIGGERS = new Set(["rate_limit", "timeout", "unavailable"]);

function classifyClaudeError(err) {
  const msg = (err?.message ?? "").toLowerCase();
  if (msg.includes("rate") || msg.includes("429")) return "rate_limit";
  if (msg.includes("timeout") || msg.includes("etimedout")) return "timeout";
  if (msg.includes("unavailable") || msg.includes("503") || msg.includes("overloaded")) return "unavailable";
  return "other";
}

function sanitizeSurrogates(text) {
  return text
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

async function callClaudeWithModel(prompt, model) {
  const escaped = prompt.replace(/'/g, "'\\''");
  const { stdout } = await execAsync(
    `echo '${escaped}' | ${config.claude.cliPath} --print --model ${model}`,
    { encoding: "utf-8", timeout: 120000 }
  );
  const result = sanitizeSurrogates(stdout.trim());
  return result.length > 10 ? result : null;
}

// Returns { content, generatedBy } on success, null on failure.
// `opts.model` forces a single model (no fallback).
async function callClaude(prompt, opts = {}) {
  const models = opts.model
    ? [opts.model]
    : (config.claude.modelPriority ?? ["opus"]);

  for (const model of models) {
    try {
      const content = await callClaudeWithModel(prompt, model);
      if (content) return { content, generatedBy: model };
      // Empty/short response: don't fallback (Codex: no quality heuristic fallback)
      return null;
    } catch (err) {
      const reason = classifyClaudeError(err);
      console.warn(`[claude-gen] ${model} failed (${reason}): ${err.message}`);
      if (!FALLBACK_TRIGGERS.has(reason)) return null;
      // Otherwise: try next model in priority
    }
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

const PROJECT_EMOJI_PROMPT = `Given these software project names, assign one emoji that represents each project's likely domain. Output JSON: {"projectName": "emoji", ...}. Only output the JSON object.`;

export async function getProjectEmojis(projectNames) {
  const cached = readCache("project-emojis", Infinity);
  const existing = cached?.content || {};

  const missing = projectNames.filter(
    (n) => n && n !== "General" && !existing[n]
  );
  if (missing.length === 0) return existing;

  // Project emojis: Sonnet only — trivial classification, no need for Opus.
  const res = await callClaude(
    `${PROJECT_EMOJI_PROMPT}\n\nProjects: ${missing.join(", ")}`,
    { model: "sonnet" }
  );
  if (res?.content) {
    const parsed = parseJson(res.content);
    if (parsed && typeof parsed === "object") {
      const merged = { ...existing, ...parsed };
      writeCache("project-emojis", merged, res.generatedBy);
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

  const res = await callClaude(prompt);
  if (res?.content) {
    const parsed = parseJson(res.content);
    if (parsed) return { ...writeCache("profile", parsed, res.generatedBy), cached: false };
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

  const res = await callClaude(prompt);
  if (res?.content) {
    const parsed = parseJson(res.content);
    if (parsed) return { ...writeCache("relationship", parsed, res.generatedBy), cached: false };
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

  const res = await callClaude(prompt);
  if (res?.content) {
    const parsed = parseJson(res.content);
    if (parsed) return { ...writeCache("philosophy", parsed, res.generatedBy), cached: false };
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

  const res = await callClaude(prompt);
  if (res?.content) {
    return { ...writeCache("voice", res.content, res.generatedBy), cached: false };
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

  const res = await callClaude(prompt);
  if (res?.content) {
    const parsed = parseJson(res.content);
    if (parsed) return { ...writeCache("avatar-decor", parsed, res.generatedBy), cached: false };
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

  const res = await callClaude(prompt);
  if (res?.content) {
    const parsed = parseJson(res.content);
    if (parsed) return { ...writeCache("accent-color", parsed, res.generatedBy), cached: false };
  }
  return { accentColor: "#419BFF" };
}

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

export function scheduleCacheInvalidation() {
  const weekDay = config.journey.weekStartDay ?? 1;

  cron.schedule("0 0 * * *", () => {
    console.log(`[${new Date().toISOString()}] Cron: daily voice refresh`);
    invalidateCaches("voice");
  });

  cron.schedule(`0 0 * * ${weekDay}`, () => {
    console.log(`[${new Date().toISOString()}] Cron: weekly refresh`);
    invalidateCaches("profile", "relationship", "philosophy", "avatar-decor", "accent-color", "weekly-summary");
  });

  console.log(`  Cron: voice daily, weekly on day ${weekDay}`);
}
