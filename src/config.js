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
    todoLimit: 10,
    todoTtlDays: 14,
    historyLimit: 20,
    // System-level noise project names caused by claude-mem cwd resolution quirks.
    // Filtered from both TODO and History queries. Override via config.json if needed.
    excludedProjectNames: ["Workspaces", "Workspace", "observer-sessions"],
    weekStartDay: 1, // 0=Sun, 1=Mon, ..., 6=Sat
    refreshIntervalMin: 60,
  },
  claude: { model: "opus", cliPath: "claude" },
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
      todoLimit: raw.journey?.todoLimit ?? DEFAULTS.journey.todoLimit,
      todoTtlDays: raw.journey?.todoTtlDays ?? DEFAULTS.journey.todoTtlDays,
      historyLimit: raw.journey?.historyLimit ?? DEFAULTS.journey.historyLimit,
      excludedProjectNames: Array.isArray(raw.journey?.excludedProjectNames)
        ? raw.journey.excludedProjectNames
        : DEFAULTS.journey.excludedProjectNames,
      weekStartDay: raw.journey?.weekStartDay ?? DEFAULTS.journey.weekStartDay,
      refreshIntervalMin: raw.journey?.refreshIntervalMin ?? DEFAULTS.journey.refreshIntervalMin,
    },
    claude: {
      model: raw.claude?.model ?? DEFAULTS.claude.model,
      cliPath: raw.claude?.cliPath ?? DEFAULTS.claude.cliPath,
    },
    claudeMem: {
      disableReadCache: raw.claudeMem?.disableReadCache ?? false,
      excludedProjects: Array.isArray(raw.claudeMem?.excludedProjects)
        ? raw.claudeMem.excludedProjects
        : [],
    },
  };
}

export const config = loadConfig();
