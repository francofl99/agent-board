import { promises as fs } from "node:fs";
import path from "node:path";
import { parseCodexSession, parseSession, walkJsonl } from "./parser.js";
import { readCodexIndex, scanLiveClaude, type LiveProcess } from "./live.js";
import { readCodexState, type CodexState } from "./codex.js";
import { costUsd, loadPricing } from "./pricing.js";
import { loadUserData, userDataFor } from "./store.js";
import type { AppConfig } from "./config.js";
import type { FleetSession, RawSession } from "./types.js";

interface CacheEntry {
  mtimeMs: number;
  session: RawSession;
}

// Transcripts are append-only, so a file whose mtime hasn't moved cannot have
// changed: re-parsing it on every 5s refresh would read hundreds of MB for nothing.
const cache = new Map<string, CacheEntry>();

interface Candidate {
  filePath: string;
  slug: string;
  provider: "claude" | "codex";
  mtimeMs: number;
}

async function claudeCandidates(cfg: AppConfig): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const slugs = await fs.readdir(cfg.claudeProjectsDir).catch(() => [] as string[]);
  for (const slug of slugs) {
    const dir = path.join(cfg.claudeProjectsDir, slug);
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      const full = path.join(dir, e.name);
      const st = await fs.stat(full).catch(() => null);
      if (st) out.push({ filePath: full, slug, provider: "claude", mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

async function codexCandidates(cfg: AppConfig): Promise<Candidate[]> {
  const files: string[] = [];
  await walkJsonl(cfg.codexDir, files);
  const out: Candidate[] = [];
  for (const f of files) {
    const st = await fs.stat(f).catch(() => null);
    if (st) out.push({ filePath: f, slug: "codex", provider: "codex", mtimeMs: st.mtimeMs });
  }
  return out;
}

async function parseCached(c: Candidate): Promise<RawSession | null> {
  const hit = cache.get(c.filePath);
  if (hit && hit.mtimeMs === c.mtimeMs) return hit.session;
  const s =
    c.provider === "claude"
      ? await parseSession(c.filePath, c.slug)
      : await parseCodexSession(c.filePath);
  if (s === null) return null;
  cache.set(c.filePath, { mtimeMs: c.mtimeMs, session: s });
  return s;
}

export interface ScanResult {
  sessions: FleetSession[];
  scannedAt: string;
  paths: { path: string; found: number }[];
}

export async function scanFleet(cfg: AppConfig): Promise<ScanResult> {
  const [claude, codex, live, codexIndex, codexState, pricing, userData] = await Promise.all([
    claudeCandidates(cfg),
    codexCandidates(cfg),
    scanLiveClaude(cfg),
    readCodexIndex(cfg),
    readCodexState(),
    loadPricing(),
    loadUserData(),
  ]);

  const liveByFileId = new Set([...live.values()].map((l) => l.sessionId));
  const cutoff = Date.now() - cfg.fleetWindowHours * 3600_000;
  const candidates = [...claude, ...codex].filter(
    (c) => c.mtimeMs >= cutoff || liveByFileId.has(path.basename(c.filePath, ".jsonl"))
  );

  const sessions: FleetSession[] = [];
  for (const c of candidates) {
    const raw = await parseCached(c);
    if (raw === null || raw.scheduledTask !== "") continue; // routines are automation noise
    const proc = live.get(raw.id) ?? null;
    const idx = codexIndex.get(raw.id);
    const ud = userDataFor(userData, raw.id);
    const dismissed = ud.dismissedAt !== "" && raw.lastActivity <= ud.dismissedAt;
    const projectPath = raw.projectPath ?? codexState.roots.get(raw.id) ?? null;
    const alive = raw.provider === "codex" ? codexAlive(raw, projectPath, codexState) : proc !== null;
    sessions.push({
      ...raw,
      projectPath,
      projectSlug: raw.projectSlug === "codex" && projectPath !== null ? projectPath : raw.projectSlug,
      client: proc?.client ?? raw.client,
      // Nothing can still be running under a session whose process is gone: a
      // transcript abandoned mid-task would otherwise show ghosts forever.
      running: alive ? raw.running : [],
      name: sessionName(raw, proc, idx?.threadName ?? ""),
      processName: proc?.name ?? "",
      pid: proc?.pid ?? null,
      liveStatus: deriveLiveStatus(raw, alive, raw.provider === "codex" && codexState.unread.has(raw.id)),
      costUsd: costUsd(raw, pricing),
      group: ud.group,
      notes: ud.notes,
      dismissed,
      dismissedAt: ud.dismissedAt,
    });
  }

  sessions.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  return {
    sessions,
    scannedAt: new Date().toISOString(),
    paths: [
      { path: cfg.claudeProjectsDir, found: claude.length },
      { path: cfg.claudeSessionsDir, found: live.size },
      { path: cfg.codexDir, found: codex.length },
    ],
  };
}

// The registry name is a slug the CLI derives from the cwd ("rocky-console-52"): it
// identifies the process, not the work. The session's own title wins unless you
// renamed the session yourself.
function sessionName(raw: RawSession, proc: LiveProcess | null, threadName: string): string {
  if (proc !== null && proc.nameSource === "user" && proc.name !== "") return proc.name;
  // Codex curates a thread name; Claude's title is the curated one there.
  if (raw.provider === "codex" && threadName !== "") return threadName;
  return raw.title || threadName || proc?.name || raw.id;
}

// Claude publishes a pid registry per session. Codex publishes none, so a thread is
// resumable while its host is up: the desktop app-server for a desktop thread, a
// terminal codex process in that directory for a CLI one.
function codexAlive(raw: RawSession, projectPath: string | null, state: CodexState): boolean {
  if (raw.client === "cli") return projectPath !== null && state.cliCwds.has(projectPath);
  return state.appRunning;
}

// A session nobody is running is "ended", whatever its last turn looked like.
function deriveLiveStatus(
  raw: RawSession,
  hasProcess: boolean,
  unread: boolean
): FleetSession["liveStatus"] {
  if (!hasProcess) return "ended";
  // Codex marks a thread unread until you open the answer: the ball is in your court.
  if (unread || raw.status === "waiting_user") return "waiting_input";
  if (raw.status === "working") return "working";
  return "idle";
}

export async function findSession(cfg: AppConfig, id: string): Promise<FleetSession | null> {
  const { sessions } = await scanFleet(cfg);
  return sessions.find((s) => s.id === id) ?? null;
}
