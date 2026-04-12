import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const I18N_DIR = join(__dirname, "..", "i18n");

function loadI18n(language) {
  const filePath = join(I18N_DIR, `${language}.json`);
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.warn(`[i18n] ${language}.json not found, falling back to en.json`);
    return JSON.parse(readFileSync(join(I18N_DIR, "en.json"), "utf-8"));
  }
}

export function interpolate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export const t = loadI18n(config.language ?? "en");
