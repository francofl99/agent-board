import os from "node:os";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import type { SummaryConfig } from "./summarizer.js";
import type { Provider, RawSession, SessionStatus } from "./types.js";

const NOTION_VERSION = "2022-06-28";
const API = "https://api.notion.com/v1";
const CONFIG_PATH = path.join(os.homedir(), ".agent-board", "notion.json");

export interface NotionConfig {
  token: string;
  databaseId: string; // target DB; may be "" and auto-created on first run
  parentPageId: string; // where to create the DB when databaseId is empty ("" => auto-discover)
  intervalMs: number;
  sinceDays: number | null; // keep sessions touched within N days (null => no limit)
  onlyActive: boolean; // keep only sessions currently flagged active
  providers: Provider[] | null; // keep only these providers (null => all)
  summary: SummaryConfig | null; // AI summarizer; null => feature disabled
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

// Summarizer config from env (wins) then the file's `summary` object. Off unless a URL is set.
function parseSummary(fromFile: { summary?: Partial<SummaryConfig> }): SummaryConfig | null {
  const f = fromFile.summary ?? {};
  const url = process.env.SUMMARY_API_URL ?? f.url ?? "";
  if (url === "") return null;
  return {
    url,
    model: process.env.SUMMARY_MODEL ?? f.model ?? "",
    apiKey: process.env.SUMMARY_API_KEY ?? f.apiKey ?? "",
    timeoutMs: Number(process.env.SUMMARY_TIMEOUT_MS ?? f.timeoutMs ?? 20000),
  };
}

// Config resolution: env vars win, then ~/.agent-board/notion.json.
export function loadConfig(): NotionConfig {
  let fromFile: Partial<NotionConfig> = {};
  try {
    fromFile = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    /* no file is fine */
  }
  const token = process.env.NOTION_TOKEN ?? fromFile.token ?? "";
  const databaseId = process.env.NOTION_DATABASE_ID ?? fromFile.databaseId ?? "";
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID ?? fromFile.parentPageId ?? "";
  const intervalMs = Number(process.env.SYNC_INTERVAL_MS ?? fromFile.intervalMs ?? 30000);
  const rawSince = process.env.SYNC_SINCE_DAYS ?? fromFile.sinceDays ?? null;
  const sinceDays = rawSince === null || rawSince === "" ? null : Number(rawSince) || null;
  const onlyActive = (process.env.SYNC_ONLY_ACTIVE ?? String(fromFile.onlyActive ?? "")) === "true";
  const providers = parseProviders(process.env.SYNC_PROVIDERS ?? (fromFile as any).providers ?? null);
  const summary = parseSummary(fromFile as any);
  if (token === "") {
    throw new Error(
      "Missing Notion token. Set NOTION_TOKEN (env) or add \"token\" to " +
        "~/.agent-board/notion.json. The database is created automatically on first run."
    );
  }
  return { token, databaseId, parentPageId, intervalMs, sinceDays, onlyActive, providers, summary };
}

// Persist the auto-created databaseId back to the config file for future runs.
export function persistDatabaseId(databaseId: string): void {
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    /* file may not exist when configured purely via env */
  }
  current.databaseId = databaseId;
  writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2) + "\n");
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
// Selects keep plain names (Notion shows their color chip; the API can't rename an
// existing option, and Status may hold user-created options like Hold/Archive).
const STATUS_LABEL: Record<SessionStatus, string> = {
  working: "Trabajando",
  waiting_user: "Esperando respuesta",
  idle: "Inactiva",
};
// The Status values the sync owns. Anything else in the Status column is a
// user-created option (e.g. Hold / Archive) and is treated as a manual override.
const DERIVED_STATUSES = new Set<string>(Object.values(STATUS_LABEL));
const PROVIDER_LABEL: Record<Provider, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
};
// Page icon (card avatar) per provider.
export const PAGE_ICON: Record<Provider, string> = {
  claude: "🟠",
  codex: "🟢",
  opencode: "🟡",
};

function projectName(s: RawSession): string {
  if (s.projectPath) return s.projectPath.split("/").pop() || s.projectPath;
  return s.projectSlug.split("-").filter(Boolean).pop() || s.projectSlug;
}

// Deep link that opens the session in the provider's app.
// Claude Desktop handles `claude://resume?session=<uuid>` (optional &folder=<cwd>).
// Codex/OpenCode have no known desktop deep link yet.
function deepLink(s: RawSession): string {
  if (s.provider === "claude") {
    const folder = s.projectPath ? `&folder=${encodeURIComponent(s.projectPath)}` : "";
    return `claude://resume?session=${s.id}${folder}`;
  }
  return "";
}

// Flat snapshot of the fields the backend owns, for diffing + writing.
const DIRECTION_LABEL: Record<string, string> = {
  user: "Enviado",
  assistant: "Recibido",
};

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
  lastMessage: string;
  direction: string; // "Enviado" | "Recibido" | ""
  prUrls: string[];
  model: string;
  tokens: number;
}

export function ownedOf(s: RawSession): Owned {
  return {
    name: s.title || s.id,
    provider: PROVIDER_LABEL[s.provider],
    status: STATUS_LABEL[s.status],
    project: `📁 ${projectName(s)}`,
    path: s.projectPath ?? "",
    branch: s.gitBranch ? `🌿 ${s.gitBranch}` : "",
    messages: s.messageCount,
    lastActivity: s.lastActivity,
    active: s.active,
    link: deepLink(s),
    lastMessage: s.lastMessage ? `💬 ${s.lastMessage}` : "",
    direction: DIRECTION_LABEL[s.lastMessageRole] ?? "",
    prUrls: s.pullRequests,
    model: s.model ? `🧠 ${s.model}` : "",
    tokens: s.tokensOut,
  };
}

// "https://github.com/owner/repo/pull/123" -> "repo#123"
function prLabel(url: string): string {
  const m = url.match(/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/);
  return m ? `${m[1]}#${m[2]}` : url;
}

// Rich text with one clickable "repo#123" link per PR, separated by " · ".
function prRichText(urls: string[]): { rich_text: unknown[] } {
  if (urls.length === 0) return { rich_text: [] };
  const parts: unknown[] = [{ text: { content: "🔀 " } }];
  urls.forEach((u, i) => {
    if (i > 0) parts.push({ text: { content: " · " } });
    parts.push({ text: { content: prLabel(u), link: { url: u } } });
  });
  return { rich_text: parts };
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
    Link: { url: o.link === "" ? null : o.link },
    "Último mensaje": text(o.lastMessage),
    "Dirección": { select: o.direction === "" ? null : { name: o.direction } },
    PRs: prRichText(o.prUrls),
    Modelo: text(o.model),
    Tokens: { number: o.tokens },
  };
}

// --- HTTP ---
const MAX_RETRIES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retries 429 (rate limit) and 5xx with backoff, honoring Retry-After when present.
async function api(cfg: NotionConfig, method: string, endpoint: string, body?: unknown) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return res.json();

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) {
      const detail = await res.text();
      throw new Error(`Notion ${method} ${endpoint} → ${res.status}: ${detail.slice(0, 300)}`);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(500 * 2 ** attempt, 10_000);
    await sleep(waitMs);
  }
}

// --- Bootstrap: create the database from scratch ---

// Full schema, so a fresh install produces the same DB the sync expects.
const DB_SCHEMA = {
  Name: { title: {} },
  "Session ID": { rich_text: {} },
  Provider: {
    select: {
      options: [
        { name: "Claude", color: "orange" },
        { name: "Codex", color: "green" },
        { name: "OpenCode", color: "yellow" },
      ],
    },
  },
  Status: {
    select: {
      options: [
        { name: "Trabajando", color: "yellow" },
        { name: "Esperando respuesta", color: "blue" },
        { name: "Inactiva", color: "gray" },
      ],
    },
  },
  Grupo: {
    select: {
      options: [
        { name: "En progreso", color: "blue" },
        { name: "Revisar", color: "purple" },
        { name: "Archivada", color: "gray" },
      ],
    },
  },
  Project: { rich_text: {} },
  Path: { rich_text: {} },
  Branch: { rich_text: {} },
  Messages: { number: {} },
  "Last activity": { date: {} },
  Active: { checkbox: {} },
  Link: { url: {} },
  "Último mensaje": { rich_text: {} },
  "Dirección": {
    select: {
      options: [
        { name: "Enviado", color: "blue" },
        { name: "Recibido", color: "green" },
      ],
    },
  },
  PRs: { rich_text: {} },
  Modelo: { rich_text: {} },
  Tokens: { number: {} },
};

// First accessible page shared with the integration — used as the DB parent
// when neither databaseId nor parentPageId is configured.
export async function findAccessiblePage(cfg: NotionConfig): Promise<string | null> {
  const res: any = await api(cfg, "POST", "/search", {
    filter: { property: "object", value: "page" },
    page_size: 10,
  });
  const page = (res.results ?? []).find((r: any) => r.object === "page");
  return page?.id ?? null;
}

// Create the Agent Board database under the given parent page. Returns its id.
export async function createDatabase(cfg: NotionConfig, parentPageId: string): Promise<string> {
  const res: any = await api(cfg, "POST", "/databases", {
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "Agent Board" } }],
    icon: { type: "emoji", emoji: "🤖" },
    properties: DB_SCHEMA,
  });
  return res.id;
}

interface ExistingPage {
  pageId: string;
  owned: Partial<Owned>;
}

function readText(prop: any): string {
  const arr = prop?.rich_text ?? prop?.title ?? [];
  return arr.map((t: any) => t.plain_text ?? "").join("");
}

// Recover the PR URLs from the link hrefs of the rich-text segments.
function readPrUrls(prop: any): string[] {
  const arr = prop?.rich_text ?? [];
  return arr.map((t: any) => t.href ?? t.text?.link?.url).filter((u: unknown): u is string => !!u);
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
          link: p.Link?.url ?? "",
          lastMessage: readText(p["Último mensaje"]),
          direction: p["Dirección"]?.select?.name ?? "",
          prUrls: readPrUrls(p.PRs),
          model: readText(p.Modelo),
          tokens: p.Tokens?.number ?? 0,
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
    (a.link ?? "") === b.link &&
    (a.lastMessage ?? "") === b.lastMessage &&
    (a.direction ?? "") === b.direction &&
    (a.prUrls ?? []).join("\n") === b.prUrls.join("\n") &&
    (a.model ?? "") === b.model &&
    (a.tokens ?? 0) === b.tokens
  );
}

export async function createRow(cfg: NotionConfig, s: RawSession): Promise<string> {
  const o = ownedOf(s);
  const res: any = await api(cfg, "POST", "/pages", {
    parent: { database_id: cfg.databaseId },
    icon: { type: "emoji", emoji: PAGE_ICON[s.provider] },
    properties: { ...ownedToProps(o), "Session ID": text(s.id) },
  });
  return res.id;
}

export async function updateRow(
  cfg: NotionConfig,
  pageId: string,
  owned: Owned,
  iconEmoji: string
): Promise<void> {
  await api(cfg, "PATCH", `/pages/${pageId}`, {
    icon: { type: "emoji", emoji: iconEmoji },
    properties: ownedToProps(owned),
  });
}

// Reconcile a live session against its existing row.
//
// Derived Status values (Trabajando/Esperando/Inactiva) always follow reality, so the
// working ↔ waiting toggle is never masked. A user-created Status (Hold, Archive, …)
// is a manual override: it's preserved until the session has new activity, then it
// re-derives. "New activity" is measured by message count — an exact integer, immune
// to the minute-granularity race that could otherwise freeze a same-minute transition.
export function reconcile(existing: Partial<Owned>, s: RawSession): { changed: boolean; owned: Owned } {
  const owned = ownedOf(s);
  const isOverride = existing.status !== undefined && !DERIVED_STATUSES.has(existing.status);
  const activityChanged = existing.messages !== owned.messages;
  if (isOverride && !activityChanged) owned.status = existing.status as string;
  return { changed: !ownedEquals(existing, owned), owned };
}

// Post a comment on a page. Requires the integration to have "Insert comments"
// capability; throws on 403 if it doesn't (caller decides how to handle).
export async function postComment(cfg: NotionConfig, pageId: string, body: string): Promise<void> {
  await api(cfg, "POST", "/comments", {
    parent: { page_id: pageId },
    rich_text: [{ text: { content: body.slice(0, 2000) } }],
  });
}

// Move a page to Notion's trash, freeing it from the workspace block count.
export async function archiveRow(cfg: NotionConfig, pageId: string): Promise<void> {
  await api(cfg, "PATCH", `/pages/${pageId}`, { archived: true });
}
