import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "./config.js";

const DB_PATH = join(homedir(), ".claude-mem", "claude-mem.db");

let db;
try {
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  db.pragma("journal_mode = wal");
} catch (err) {
  console.warn(`[db] claude-mem.db not found at ${DB_PATH}:`, err.message);
  db = null;
}

// claude-mem v12.x introduced sdk_sessions.platform_source ('claude' | 'codex' | ...).
// claude-with-me visualizes the journey *with Claude* — restrict every aggregate to
// platform_source='claude' so codex/other-host sessions don't inflate stats or journey.
const CLAUDE_PLATFORM_FILTER =
  "EXISTS (SELECT 1 FROM sdk_sessions s WHERE s.memory_session_id = $TABLE.memory_session_id AND s.platform_source = 'claude')";

const claudeOnly = (alias) => CLAUDE_PLATFORM_FILTER.replaceAll("$TABLE", alias);

export function getStats() {
  if (!db) {
    return { totalSessions: 0, totalObservations: 0, daysTogether: 0, projects: [] };
  }

  const sessions = db
    .prepare(
      `SELECT COUNT(DISTINCT memory_session_id) as count
       FROM session_summaries ss
       WHERE ${claudeOnly("ss")}`
    )
    .get();
  const observations = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM observations o
       WHERE ${claudeOnly("o")}`
    )
    .get();
  const firstSession = db
    .prepare(
      `SELECT MIN(created_at_epoch) as first
       FROM session_summaries ss
       WHERE ${claudeOnly("ss")}`
    )
    .get();
  const projectRows = db
    .prepare(
      `SELECT DISTINCT project
       FROM session_summaries ss
       WHERE project IS NOT NULL AND ${claudeOnly("ss")}`
    )
    .all();

  const daysTogether = firstSession?.first
    ? Math.ceil((Date.now() - firstSession.first) / (1000 * 60 * 60 * 24))
    : 0;

  return {
    totalSessions: sessions?.count || 0,
    totalObservations: observations?.count || 0,
    daysTogether,
    projects: projectRows.map((r) => r.project),
  };
}

// Build a SQL fragment for excluding noise project names from queries.
// Uses placeholders so we can safely bind the config-driven list.
function buildExcludedProjectsClause(columnExpr) {
  const names = config.journey.excludedProjectNames ?? [];
  if (names.length === 0) return { sql: "1=1", params: [] };
  const placeholders = names.map(() => "?").join(",");
  return {
    sql: `(${columnExpr} IS NULL OR ${columnExpr} NOT IN (${placeholders}))`,
    params: names,
  };
}

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
         AND sdk.platform_source = 'claude'
         AND sdk.status != 'active'
         AND sdk.started_at_epoch < ?
         AND latest_ss.completed IS NOT NULL
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

