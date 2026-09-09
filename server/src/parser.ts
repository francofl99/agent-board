import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import os from "node:os";
import type { Client, RawSession, SessionStatus } from "./types.js";

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

// Claude stamps every transcript record with the app it came from; Codex stamps the
// session_meta with an originator string. Both distinguish terminal from desktop.
function clientFromEntrypoint(entrypoint: string): Client {
  if (entrypoint === "") return "";
  return entrypoint.includes("desktop") ? "desktop" : "cli";
}

function clientFromOriginator(originator: string): Client {
  if (originator === "") return "";
  return /desktop|vscode|app/i.test(originator) ? "desktop" : "cli";
}

interface PendingWork {
  id: string;
  name: string;
  kind: "agent" | "background";
  startedAt: string;
  endsWithNotification: boolean;
}

// Codex reports turn boundaries directly, so its status comes from those rather than
// from guessing at the last message's role.
function deriveCodexStatus(started: number, done: number, messages: number): SessionStatus {
  if (started > done) return "working";
  if (messages > 0) return "waiting_user";
  return "idle";
}

// The exec input is a snippet of JS calling tools.exec_command; the command string
// inside it is the only human-readable part.
function commandOf(input: unknown): string {
  const text = typeof input === "string" ? input : JSON.stringify(input ?? "");
  const cmd = text.match(/cmd:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  return cmd !== undefined ? cmd.replace(/\\n/g, " ") : "exec";
}

function truncate(s: string, max: number = MAX_LEN): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
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
  let model = "";
  let tokensOut = 0;
  let tokensIn = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let entrypoint = "";
  let startedAt = "";
  const prs = new Set<string>();
  const pending = new Map<string, PendingWork>();
  const recent: { role: string; text: string }[] = [];

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
    if (typeof o.entrypoint === "string" && o.entrypoint !== "") entrypoint = o.entrypoint;
    if (typeof o.timestamp === "string" && startedAt === "") startedAt = o.timestamp;
    if (type === "assistant") {
      // Delegated work starts here and is cleared when it reports back (below), so
      // what is left in `pending` at EOF is what the agent is still waiting on.
      for (const b of Array.isArray(o.message?.content) ? o.message.content : []) {
        if (b?.type !== "tool_use" || typeof b.id !== "string") continue;
        const background = b.input?.run_in_background === true;
        if (b.name === "Agent" || b.name === "Task") {
          pending.set(b.id, {
            id: b.id,
            name: String(b.input?.subagent_type ?? b.input?.description ?? "agent"),
            kind: "agent",
            startedAt: typeof o.timestamp === "string" ? o.timestamp : "",
            // A backgrounded hand-off answers immediately and finishes later, in a
            // task-notification; a foreground one finishes with its tool_result.
            endsWithNotification: background,
          });
        } else if (b.name === "Bash" && background) {
          pending.set(b.id, {
            id: b.id,
            name: truncate(String(b.input?.description ?? b.input?.command ?? "background"), 60),
            kind: "background",
            startedAt: typeof o.timestamp === "string" ? o.timestamp : "",
            endsWithNotification: true,
          });
        }
      }
      if (typeof o.message?.model === "string") model = o.message.model;
      const u = o.message?.usage;
      tokensOut += u?.output_tokens ?? 0;
      tokensIn += u?.input_tokens ?? 0;
      cacheRead += u?.cache_read_input_tokens ?? 0;
      cacheWrite += u?.cache_creation_input_tokens ?? 0;
    }
    if (type === "custom-title" && typeof o.customTitle === "string") {
      customTitle = o.customTitle;
    } else if (type === "last-prompt" && typeof o.lastPrompt === "string") {
      lastPrompt = o.lastPrompt;
    } else if (type === "attachment") {
      const prompt = String(o.attachment?.prompt ?? "");
      if (o.attachment?.commandMode === "task-notification") {
        const id = prompt.match(/<tool-use-id>([^<]+)<\/tool-use-id>/)?.[1];
        if (id !== undefined) pending.delete(id);
      }
    } else if (type === "user" || type === "assistant") {
      const injected = type === "user" && (o.isMeta === true || o.toolUseResult !== undefined);
      for (const b of type === "user" && Array.isArray(o.message?.content) ? o.message.content : []) {
        if (b?.type !== "tool_result" || typeof b.tool_use_id !== "string") continue;
        if (pending.get(b.tool_use_id)?.endsWithNotification === false) pending.delete(b.tool_use_id);
      }
      messageCount++;
      if (o.cwd) cwd = o.cwd;
      if (o.gitBranch) gitBranch = o.gitBranch;
      lastRole = type;
      lastStop = type === "assistant" ? o.message?.stop_reason ?? null : null;
      const text = extractText(o.message?.content);
      if (type === "user" && firstUserText === "" && text !== "" && !injected && !text.trimStart().startsWith("<")) {
        firstUserText = text;
      }
      if (type === "assistant" && text !== "") lastAssistantText = text;
      if (text !== "") {
        lastMsgText = text;
        lastMsgRole = type;
        recent.push({ role: type, text: truncate(text, 500) });
        if (recent.length > 8) recent.shift();
      }
    }
  }

  const scheduledTask = firstUserText.match(/<scheduled-task name="([^"]+)"/)?.[1] ?? "";
  const title = truncate(customTitle || firstUserText || id);
  const preview = truncate(lastPrompt || lastAssistantText || firstUserText || "");
  const lastActivity = stat.mtime.toISOString();
  const active = Date.now() - stat.mtimeMs < ACTIVE_WINDOW_MS;

  return {
    id,
    provider: "claude",
    client: clientFromEntrypoint(entrypoint),
    status: deriveStatus(lastRole, lastStop),
    projectSlug,
    projectPath: cwd,
    gitBranch,
    title,
    preview,
    lastMessage: truncate(lastMsgText),
    lastMessageRole: lastMsgRole as "user" | "assistant" | "",
    pullRequests: [...prs],
    running: [...pending.values()].map(({ endsWithNotification, ...w }) => w),
    model,
    tokensOut,
    tokensIn,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    startedAt: startedAt || lastActivity,
    recentMessages: recent,
    scheduledTask,
    syncKey: id,
    messageCount,
    lastActivity,
    sizeBytes: stat.size,
    active,
    filePath,
  };
}

export async function scanClaudeSessions(root: string = PROJECTS_DIR): Promise<RawSession[]> {
  const slugs = await fs.readdir(root).catch(() => [] as string[]);
  const out: RawSession[] = [];
  for (const slug of slugs) {
    const dir = path.join(root, slug);
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
  let model = "";
  let tokensOut = 0;
  let tokensIn = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let originator = "";
  let threadSource = "";
  let startedAt = "";
  let turnsStarted = 0;
  let turnsDone = 0;
  const pending = new Map<string, PendingWork>();
  const prs = new Set<string>();
  const recent: { role: string; text: string }[] = [];

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
    const p = o.payload ?? {};
    if (typeof p.model === "string") model = p.model;
    if (typeof o.timestamp === "string" && startedAt === "") startedAt = o.timestamp;
    const tu = p.info?.total_token_usage ?? p.total_token_usage;
    if (tu?.output_tokens != null) tokensOut = tu.output_tokens; // cumulative, last wins
    if (tu?.input_tokens != null) tokensIn = tu.input_tokens;
    if (tu?.cached_input_tokens != null) cacheRead = tu.cached_input_tokens;
    if (tu?.cache_write_input_tokens != null) cacheWrite = tu.cache_write_input_tokens;
    if (o.type === "session_meta") {
      if (p.id) id = p.id;
      if (p.cwd) cwd = p.cwd;
      if (p.git?.branch) gitBranch = p.git.branch;
      if (typeof p.originator === "string") originator = p.originator;
      if (typeof p.thread_source === "string") threadSource = p.thread_source;
    } else if (p.type === "task_started") {
      turnsStarted++;
    } else if (p.type === "task_complete" || p.type === "turn_aborted") {
      turnsDone++;
    } else if (p.type === "custom_tool_call" || p.type === "function_call") {
      // `wait` blocks on a command Codex left running; an `exec` with no output yet is
      // still executing. Both are work the session is waiting on right now.
      const callId = String(p.call_id ?? p.id ?? "");
      if (callId !== "" && (p.name === "wait" || p.name === "exec" || p.name === "exec_command")) {
        pending.set(callId, {
          id: callId,
          name: p.name === "wait" ? "wait (comando en background)" : truncate(commandOf(p.input), 60),
          kind: p.name === "wait" ? "background" : "agent",
          startedAt: typeof o.timestamp === "string" ? o.timestamp : "",
          endsWithNotification: false,
        });
      }
    } else if (p.type === "custom_tool_call_output" || p.type === "function_call_output") {
      pending.delete(String(p.call_id ?? ""));
    } else if (o.type === "response_item" && o.payload?.type === "message") {
      const role = o.payload.role;
      if (role !== "user" && role !== "assistant") continue;
      const text = extractText(o.payload.content);
      if (text === "") continue;
      messageCount++;
      lastRole = role;
      if (role === "user") {
        if (!isNoise(text)) {
          // A title has to come from a real prompt, not from a wrapper block.
          if (firstUserText === "" && !text.trimStart().startsWith("<")) firstUserText = text;
          lastUserText = text;
          lastMsgText = text;
          lastMsgRole = role;
          recent.push({ role, text: truncate(text, 500) });
          if (recent.length > 8) recent.shift();
        }
      } else {
        lastAssistantText = text;
        lastMsgText = text;
        lastMsgRole = role;
        recent.push({ role, text: truncate(text, 500) });
        if (recent.length > 8) recent.shift();
      }
    }
  }

  const title = truncate(firstUserText || id);
  const preview = truncate(lastUserText || lastAssistantText || firstUserText || "");

  return {
    id,
    provider: "codex",
    client: clientFromOriginator(originator),
    status: deriveCodexStatus(turnsStarted, turnsDone, messageCount),
    projectSlug: cwd ?? "codex",
    projectPath: cwd,
    gitBranch,
    title,
    preview,
    lastMessage: truncate(lastMsgText),
    lastMessageRole: lastMsgRole as "user" | "assistant" | "",
    pullRequests: [...prs],
    running: [...pending.values()].map(({ endsWithNotification, ...w }) => w),
    model,
    tokensOut,
    tokensIn,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    startedAt: startedAt || stat.mtime.toISOString(),
    recentMessages: recent,
    scheduledTask: threadSource === "automation" ? "codex-automation" : "",
    syncKey: id,
    messageCount,
    lastActivity: stat.mtime.toISOString(),
    sizeBytes: stat.size,
    active: Date.now() - stat.mtimeMs < ACTIVE_WINDOW_MS,
    filePath,
  };
}

// Codex nests rollouts under sessions/YYYY/MM/DD/*.jsonl — walk recursively.
export async function walkJsonl(dir: string, acc: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walkJsonl(full, acc);
    else if (e.isFile() && e.name.endsWith(".jsonl")) acc.push(full);
  }
}

export async function scanCodexSessions(root: string = CODEX_DIR): Promise<RawSession[]> {
  const files: string[] = [];
  await walkJsonl(root, files);
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
