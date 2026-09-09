import { createReadStream } from "node:fs";
import readline from "node:readline";
import type { Provider } from "./types.js";

export type EventKind = "prompt" | "assistant" | "tool";

export interface TimelineEvent {
  at: string; // ISO, "" when the record carries no timestamp
  kind: EventKind;
  text: string;
  meta: string; // path, command, url — always mono in the UI
}

export interface Transcript {
  events: TimelineEvent[];
  totalEvents: number;
  files: string[]; // files the agent read or wrote, most recent first
  prs: string[];
}

const PR_RE = /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;
const MAX_EVENTS = 400; // detail panel only ever renders a tail
// Everything the harness injects into the user turn: skill bodies, hook output,
// slash-command wrappers, compaction summaries. None of it was typed by anyone.
const WRAPPED = /<(system-reminder|command-message|command-name|local-command-[a-z]+|environment_context|user_instructions|app-context)>[\s\S]*?<\/\1>/g;
const INTERRUPTED = /^\[Request interrupted/;

function clean(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function unwrap(text: string): string {
  return text.replace(WRAPPED, " ").trim();
}

function isNoise(text: string): boolean {
  return text === "" || text.startsWith("<") || INTERRUPTED.test(text);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b: any) => (b && typeof b === "object" ? String(b.text ?? b.input_text ?? "") : ""))
    .join(" ")
    .trim();
}

// One line per tool call: the tool name plus the single argument that says what it
// touched. Anything longer turns the timeline into a log dump.
function toolMeta(input: any): string {
  if (input === null || typeof input !== "object") return "";
  const first = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.url ?? input.prompt;
  return typeof first === "string" ? clean(first, 120) : "";
}

function pushFile(files: string[], input: any): void {
  const p = input?.file_path ?? input?.path;
  if (typeof p === "string" && p !== "" && !files.includes(p)) files.unshift(p);
}

// Codex's `exec` input is a JS snippet that calls other tools, so the tool name in
// the record ("exec") says nothing: the call inside it is the real action.
function codexTool(name: string, input: unknown): { name: string; meta: string } {
  const text = typeof input === "string" ? input : JSON.stringify(input ?? "");
  const cmd = text.match(/cmd:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  if (cmd !== undefined) return { name: "shell", meta: clean(cmd.replace(/\\n/g, " "), 120) };
  const inner = text.match(/tools\.([A-Za-z0-9_]+)/)?.[1];
  if (inner !== undefined) {
    return { name: inner.replace(/^mcp__[a-z0-9_]+__/, ""), meta: clean(text, 100) };
  }
  return { name, meta: clean(text, 120) };
}

export async function readTranscript(filePath: string, provider: Provider): Promise<Transcript> {
  const events: TimelineEvent[] = [];
  const files: string[] = [];
  const prs = new Set<string>();
  let total = 0;

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
    const at = typeof o.timestamp === "string" ? o.timestamp : "";
    const add = (kind: EventKind, text: string, meta: string) => {
      if (text === "" && meta === "") return;
      total++;
      events.push({ at, kind, text, meta });
      if (events.length > MAX_EVENTS) events.shift();
    };

    if (provider === "claude") {
      if (o.type === "user") {
        if (o.isMeta === true || o.isCompactSummary === true || o.toolUseResult !== undefined) continue;
        const t = unwrap(textOf(o.message?.content));
        if (!isNoise(t)) add("prompt", clean(t, 260), "");
      } else if (o.type === "assistant") {
        const blocks = Array.isArray(o.message?.content) ? o.message.content : [];
        for (const b of blocks) {
          if (b?.type === "text" && !isNoise(unwrap(String(b.text ?? "")))) {
            add("assistant", clean(unwrap(String(b.text)), 220), "");
          } else if (b?.type === "tool_use") {
            pushFile(files, b.input);
            add("tool", String(b.name ?? "tool"), toolMeta(b.input));
          }
        }
      }
    } else {
      const p = o.payload ?? {};
      if (p.type === "message" && (p.role === "user" || p.role === "assistant")) {
        const t = unwrap(textOf(p.content));
        if (!isNoise(t)) {
          add(p.role === "user" ? "prompt" : "assistant", clean(t, p.role === "user" ? 260 : 220), "");
        }
      } else if (p.type === "custom_tool_call" || p.type === "function_call") {
        const { name, meta } = codexTool(String(p.name ?? "tool"), p.input ?? p.arguments ?? "");
        add("tool", name, meta);
      }
    }
  }

  return { events, totalEvents: total, files: files.slice(0, 12), prs: [...prs] };
}
