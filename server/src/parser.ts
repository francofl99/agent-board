import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import os from "node:os";
import type { RawSession, SessionStatus } from "./types.js";

export const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
export const CODEX_DIR = path.join(os.homedir(), ".codex", "sessions");
const ACTIVE_WINDOW_MS = 10 * 60 * 1000; // session touched < 10 min ago => "active now"
const MAX_LEN = 140;
// GitHub PR URLs anywhere in the transcript (tool output, assistant text). The \d+
// requirement naturally skips the "/pull/new/<branch>" create links.
const PR_RE = /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;

// Wrapper blocks Codex injects into the first user turn; not real prompts.
const NOISE_PREFIXES = ["<environment_context>", "<user_instructions>"];
function isNoise(text: string): boolean {
  return NOISE_PREFIXES.some((p) => text.trimStart().startsWith(p));
}

// Infer status from the last real message turn (evaluated at sync time, i.e. when
// there was activity): the agent closed its turn => waiting for the user; a pending
// user message or an in-flight tool call => working; no messages => idle.
function deriveStatus(lastRole: string, lastStop: string | null): SessionStatus {
  if (lastRole === "assistant") return lastStop === "tool_use" ? "working" : "waiting_user";
  if (lastRole === "user") return "working";
  return "idle";
}

function truncate(s: string): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > MAX_LEN ? clean.slice(0, MAX_LEN) + "…" : clean;
}

// content can be a string or an array of blocks ({ type, text, ... })
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as any).text ?? "") : ""))
      .join(" ")
      .trim();
  }
  return "";
}

export async function parseSession(filePath: string, projectSlug: string): Promise<RawSession | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (stat === null) return null;

  const id = path.basename(filePath, ".jsonl");
  let customTitle: string | null = null;
  let firstUserText = "";
  let lastPrompt = "";
  let lastAssistantText = "";
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  let messageCount = 0;
  let lastRole = "";
  let lastStop: string | null = null;
  let lastMsgText = "";
  let lastMsgRole = "";
  const prs = new Set<string>();

  const rl = readline.createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim() === "") continue;
    for (const m of line.matchAll(PR_RE)) prs.add(m[0]);
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const type = o.type;
    if (type === "custom-title" && typeof o.customTitle === "string") {
      customTitle = o.customTitle;
    } else if (type === "last-prompt" && typeof o.lastPrompt === "string") {
      lastPrompt = o.lastPrompt;
    } else if (type === "user" || type === "assistant") {
      messageCount++;
      if (o.cwd) cwd = o.cwd;
      if (o.gitBranch) gitBranch = o.gitBranch;
      lastRole = type;
      lastStop = type === "assistant" ? o.message?.stop_reason ?? null : null;
      const text = extractText(o.message?.content);
      if (type === "user" && firstUserText === "" && text !== "") firstUserText = text;
      if (type === "assistant" && text !== "") lastAssistantText = text;
      if (text !== "") {
        lastMsgText = text;
        lastMsgRole = type;
      }
    }
  }

  const title = truncate(customTitle || firstUserText || id);
  const preview = truncate(lastPrompt || lastAssistantText || firstUserText || "");
  const lastActivity = stat.mtime.toISOString();
  const active = Date.now() - stat.mtimeMs < ACTIVE_WINDOW_MS;

  return {
    id,
    provider: "claude",
    status: deriveStatus(lastRole, lastStop),
    projectSlug,
    projectPath: cwd,
    gitBranch,
    title,
    preview,
    lastMessage: truncate(lastMsgText),
    lastMessageRole: lastMsgRole as "user" | "assistant" | "",
    pullRequests: [...prs],
    messageCount,
    lastActivity,
    sizeBytes: stat.size,
    active,
    filePath,
  };
}

export async function scanClaudeSessions(): Promise<RawSession[]> {
  const slugs = await fs.readdir(PROJECTS_DIR).catch(() => [] as string[]);
  const out: RawSession[] = [];
  for (const slug of slugs) {
    const dir = path.join(PROJECTS_DIR, slug);
    const st = await fs.stat(dir).catch(() => null);
    if (st === null || !st.isDirectory()) continue;
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const s = await parseSession(path.join(dir, f), slug);
      if (s) out.push(s);
    }
  }
  return out;
}

export async function parseCodexSession(filePath: string): Promise<RawSession | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (stat === null) return null;

  let id = path.basename(filePath, ".jsonl");
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  let firstUserText = "";
  let lastUserText = "";
  let lastAssistantText = "";
  let messageCount = 0;
  let lastRole = "";
  let lastMsgText = "";
  let lastMsgRole = "";
  const prs = new Set<string>();

  const rl = readline.createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim() === "") continue;
    for (const m of line.matchAll(PR_RE)) prs.add(m[0]);
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type === "session_meta") {
      const p = o.payload ?? {};
      if (p.id) id = p.id;
      if (p.cwd) cwd = p.cwd;
      if (p.git?.branch) gitBranch = p.git.branch;
    } else if (o.type === "response_item" && o.payload?.type === "message") {
      const role = o.payload.role;
      if (role !== "user" && role !== "assistant") continue;
      const text = extractText(o.payload.content);
      if (text === "") continue;
      messageCount++;
      lastRole = role;
      if (role === "user") {
        if (!isNoise(text)) {
          if (firstUserText === "") firstUserText = text;
          lastUserText = text;
          lastMsgText = text;
          lastMsgRole = role;
        }
      } else {
        lastAssistantText = text;
        lastMsgText = text;
        lastMsgRole = role;
      }
    }
  }

  const title = truncate(firstUserText || id);
  const preview = truncate(lastUserText || lastAssistantText || firstUserText || "");

  return {
    id,
    provider: "codex",
    status: deriveStatus(lastRole, null),
    projectSlug: cwd ?? "codex",
    projectPath: cwd,
    gitBranch,
    title,
    preview,
    lastMessage: truncate(lastMsgText),
    lastMessageRole: lastMsgRole as "user" | "assistant" | "",
    pullRequests: [...prs],
    messageCount,
    lastActivity: stat.mtime.toISOString(),
    sizeBytes: stat.size,
    active: Date.now() - stat.mtimeMs < ACTIVE_WINDOW_MS,
    filePath,
  };
}

// Codex nests rollouts under sessions/YYYY/MM/DD/*.jsonl — walk recursively.
async function walkJsonl(dir: string, acc: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walkJsonl(full, acc);
    else if (e.isFile() && e.name.endsWith(".jsonl")) acc.push(full);
  }
}

export async function scanCodexSessions(): Promise<RawSession[]> {
  const files: string[] = [];
  await walkJsonl(CODEX_DIR, files);
  const out: RawSession[] = [];
  for (const f of files) {
    const s = await parseCodexSession(f);
    if (s) out.push(s);
  }
  return out;
}

export async function scanAllSessions(): Promise<RawSession[]> {
  const [claude, codex] = await Promise.all([scanClaudeSessions(), scanCodexSessions()]);
  const out = [...claude, ...codex];
  out.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  return out;
}
