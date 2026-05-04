import { readdirSync, statSync, truncateSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import cron from "node-cron";
import { config } from "./config.js";

const CLAUDE_MEM_LOGS_DIR = join(homedir(), ".claude-mem", "logs");
const LOG_PATTERN = /^claude-mem-(\d{4}-\d{2}-\d{2})\.log$/;

const PROJECT_LOGS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "logs");
const PROJECT_LOG_PATTERN = /\.log$/;
// 1st of every month at 5am — aligns with daily REFRESH_HOUR (claude-gen.js).
const MONTHLY_CRON = "0 5 1 * *";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function pruneOldLogs({ dir, maxAgeDays, pattern = LOG_PATTERN }) {
  const days = Number(maxAgeDays);
  if (!Number.isFinite(days) || days <= 0) {
    return { deleted: [], bytesFreed: 0, skipped: [] };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);

  const result = { deleted: [], bytesFreed: 0, skipped: [] };

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return { ...result, skipped: [`dir_error: ${err.code}`] };
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isFile()) continue;
    const match = entry.name.match(pattern);
    if (!match) continue;

    const fileDate = new Date(match[1] + "T00:00:00");
    if (fileDate >= cutoff) continue;

    const filePath = join(dir, entry.name);
    try {
      const size = statSync(filePath).size;
      unlinkSync(filePath);
      result.deleted.push(entry.name);
      result.bytesFreed += size;
    } catch (err) {
      result.skipped.push(`${entry.name}: ${err.code}`);
    }
  }

  return result;
}

function runPrune({ prefix = "" } = {}) {
  const result = pruneOldLogs({
    dir: CLAUDE_MEM_LOGS_DIR,
    maxAgeDays: config.claudeMem.logPruner.retentionDays,
  });

  if (result.deleted.length > 0) {
    const mb = (result.bytesFreed / (1024 * 1024)).toFixed(1);
    console.log(`${prefix}[log-pruner] Deleted ${result.deleted.length} old logs (${mb} MB freed)`);
  } else {
    console.log(`${prefix}[log-pruner] No logs to prune`);
  }

  if (result.skipped.length > 0) {
    console.warn(`${prefix}[log-pruner] Skipped: ${result.skipped.join(", ")}`);
  }
}

export function registerLogPrunerJobs() {
  const { enabled, retentionDays } = config.claudeMem.logPruner;

  if (!enabled) {
    console.log(`  [log-pruner] Disabled (opt-in via config)`);
    return;
  }

  const weekDay = config.journey.weekStartDay ?? 1;
  const cronExpr = `0 5 * * ${weekDay}`;

  console.log(`  [log-pruner] Enabled (retention=${retentionDays}d, cron="${cronExpr}")`);
  console.log(`  [log-pruner] Running startup sweep...`);
  runPrune({ prefix: "  " });

  cron.schedule(cronExpr, () => {
    console.log(`[${new Date().toISOString()}] Cron: log-pruner weekly sweep`);
    runPrune();
  });
}

// Project's own logs/ directory (LaunchAgent stdout/stderr append targets).
// LaunchAgent holds the fd open, so truncate-in-place is safer than rename
// — rename would orphan launchd's fd and silently drop new lines.
function truncateProjectLogs({ enforceAge = false } = {}) {
  const result = { truncated: [], bytesFreed: 0, skipped: [] };

  let entries;
  try {
    entries = readdirSync(PROJECT_LOGS_DIR, { withFileTypes: true });
  } catch (err) {
    return { ...result, skipped: [`dir_error: ${err.code}`] };
  }

  const ageCutoffMs = enforceAge ? Date.now() - THIRTY_DAYS_MS : null;

  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isFile()) continue;
    if (!PROJECT_LOG_PATTERN.test(entry.name)) continue;

    const filePath = join(PROJECT_LOGS_DIR, entry.name);
    try {
      const st = statSync(filePath);
      if (ageCutoffMs !== null && st.mtimeMs >= ageCutoffMs) continue;
      const size = st.size;
      if (size === 0) continue;
      truncateSync(filePath, 0);
      result.truncated.push(entry.name);
      result.bytesFreed += size;
    } catch (err) {
      result.skipped.push(`${entry.name}: ${err.code}`);
    }
  }

  return result;
}

function runRotation({ prefix = "", enforceAge = false } = {}) {
  const result = truncateProjectLogs({ enforceAge });

  if (result.truncated.length > 0) {
    const mb = (result.bytesFreed / (1024 * 1024)).toFixed(1);
    console.log(`${prefix}[log-rotation] Truncated ${result.truncated.length} log(s) (${mb} MB freed)`);
  } else {
    console.log(`${prefix}[log-rotation] No logs to truncate`);
  }

  if (result.skipped.length > 0) {
    console.warn(`${prefix}[log-rotation] Skipped: ${result.skipped.join(", ")}`);
  }
}

export function registerProjectLogRotation() {
  if (!config.logs.monthlyTruncate) {
    console.log(`  [log-rotation] Disabled (opt-in via config)`);
    return;
  }

  console.log(`  [log-rotation] Enabled (monthly truncate, cron="${MONTHLY_CRON}")`);
  console.log(`  [log-rotation] Running startup sweep (only files older than 30 days)...`);
  runRotation({ prefix: "  ", enforceAge: true });

  cron.schedule(MONTHLY_CRON, () => {
    console.log(`[${new Date().toISOString()}] Cron: monthly project log truncate`);
    runRotation();
  });
}
