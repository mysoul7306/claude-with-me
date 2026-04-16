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

export function getStats() {
  if (!db) {
    return { totalSessions: 0, totalObservations: 0, daysTogether: 0, projects: [] };
  }

  const sessions = db
    .prepare("SELECT COUNT(DISTINCT memory_session_id) as count FROM session_summaries")
    .get();
  const observations = db.prepare("SELECT COUNT(*) as count FROM observations").get();
  const firstSession = db
    .prepare("SELECT MIN(created_at_epoch) as first FROM session_summaries")
    .get();
  const projectRows = db
    .prepare("SELECT DISTINCT project FROM session_summaries WHERE project IS NOT NULL")
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

  const excluded = buildExcludedProjectsClause("project");
  const recentActivityCutoff = Date.now() - 10 * 60 * 1000;

  const rows = db
    .prepare(
      `SELECT
         COALESCE(first.project, comp.project) as project,
         first.memory_session_id,
         first.request, first.investigated,
         comp.completed, comp.created_at, comp.created_at_epoch,
         sdk.custom_title
       FROM (
         SELECT memory_session_id, project, request, investigated, created_at_epoch
         FROM (
           SELECT memory_session_id, project, request, investigated, created_at_epoch,
                  ROW_NUMBER() OVER (
                    PARTITION BY memory_session_id
                    ORDER BY created_at_epoch ASC
                  ) as rn
           FROM session_summaries
           WHERE ${excluded.sql}
         )
         WHERE rn = 1
       ) first
       INNER JOIN (
         SELECT memory_session_id, project, completed,
                created_at, created_at_epoch,
                ROW_NUMBER() OVER (
                  PARTITION BY memory_session_id
                  ORDER BY created_at_epoch ASC
                ) as rn
         FROM session_summaries
         WHERE completed IS NOT NULL AND completed != ''
       ) comp ON first.memory_session_id = comp.memory_session_id
         AND comp.rn = 1
       LEFT JOIN sdk_sessions sdk
         ON sdk.memory_session_id = first.memory_session_id
       WHERE first.memory_session_id NOT IN (
         SELECT memory_session_id FROM sdk_sessions
         WHERE status = 'active' AND memory_session_id IS NOT NULL
       )
       AND first.memory_session_id NOT IN (
         SELECT memory_session_id FROM session_summaries
         WHERE created_at_epoch >= ?
         GROUP BY memory_session_id
       )
       ORDER BY comp.created_at_epoch DESC
       LIMIT ${config.journey.historyLimit}`
    )
    .all(...excluded.params, recentActivityCutoff);

  if (rows.length === 0) return [];

  // Fetch observations types for matched sessions
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

  const typesMap = obsRows.reduce((acc, obs) => {
    const existing = acc.get(obs.memory_session_id) ?? [];
    return acc.set(obs.memory_session_id, [...existing, obs.type]);
  }, new Map());

  return rows.map((r) => ({
    date: r.created_at ? r.created_at.split("T")[0] : "unknown",
    project: r.project || "General",
    title: r.custom_title || r.request || r.investigated || "Session",
    description: r.completed || "",
    types: typesMap.get(r.memory_session_id) ?? [],
  }));
}

export function getLatestSummaryEpoch() {
  if (!db) return 0;
  const row = db.prepare("SELECT MAX(created_at_epoch) as latest FROM session_summaries").get();
  return row?.latest || 0;
}
