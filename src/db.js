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
         AND sdk.status != 'active'
         AND sdk.started_at_epoch < ?
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

export function getLatestSummaryEpoch() {
  if (!db) return 0;
  const row = db.prepare("SELECT MAX(created_at_epoch) as latest FROM session_summaries").get();
  return row?.latest || 0;
}

export function getWeeklyActivity() {
  if (!db) return { projects: [], stats: { totalObservations: 0, totalSessions: 0, totalProjects: 0 } };

  const weekStartDay = config.journey.weekStartDay ?? 1; // 0=Sun, 1=Mon
  const now = new Date();
  const currentDay = now.getDay();
  const diffToStart = (currentDay - weekStartDay + 7) % 7;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - diffToStart);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const weekStartEpoch = weekStart.getTime();
  const weekEndEpoch = weekEnd.getTime();

  const excluded = buildExcludedProjectsClause("project");

  const rows = db
    .prepare(
      `SELECT project, type, COUNT(*) as count
       FROM observations
       WHERE created_at_epoch >= ? AND created_at_epoch < ?
         AND type IS NOT NULL
         AND ${excluded.sql}
       GROUP BY project, type
       ORDER BY project, count DESC`
    )
    .all(weekStartEpoch, weekEndEpoch, ...excluded.params);

  const sessionCount = db
    .prepare(
      `SELECT COUNT(DISTINCT memory_session_id) as count
       FROM observations
       WHERE created_at_epoch >= ? AND created_at_epoch < ?
         AND ${excluded.sql}`
    )
    .get(weekStartEpoch, weekEndEpoch, ...excluded.params);

  // Group by project
  const projectMap = new Map();
  for (const row of rows) {
    const existing = projectMap.get(row.project) ?? { name: row.project, total: 0, types: {} };
    const updatedTypes = { ...existing.types, [row.type]: row.count };
    projectMap.set(row.project, { ...existing, types: updatedTypes, total: existing.total + row.count });
  }

  // Sort projects by total descending
  const projects = [...projectMap.values()].sort((a, b) => b.total - a.total);

  const totalObservations = projects.reduce((sum, p) => sum + p.total, 0);

  return {
    weekStart: weekStart.toISOString().split("T")[0],
    weekEnd: new Date(weekEnd.getTime() - 1).toISOString().split("T")[0],
    projects,
    stats: {
      totalObservations,
      totalSessions: sessionCount?.count || 0,
      totalProjects: projects.length,
    },
  };
}
