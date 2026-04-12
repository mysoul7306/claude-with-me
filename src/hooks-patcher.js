import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CLAUDE_MEM_CACHE = join(
  homedir(),
  ".claude",
  "plugins",
  "cache",
  "thedotmack",
  "claude-mem"
);

const CLAUDE_MEM_SETTINGS = join(homedir(), ".claude-mem", "settings.json");

/**
 * Find the latest claude-mem plugin version directory.
 */
function findLatestVersion() {
  try {
    const entries = readdirSync(CLAUDE_MEM_CACHE, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d/.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => {
        const pa = a.split(".").map(Number);
        const pb = b.split(".").map(Number);
        for (let i = 0; i < 3; i++) {
          if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
        }
        return 0;
      });
    return entries.length > 0 ? entries[entries.length - 1] : null;
  } catch {
    return null;
  }
}

/**
 * Patch claude-mem hooks.json to remove PreToolUse Read hook
 * that causes "File unchanged since last read" caching issues.
 */
export function patchClaudeMemHooks({ disableReadCache = false } = {}) {
  if (!disableReadCache) {
    return { patched: false, version: null, message: "disableReadCache is off" };
  }

  const version = findLatestVersion();
  if (!version) {
    return { patched: false, version: null, message: "claude-mem not found" };
  }

  const hooksPath = join(CLAUDE_MEM_CACHE, version, "hooks", "hooks.json");

  let hooks;
  try {
    hooks = JSON.parse(readFileSync(hooksPath, "utf-8"));
  } catch {
    return { patched: false, version, message: "hooks.json not readable" };
  }

  if (!hooks.hooks?.PreToolUse?.length) {
    return { patched: false, version, message: "Read hook already removed" };
  }

  const before = hooks.hooks.PreToolUse.length;
  hooks.hooks.PreToolUse = hooks.hooks.PreToolUse.filter(
    (entry) => entry.matcher !== "Read"
  );

  if (before === hooks.hooks.PreToolUse.length) {
    return { patched: false, version, message: "Read hook already removed" };
  }

  if (hooks.hooks.PreToolUse.length === 0) {
    delete hooks.hooks.PreToolUse;
  }

  writeFileSync(hooksPath, JSON.stringify(hooks, null, 2) + "\n");
  return {
    patched: true,
    version,
    message: `Removed PreToolUse:Read hook from claude-mem ${version}`,
  };
}

/**
 * Sync excludedProjects from config.json to claude-mem settings.json.
 *
 * config.json format (array of glob patterns):
 *   "excludedProjects": ["~/Workspaces/**", "~/secret-project"]
 *
 * claude-mem settings.json format (comma-separated string):
 *   "CLAUDE_MEM_EXCLUDED_PROJECTS": "~/Workspaces/**,~/secret-project"
 */
export function syncExcludedProjects({ excludedProjects = [] } = {}) {
  const newValue = excludedProjects.join(",");

  let settings;
  try {
    settings = JSON.parse(readFileSync(CLAUDE_MEM_SETTINGS, "utf-8"));
  } catch {
    return { synced: false, message: "claude-mem settings.json not readable" };
  }

  const current = settings.CLAUDE_MEM_EXCLUDED_PROJECTS ?? "";

  if (current === newValue) {
    return {
      synced: false,
      message: excludedProjects.length > 0
        ? `Already synced (${excludedProjects.length} patterns)`
        : "No excluded projects configured",
    };
  }

  const updated = { ...settings, CLAUDE_MEM_EXCLUDED_PROJECTS: newValue };
  writeFileSync(CLAUDE_MEM_SETTINGS, JSON.stringify(updated, null, 2) + "\n");

  return {
    synced: true,
    message: excludedProjects.length > 0
      ? `Synced ${excludedProjects.length} patterns: ${excludedProjects.join(", ")}`
      : "Cleared excluded projects",
  };
}
