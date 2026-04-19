import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import cron from "node-cron";
import { config } from "./config.js";

const CLAUDE_MEM_LOGS_DIR = join(homedir(), ".claude-mem", "logs");
const LOG_PATTERN = /^claude-mem-(\d{4}-\d{2}-\d{2})\.log$/;

export function pruneOldLogs({ dir, maxAgeDays, pattern = LOG_PATTERN }) {
  if (!maxAgeDays || maxAgeDays <= 0) {
    return { deleted: [], bytesFreed: 0, skipped: [] };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
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

function runPrune() {
  const result = pruneOldLogs({
    dir: CLAUDE_MEM_LOGS_DIR,
    maxAgeDays: config.claudeMem.logPruner.retentionDays,
  });

  if (result.deleted.length > 0) {
    const mb = (result.bytesFreed / (1024 * 1024)).toFixed(1);
    console.log(`[log-pruner] Deleted ${result.deleted.length} old logs (${mb} MB freed)`);
  } else {
    console.log(`[log-pruner] No logs to prune`);
  }

  if (result.skipped.length > 0) {
    console.warn(`[log-pruner] Skipped: ${result.skipped.join(", ")}`);
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

  runPrune();

  cron.schedule(cronExpr, () => {
    console.log(`[${new Date().toISOString()}] Cron: log-pruner weekly sweep`);
    runPrune();
  });

  console.log(`  [log-pruner] Enabled (retention=${retentionDays}d, cron="${cronExpr}")`);
}
