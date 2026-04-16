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

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must",
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
  "this", "that", "these", "those", "it", "its",
  "all", "each", "every", "any", "some", "no", "other",
  "if", "then", "else", "when", "where", "how", "what", "which", "who",
  "up", "out", "about", "just", "also", "very", "only", "still",
  "user", "needs", "needed", "based", "using", "via", "etc",
]);

const ISSUE_WORDS = new Set([
  "failure", "missing", "error", "bug", "broken", "issue", "problem",
  "failed", "crash", "exception", "incorrect", "wrong",
]);

function splitCompoundToken(token) {
  return token
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-:/\\. ]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function classifyToken(token) {
  if (/[:/\\._\-]/.test(token) || /[A-Z].*[a-z].*[A-Z]/.test(token)) return "entity";
  if (/^\d+$/.test(token)) return "other";
  const lower = token.toLowerCase();
  if (STOP_WORDS.has(lower)) return "stop";
  if (ISSUE_WORDS.has(lower)) return "issue";
  if (token.length > 12) return "entity";
  return "action";
}

function extractWeightedTokens(text) {
  const rawTokens = text.match(/[\w:/\\.\-]+/g) || [];
  const tokenMap = new Map();

  for (const raw of rawTokens) {
    const type = classifyToken(raw);
    if (type === "stop" || type === "other") continue;

    const weight = type === "entity" ? 5 : type === "issue" ? 0.5 : 2;

    tokenMap.set(raw.toLowerCase(), { weight, type });

    const parts = splitCompoundToken(raw);
    for (const part of parts) {
      if (STOP_WORDS.has(part)) continue;
      const partWeight = type === "entity" ? 3 : 1;
      const existing = tokenMap.get(part);
      if (!existing || existing.weight < partWeight) {
        tokenMap.set(part, { weight: partWeight, type });
      }
    }
  }

  return tokenMap;
}

function charTrigrams(text) {
  const s = text.toLowerCase().replace(/\s+/g, " ");
  const trigrams = new Set();
  for (let i = 0; i <= s.length - 3; i++) {
    trigrams.add(s.slice(i, i + 3));
  }
  return trigrams;
}

function trigramDice(a, b) {
  const triA = charTrigrams(a);
  const triB = charTrigrams(b);
  if (triA.size === 0 && triB.size === 0) return 0;
  let intersection = 0;
  for (const t of triA) {
    if (triB.has(t)) intersection++;
  }
  return (2 * intersection) / (triA.size + triB.size);
}

function weightedContainment(nextSteps, completed) {
  const tokensA = extractWeightedTokens(nextSteps);
  const tokensB = extractWeightedTokens(completed);
  const bKeys = new Set(tokensB.keys());

  let actionCovered = 0, actionTotal = 0;
  let entityCovered = 0, entityTotal = 0;

  for (const [token, { weight, type }] of tokensA) {
    if (type === "entity") {
      entityTotal += weight;
      if (bKeys.has(token)) entityCovered += weight;
    } else {
      actionTotal += weight;
      if (bKeys.has(token)) actionCovered += weight;
    }
  }

  const actionScore = actionTotal > 0 ? actionCovered / actionTotal : 0;
  const entityScore = entityTotal > 0 ? entityCovered / entityTotal : 0;
  const trigramScore = trigramDice(nextSteps, completed);

  return 0.5 * actionScore + 0.3 * entityScore + 0.2 * trigramScore;
}

const COMPLETED_SIMILARITY_THRESHOLD = 0.25;

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

export function getJourney() {
  if (!db) return { todo: [], history: [] };

  const NOISE_PATTERNS = t.filters.noisePatterns;
  const noiseWhere = NOISE_PATTERNS.map(() => "next_steps NOT LIKE ?").join(" AND ");
  const noiseParams = NOISE_PATTERNS.map((p) => `%${p}%`);

  const excludedInner = buildExcludedProjectsClause("project");

  // Step 1: Get only the last next_steps per session, but only if no completed exists after it
  const ttlMs = (config.journey.todoTtlDays ?? 14) * 24 * 60 * 60 * 1000;
  const ttlCutoff = Date.now() - ttlMs;

  const lastNextStepsPerSession = db
    .prepare(
      `SELECT s.memory_session_id, s.next_steps, s.project, s.created_at_epoch
       FROM session_summaries s
       INNER JOIN (
         SELECT memory_session_id, MAX(created_at_epoch) as max_epoch
         FROM session_summaries
         WHERE next_steps IS NOT NULL AND LENGTH(next_steps) > 5
           AND ${excludedInner.sql}
           AND created_at_epoch >= ?
           AND ${noiseWhere}
         GROUP BY memory_session_id
       ) last ON s.memory_session_id = last.memory_session_id
         AND s.created_at_epoch = last.max_epoch
       WHERE s.next_steps IS NOT NULL AND LENGTH(s.next_steps) > 5
         AND NOT EXISTS (
           SELECT 1 FROM session_summaries s2
           WHERE s2.memory_session_id = s.memory_session_id
             AND s2.created_at_epoch > s.created_at_epoch
             AND s2.completed IS NOT NULL AND s2.completed != ''
         )
       ORDER BY s.created_at_epoch DESC
       LIMIT ${config.journey.todoLimit * 2}`
    )
    .all(...excludedInner.params, ttlCutoff, ...noiseParams);

  // Step 2: Get session start times for ordering sessions
  const sessionOrder = db
    .prepare(
      `SELECT memory_session_id, MIN(created_at_epoch) as session_start
       FROM session_summaries
       GROUP BY memory_session_id
       ORDER BY session_start ASC`
    )
    .all();

  const sessionIndex = new Map(
    sessionOrder.map((r, i) => [r.memory_session_id, i])
  );

  // Step 2: Cross-session filtering — check if next sessions' completed covers this next_steps
  // Split next_steps into individual lines and filter out completed ones
  const NEXT_SESSION_RANGE = 5;

  const todo = lastNextStepsPerSession
    .flatMap((r) => {
      const currentIdx = sessionIndex.get(r.memory_session_id);
      const lines = r.next_steps
        .split("\n")
        .map((l) => l.replace(/^[\s\-*]+/, "").trim())
        .filter((l) => l.length > 5);

      const date = r.created_at_epoch
        ? new Date(r.created_at_epoch).toISOString().split("T")[0]
        : "unknown";

      if (currentIdx == null || lines.length === 0) {
        return lines.length > 0
          ? [{ text: r.next_steps, project: r.project || "General", date }]
          : [];
      }

      const nextSessions = sessionOrder
        .slice(currentIdx + 1, currentIdx + 1 + NEXT_SESSION_RANGE)
        .map((s) => s.memory_session_id);

      if (nextSessions.length === 0) {
        return [{ text: r.next_steps, project: r.project || "General", date }];
      }

      const placeholders = nextSessions.map(() => "?").join(",");
      const completedInNext = db
        .prepare(
          `SELECT completed FROM session_summaries
           WHERE memory_session_id IN (${placeholders})
             AND completed IS NOT NULL AND completed != ''`
        )
        .all(...nextSessions);

      if (completedInNext.length === 0) {
        return [{ text: r.next_steps, project: r.project || "General" }];
      }

      const remainingLines = lines.filter((line) => {
        return !completedInNext.some(
          (c) => weightedContainment(line, c.completed) >= COMPLETED_SIMILARITY_THRESHOLD
        );
      });

      if (remainingLines.length === 0) return [];
      return [{ text: remainingLines.join("\n"), project: r.project || "General", date }];
    })
    .slice(0, config.journey.todoLimit);

  const excludedHistory = buildExcludedProjectsClause("project");
  const recentActivityCutoff = Date.now() - 10 * 60 * 1000;

  const history = db
    .prepare(
      `SELECT
         COALESCE(first.project, comp.project) as project,
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
           WHERE ${excludedHistory.sql}
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
       ORDER BY first.created_at_epoch DESC
       LIMIT ${config.journey.historyLimit}`
    )
    .all(...excludedHistory.params, recentActivityCutoff)
    .map((r) => ({
      date: r.created_at ? r.created_at.split("T")[0] : "unknown",
      project: r.project || "General",
      title: r.custom_title || r.request || r.investigated || "Session",
      description: r.completed || "",
    }));

  return { todo, history };
}
