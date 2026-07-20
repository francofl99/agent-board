import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { Provider, RawSession, SessionStatus } from "./types.js";

const NOTION_VERSION = "2022-06-28";
const API = "https://api.notion.com/v1";

export interface NotionConfig {
  token: string;
  databaseId: string;
  intervalMs: number;
  sinceDays: number | null; // keep sessions touched within N days (null => no limit)
  onlyActive: boolean; // keep only sessions currently flagged active
  providers: Provider[] | null; // keep only these providers (null => all)
}

const ALL_PROVIDERS: Provider[] = ["claude", "codex", "opencode"];

function parseProviders(raw: unknown): Provider[] | null {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw !== ""
      ? raw.split(",")
      : null;
  if (list === null) return null;
  const valid = list
    .map((p) => String(p).trim().toLowerCase())
    .filter((p): p is Provider => (ALL_PROVIDERS as string[]).includes(p));
  return valid.length > 0 ? valid : null;
}

// Config resolution: env vars win, then ~/.agent-board/notion.json.
export function loadConfig(): NotionConfig {
  const file = path.join(os.homedir(), ".agent-board", "notion.json");
  let fromFile: Partial<NotionConfig> = {};
  try {
    fromFile = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* no file is fine */
  }
  const token = process.env.NOTION_TOKEN ?? fromFile.token ?? "";
  const databaseId = process.env.NOTION_DATABASE_ID ?? fromFile.databaseId ?? "";
  const intervalMs = Number(process.env.SYNC_INTERVAL_MS ?? fromFile.intervalMs ?? 30000);
  const rawSince = process.env.SYNC_SINCE_DAYS ?? fromFile.sinceDays ?? null;
  const sinceDays = rawSince === null || rawSince === "" ? null : Number(rawSince) || null;
  const onlyActive = (process.env.SYNC_ONLY_ACTIVE ?? String(fromFile.onlyActive ?? "")) === "true";
  const providers = parseProviders(process.env.SYNC_PROVIDERS ?? (fromFile as any).providers ?? null);
  if (token === "" || databaseId === "") {
    throw new Error(
      "Missing Notion config. Set NOTION_TOKEN and NOTION_DATABASE_ID (env) " +
        "or create ~/.agent-board/notion.json with { token, databaseId, intervalMs }."
    );
  }
  return { token, databaseId, intervalMs, sinceDays, onlyActive, providers };
}

// Which sessions the sync should keep in Notion, per the configured filters.
export function shouldSync(s: RawSession, cfg: NotionConfig): boolean {
  if (cfg.providers !== null && !cfg.providers.includes(s.provider)) return false;
  if (cfg.onlyActive && !s.active) return false;
  if (cfg.sinceDays !== null) {
    const ageDays = (Date.now() - new Date(s.lastActivity).getTime()) / 86_400_000;
    if (ageDays > cfg.sinceDays) return false;
  }
  return true;
}

// --- Display mapping (backend-owned fields only) ---
const STATUS_LABEL: Record<SessionStatus, string> = {
  working: "Trabajando",
  waiting_user: "Esperando respuesta",
  idle: "Inactiva",
};
const PROVIDER_LABEL: Record<Provider, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
};

function projectName(s: RawSession): string {
  if (s.projectPath) return s.projectPath.split("/").pop() || s.projectPath;
  return s.projectSlug.split("-").filter(Boolean).pop() || s.projectSlug;
}

// Flat snapshot of the fields the backend owns, for diffing + writing.
export interface Owned {
  name: string;
  provider: string;
  status: string;
  project: string;
  path: string;
  branch: string;
  messages: number;
  lastActivity: string;
  active: boolean;
  link: string;
}

export function ownedOf(s: RawSession): Owned {
  return {
    name: s.title || s.id,
    provider: PROVIDER_LABEL[s.provider],
    status: STATUS_LABEL[s.status],
    project: projectName(s),
    path: s.projectPath ?? "",
    branch: s.gitBranch ?? "",
    messages: s.messageCount,
    lastActivity: s.lastActivity,
    active: s.active,
    link: s.filePath,
  };
}

function text(value: string) {
  return { rich_text: value === "" ? [] : [{ text: { content: value.slice(0, 2000) } }] };
}

// Notion properties payload for the backend-owned fields. "Grupo" is never
// written here — it belongs to the user's board organization.
function ownedToProps(o: Owned): Record<string, unknown> {
  return {
    Name: { title: [{ text: { content: o.name.slice(0, 2000) } }] },
    Provider: { select: { name: o.provider } },
    Status: { select: { name: o.status } },
    Project: text(o.project),
    Path: text(o.path),
    Branch: text(o.branch),
    Messages: { number: o.messages },
    "Last activity": { date: { start: o.lastActivity } },
    Active: { checkbox: o.active },
    Link: text(o.link),
  };
}

// --- HTTP ---
async function api(cfg: NotionConfig, method: string, endpoint: string, body?: unknown) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Notion ${method} ${endpoint} → ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

interface ExistingPage {
  pageId: string;
  owned: Partial<Owned>;
}

function readText(prop: any): string {
  const arr = prop?.rich_text ?? prop?.title ?? [];
  return arr.map((t: any) => t.plain_text ?? "").join("");
}

// Map every existing row by its Session ID so we can diff before writing.
export async function fetchExisting(cfg: NotionConfig): Promise<Map<string, ExistingPage>> {
  const out = new Map<string, ExistingPage>();
  let cursor: string | undefined;
  do {
    const page: any = await api(cfg, "POST", `/databases/${cfg.databaseId}/query`, {
      page_size: 100,
      start_cursor: cursor,
    });
    for (const row of page.results) {
      const p = row.properties;
      const sid = readText(p["Session ID"]);
      if (sid === "") continue;
      out.set(sid, {
        pageId: row.id,
        owned: {
          name: readText(p.Name),
          provider: p.Provider?.select?.name ?? "",
          status: p.Status?.select?.name ?? "",
          project: readText(p.Project),
          path: readText(p.Path),
          branch: readText(p.Branch),
          messages: p.Messages?.number ?? 0,
          lastActivity: p["Last activity"]?.date?.start ?? "",
          active: p.Active?.checkbox ?? false,
          link: readText(p.Link),
        },
      });
    }
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return out;
}

// Notion stores dates at minute precision and returns them as "YYYY-MM-DD HH:MM:00Z"
// (space separator, seconds zeroed). Normalize both sides to minute for comparison.
function dayMinute(s: string): string {
  const m = s.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : s;
}

function ownedEquals(a: Partial<Owned>, b: Owned): boolean {
  return (
    a.name === b.name &&
    a.provider === b.provider &&
    a.status === b.status &&
    a.project === b.project &&
    (a.path ?? "") === b.path &&
    (a.branch ?? "") === b.branch &&
    (a.messages ?? 0) === b.messages &&
    dayMinute(a.lastActivity ?? "") === dayMinute(b.lastActivity) &&
    (a.active ?? false) === b.active &&
    (a.link ?? "") === b.link
  );
}

export async function createRow(cfg: NotionConfig, s: RawSession): Promise<void> {
  const o = ownedOf(s);
  await api(cfg, "POST", "/pages", {
    parent: { database_id: cfg.databaseId },
    properties: { ...ownedToProps(o), "Session ID": text(s.id) },
  });
}

export async function updateRow(cfg: NotionConfig, pageId: string, s: RawSession): Promise<void> {
  await api(cfg, "PATCH", `/pages/${pageId}`, { properties: ownedToProps(ownedOf(s)) });
}

export function needsUpdate(existing: Partial<Owned>, s: RawSession): boolean {
  return !ownedEquals(existing, ownedOf(s));
}

// Move a page to Notion's trash, freeing it from the workspace block count.
export async function archiveRow(cfg: NotionConfig, pageId: string): Promise<void> {
  await api(cfg, "PATCH", `/pages/${pageId}`, { archived: true });
}
