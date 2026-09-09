import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const GLOBAL_STATE = path.join(os.homedir(), ".codex", ".codex-global-state.json");
// The desktop app runs its own codex binary as an app-server; that process is what
// makes a desktop thread resumable at all.
const APP_SERVER = "ChatGPT.app/Contents/Resources/codex";

export interface CodexState {
  appRunning: boolean;
  unread: Set<string>; // threads whose last answer you haven't opened
  roots: Map<string, string>; // thread id → workspace root, for rollouts without a cwd
  cliCwds: Set<string>; // working dirs of codex processes running in a terminal
}

async function pids(pattern: string): Promise<number[]> {
  const { stdout } = await run("pgrep", ["-f", pattern]).catch(() => ({ stdout: "" }));
  return stdout
    .split("\n")
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

async function cwdOf(pid: number): Promise<string> {
  const { stdout } = await run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).catch(() => ({
    stdout: "",
  }));
  return stdout.split("\n").find((l) => l.startsWith("n"))?.slice(1) ?? "";
}

// A terminal session leaves no registry file, so the process table is the only
// evidence it exists; its cwd is what ties it back to a rollout.
async function cliWorkingDirs(): Promise<Set<string>> {
  const all = await pids("(^|/)codex($| )");
  const appServer = new Set(await pids(APP_SERVER));
  const out = new Set<string>();
  for (const pid of all) {
    if (appServer.has(pid)) continue;
    const cwd = await cwdOf(pid);
    if (cwd !== "") out.add(cwd);
  }
  return out;
}

export async function readCodexState(): Promise<CodexState> {
  const [appPids, cliCwds, raw] = await Promise.all([
    pids(APP_SERVER),
    cliWorkingDirs(),
    fs.readFile(GLOBAL_STATE, "utf8").catch(() => ""),
  ]);

  const state: CodexState = {
    appRunning: appPids.length > 0,
    unread: new Set(),
    roots: new Map(),
    cliCwds,
  };
  if (raw === "") return state;

  try {
    const o = JSON.parse(raw);
    const unread = o["electron-persisted-atom-state"]?.["unread-thread-ids-by-host-v1"] ?? {};
    for (const ids of Object.values(unread)) {
      for (const id of Array.isArray(ids) ? ids : []) if (typeof id === "string") state.unread.add(id);
    }
    for (const [id, root] of Object.entries(o["thread-workspace-root-hints"] ?? {})) {
      if (typeof root === "string") state.roots.set(id, root);
    }
  } catch {
    /* the app rewrites this file constantly; a half-written read is not an error */
  }
  return state;
}
