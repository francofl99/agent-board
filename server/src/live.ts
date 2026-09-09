import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppConfig } from "./config.js";
import type { Client } from "./types.js";

export interface LiveProcess {
  pid: number;
  sessionId: string;
  cwd: string;
  name: string;
  nameSource: string;
  version: string;
  client: Client;
  startedAt: number;
}

// The registry file outlives the process it describes (no cleanup on SIGKILL), so a
// row only counts as live if the pid still answers.
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function scanLiveClaude(cfg: AppConfig): Promise<Map<string, LiveProcess>> {
  const out = new Map<string, LiveProcess>();
  const files = await fs.readdir(cfg.claudeSessionsDir).catch(() => [] as string[]);
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const raw = await fs.readFile(path.join(cfg.claudeSessionsDir, f), "utf8").catch(() => "");
    if (raw === "") continue;
    let o: any;
    try {
      o = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof o.pid !== "number" || typeof o.sessionId !== "string") continue;
    if (!alive(o.pid)) continue;
    out.set(o.sessionId, {
      pid: o.pid,
      sessionId: o.sessionId,
      cwd: o.cwd ?? "",
      name: o.name ?? "",
      nameSource: o.nameSource ?? "",
      version: o.version ?? "",
      client: String(o.entrypoint ?? "").includes("desktop") ? "desktop" : "cli",
      startedAt: o.startedAt ?? 0,
    });
  }
  return out;
}

export interface CodexIndexEntry {
  id: string;
  threadName: string;
  updatedAt: string;
}

// Codex has no live-process registry; its index only gives human thread names.
export async function readCodexIndex(cfg: AppConfig): Promise<Map<string, CodexIndexEntry>> {
  const out = new Map<string, CodexIndexEntry>();
  const raw = await fs.readFile(cfg.codexIndexFile, "utf8").catch(() => "");
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const o = JSON.parse(line);
      if (typeof o.id === "string") {
        out.set(o.id, { id: o.id, threadName: o.thread_name ?? "", updatedAt: o.updated_at ?? "" });
      }
    } catch {
      continue;
    }
  }
  return out;
}
