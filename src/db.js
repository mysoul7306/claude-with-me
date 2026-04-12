import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "./config.js";
import { t } from "./i18n.js";

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

function extractKeywords(text) {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^\w가-힣\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2)
    ),
  ];
}

function jaccardSimilarity(a, b) {
  const intersection = a.filter((x) => b.includes(x));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

const COMPLETED_SIMILARITY_THRESHOLD = 0.3;

export function getJourney() {
  if (!db) return { todo: [], history: [] };

  const NOISE_PATTERNS = t.filters.noisePatterns;
  const noiseWhere = NOISE_PATTERNS.map(() => "next_steps NOT LIKE ?").join(" AND ");
  const noiseParams = NOISE_PATTERNS.map((p) => `%${p}%`);

  const todoCandidates = db
    .prepare(
      `SELECT next_steps, project FROM (
        SELECT next_steps, project, MAX(created_at_epoch) as latest
        FROM session_summaries
        WHERE next_steps IS NOT NULL AND LENGTH(next_steps) > 5
          AND (project IS NULL OR project != 'Workspaces')
          AND ${noiseWhere}
        GROUP BY next_steps
        ORDER BY latest DESC
        LIMIT ${config.journey.todoLimit * 2}
      )`
    )
    .all(...noiseParams);

  const completedRows = db
    .prepare(
      `SELECT completed FROM session_summaries
       WHERE completed IS NOT NULL AND completed != ''
       ORDER BY created_at_epoch DESC
       LIMIT 50`
    )
    .all();

  const completedKeywords = completedRows.map((r) => extractKeywords(r.completed));

  const todo = todoCandidates
    .filter((r) => {
      const todoKw = extractKeywords(r.next_steps);
      return !completedKeywords.some(
        (compKw) => jaccardSimilarity(todoKw, compKw) >= COMPLETED_SIMILARITY_THRESHOLD
      );
    })
    .slice(0, config.journey.todoLimit)
    .map((r) => ({ text: r.next_steps, project: r.project || "General" }));

  const history = db
    .prepare(
      `SELECT s.project, s.request, s.investigated, s.completed,
              s.created_at, s.created_at_epoch
      FROM session_summaries s
      INNER JOIN (
        SELECT memory_session_id, MIN(created_at_epoch) as min_epoch
        FROM session_summaries
        GROUP BY memory_session_id
      ) first ON s.memory_session_id = first.memory_session_id
        AND s.created_at_epoch = first.min_epoch
      WHERE (s.project IS NULL OR s.project != 'Workspaces')
        AND s.completed IS NOT NULL AND s.completed != ''
      ORDER BY s.created_at_epoch DESC
      LIMIT ${config.journey.historyLimit}`
    )
    .all()
    .map((r) => ({
      date: r.created_at ? r.created_at.split("T")[0] : "unknown",
      project: r.project || "General",
      title: r.request || r.investigated || "Session",
      description: r.completed || "",
    }));

  return { todo, history };
}
