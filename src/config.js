import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "..", "config.json");

const DEFAULTS = {
  port: 3000,
  accentColor: null,
  language: "en",
  journey: { todoLimit: 10, historyLimit: 20 },
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
      historyLimit: raw.journey?.historyLimit ?? DEFAULTS.journey.historyLimit,
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
