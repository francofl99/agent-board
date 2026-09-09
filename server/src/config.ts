import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AppConfig {
  claudeProjectsDir: string;
  claudeSessionsDir: string; // live process registry
  codexDir: string;
  codexIndexFile: string;
  refreshMs: number;
  fleetWindowHours: number; // how far back a dead session still shows in Fleet
  port: number;
}

export const CONFIG_DIR = path.join(os.homedir(), ".agent-board");
const CONFIG_FILE = path.join(CONFIG_DIR, "app.json");

export function defaultConfig(): AppConfig {
  const home = os.homedir();
  return {
    claudeProjectsDir: path.join(home, ".claude", "projects"),
    claudeSessionsDir: path.join(home, ".claude", "sessions"),
    codexDir: path.join(home, ".codex", "sessions"),
    codexIndexFile: path.join(home, ".codex", "session_index.jsonl"),
    refreshMs: 5000,
    fleetWindowHours: 24,
    port: 4319,
  };
}

export async function loadAppConfig(): Promise<AppConfig> {
  const raw = await fs.readFile(CONFIG_FILE, "utf8").catch(() => "");
  if (raw === "") return defaultConfig();
  try {
    return { ...defaultConfig(), ...(JSON.parse(raw) as Partial<AppConfig>) };
  } catch {
    return defaultConfig();
  }
}

export async function saveAppConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const next = { ...(await loadAppConfig()), ...patch };
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(next, null, 2) + "\n");
  return next;
}
