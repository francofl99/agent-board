import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./config.js";

// The inbox-triage routine writes the report; the board only ever writes decisions.
// Two files with one owner each, so a routine run and a click never race on the same file.
const REPORT_FILE = path.join(CONFIG_DIR, "inbox.json");
const DECISIONS_FILE = path.join(CONFIG_DIR, "inbox-decisions.json");

export type InboxSource = "pr" | "jira" | "slack" | "mail" | "alert";
export type InboxPriority = "red" | "orange" | "green" | "info";
export type InboxStatus = "pending" | "done" | "dismissed" | "snoozed";

export interface InboxAction {
  kind: string;
  label: string;
  target: string;
  text: string;
  hash: string;
}

export interface InboxItem {
  id: string;
  label: string;
  source: InboxSource;
  priority: InboxPriority;
  now: boolean;
  title: string;
  hint: string;
  where: string;
  who: string;
  since: string;
  url: string;
  fingerprint: string;
  summary: string;
  suggestion: string;
  findings: { severity: string; location: string; text: string }[];
  action: InboxAction | null;
  executed: { at: string; result: string } | null;
}

export interface InboxReport {
  generatedAt: string | null;
  nextRunAt: string | null;
  sourcesDown: { source: string; error: string }[];
  notes: Partial<Record<InboxSource, string>>;
  items: InboxItem[];
}

export interface Decision {
  status: InboxStatus;
  fingerprint: string;
  at: string;
  snoozeUntil: string;
  // The proposal this approval answers: a regenerated proposal must not inherit it.
  approvedFor: string;
  approvedText: string;
}

export interface InboxView extends InboxItem {
  status: InboxStatus;
  approved: boolean;
  approvedText: string;
}

const EMPTY_REPORT: InboxReport = { generatedAt: null, nextRunAt: null, sourcesDown: [], notes: {}, items: [] };

async function readJson<T>(file: string, fallback: T): Promise<T> {
  const raw = await fs.readFile(file, "utf8").catch(() => "");
  if (raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function loadReport(): Promise<InboxReport> {
  const r = await readJson<Partial<InboxReport>>(REPORT_FILE, {});
  return { ...EMPTY_REPORT, ...r, items: Array.isArray(r.items) ? r.items : [] };
}

export const loadDecisions = () => readJson<Record<string, Decision>>(DECISIONS_FILE, {});

// A decision holds only while the item is the one it was taken on: new commits or a new
// reply change the fingerprint and bring the item back.
function statusOf(item: InboxItem, d: Decision | undefined, now: number): InboxStatus {
  if (d === undefined || d.fingerprint !== item.fingerprint) return "pending";
  if (d.status === "snoozed" && Date.parse(d.snoozeUntil) <= now) return "pending";
  return d.status;
}

export async function inboxView(): Promise<{ report: Omit<InboxReport, "items">; items: InboxView[] }> {
  const [{ items, ...report }, decisions] = await Promise.all([loadReport(), loadDecisions()]);
  const now = Date.now();
  return {
    report,
    items: items.map((item) => {
      const d = decisions[item.id];
      const current = d !== undefined && d.fingerprint === item.fingerprint;
      const approved = current && item.action !== null && d.approvedFor === item.action.hash && item.executed === null;
      return {
        ...item,
        status: statusOf(item, d, now),
        approved,
        approvedText: approved ? d.approvedText : "",
      };
    }),
  };
}

function tomorrowMorning(): string {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  t.setHours(9, 0, 0, 0);
  return t.toISOString();
}

export interface DecisionPatch {
  status?: InboxStatus;
  approve?: boolean;
  text?: string;
}

export async function saveDecision(id: string, patch: DecisionPatch): Promise<Decision | null> {
  const item = (await loadReport()).items.find((i) => i.id === id);
  if (item === undefined) return null;
  const all = await loadDecisions();
  const prev = all[id];
  const base: Decision =
    prev !== undefined && prev.fingerprint === item.fingerprint
      ? prev
      : { status: "pending", fingerprint: item.fingerprint, at: "", snoozeUntil: "", approvedFor: "", approvedText: "" };
  const next: Decision = { ...base, at: new Date().toISOString() };
  if (patch.status !== undefined) {
    next.status = patch.status;
    next.snoozeUntil = patch.status === "snoozed" ? tomorrowMorning() : "";
  }
  if (patch.approve !== undefined && item.action !== null) {
    next.approvedFor = patch.approve ? item.action.hash : "";
    next.approvedText = patch.approve ? (patch.text ?? item.action.text) : "";
  }
  all[id] = next;
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const tmp = DECISIONS_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(all, null, 2) + "\n");
  await fs.rename(tmp, DECISIONS_FILE);
  return next;
}
