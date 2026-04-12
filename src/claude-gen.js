import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { t, interpolate } from "./i18n.js";

const execAsync = promisify(exec);

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'cache');

function cachePath(type) {
  return join(CACHE_DIR, `${type}.json`);
}

function readCache(type, ttlMs) {
  try {
    const path = cachePath(type);
    const age = Date.now() - statSync(path).mtimeMs;
    if (age < ttlMs) {
      return { ...JSON.parse(readFileSync(path, "utf-8")), cached: true };
    }
  } catch { /* miss */ }
  return null;
}

function writeCache(type, content) {
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

function parseJson(raw) {
  try {
    return JSON.parse(raw.replace(/```json\n?/g, "").replace(/```/g, "").trim());
  } catch { return null; }
}

export function clearAllCaches() {
  for (const type of ["profile", "relationship", "philosophy", "voice", "avatar-decor", "accent-color"]) {
    try { unlinkSync(cachePath(type)); } catch { /* miss */ }
  }
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
