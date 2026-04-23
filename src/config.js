import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "..", "config.json");

const DEFAULTS = {
  port: 3000,
  accentColor: null,
  language: "en",
  journey: {
    historyLimit: 20,
    // System-level noise project names caused by claude-mem cwd resolution quirks.
    // Override via config.json if needed.
    excludedProjectNames: ["Workspaces", "Workspace", "observer-sessions"],
    weekStartDay: 1, // 0=Sun, 1=Mon, ..., 6=Sat
  },
  claude: {
    // Models tried in order. First success wins. Fallback only on explicit
    // operational failures (rate_limit / timeout / unavailable) — never on
    // quality heuristics. Each generated section reports which model produced it.
    modelPriority: ["opus", "sonnet"],
    cliPath: "claude",
  },
  claudeMem: {
    disableReadCache: false,
    excludedProjects: [],
    logPruner: {
      enabled: false,
      retentionDays: 7,
    },
  },
};

function loadConfig() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch (err) {
    console.error(
      "[config] config.json not found. Copy config.json.example to config.json and edit it."
    );
    process.exit(1);
  }

  if (!raw.userName || !raw.role || !raw.avatar) {
    console.error("[config] userName, role, avatar are required in config.json");
    process.exit(1);
  }

  return {
    userName: raw.userName,
    role: raw.role,
    avatar: raw.avatar,
    port: raw.port ?? DEFAULTS.port,
    accentColor: raw.accentColor ?? DEFAULTS.accentColor,
    language: raw.language ?? DEFAULTS.language,
    journey: {
      historyLimit: raw.journey?.historyLimit ?? DEFAULTS.journey.historyLimit,
      excludedProjectNames: Array.isArray(raw.journey?.excludedProjectNames)
        ? raw.journey.excludedProjectNames
        : DEFAULTS.journey.excludedProjectNames,
      weekStartDay: raw.journey?.weekStartDay ?? DEFAULTS.journey.weekStartDay,
    },
    claude: {
      modelPriority: Array.isArray(raw.claude?.modelPriority)
        ? raw.claude.modelPriority
        : raw.claude?.model
          ? [raw.claude.model, "sonnet"].filter((v, i, a) => a.indexOf(v) === i)
          : DEFAULTS.claude.modelPriority,
      cliPath: raw.claude?.cliPath ?? DEFAULTS.claude.cliPath,
    },
    claudeMem: {
      disableReadCache: raw.claudeMem?.disableReadCache ?? false,
      excludedProjects: Array.isArray(raw.claudeMem?.excludedProjects)
        ? raw.claudeMem.excludedProjects
        : [],
      logPruner: {
        enabled: raw.claudeMem?.logPruner?.enabled ?? DEFAULTS.claudeMem.logPruner.enabled,
        retentionDays: Number.isFinite(Number(raw.claudeMem?.logPruner?.retentionDays))
          ? Number(raw.claudeMem.logPruner.retentionDays)
          : DEFAULTS.claudeMem.logPruner.retentionDays,
      },
    },
  };
}

export const config = loadConfig();
