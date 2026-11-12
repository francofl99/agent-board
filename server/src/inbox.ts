import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./config.js";
import { loadNotes, type Note, updateNote } from "./notes.js";

// The inbox-triage routine writes the report; the board only ever writes decisions.
// Two files with one owner each, so a routine run and a click never race on the same file.
const REPORT_FILE = path.join(CONFIG_DIR, "inbox.json");
const DECISIONS_FILE = path.join(CONFIG_DIR, "inbox-decisions.json");

export type InboxSource = "pr" | "jira" | "slack" | "mail" | "alert" | "note";
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
  // Set by the routine on a note's item when the source shows it was handled.
  resolved?: boolean;
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
  pinned: boolean;
  remindAt: string;
  noteText: string;
}

const NOTE_PREFIX = "note:";

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

function approvalOf(item: InboxItem, d: Decision | undefined) {
  const approved =
    d !== undefined &&
    d.fingerprint === item.fingerprint &&
    item.action !== null &&
    d.approvedFor === item.action.hash &&
    item.executed === null;
  return { approved, approvedText: approved ? d.approvedText : "" };
}

const NOTE_STATUS: Record<Note["status"], InboxStatus> = { open: "pending", done: "done", dismissed: "dismissed" };

// Until the routine picks a note up, the board shows it as you wrote it; once it does, its
// item in inbox.json replaces that, so the summary and the proposed reply show up too.
function noteView(note: Note, label: string, enriched: InboxItem | undefined, d: Decision | undefined): InboxView {
  const base: InboxItem = enriched ?? {
    id: NOTE_PREFIX + note.id,
    label,
    source: note.source,
    priority: "orange",
    now: false,
    title: note.text !== "" ? note.text : note.url,
    hint: note.url !== "" ? note.url : "Nota propia",
    where: note.ref,
    who: "",
    since: note.createdAt,
    url: note.url,
    fingerprint: note.createdAt,
    summary: "",
    suggestion: "",
    findings: [],
    action: null,
    executed: null,
  };
  const status = note.status === "open" && enriched?.resolved === true ? "done" : NOTE_STATUS[note.status];
  return { ...base, ...approvalOf(base, d), status, pinned: true, remindAt: note.remindAt, noteText: note.text };
}

function closedToday(note: Note): boolean {
  return note.status === "open" || new Date(note.closedAt).toDateString() === new Date().toDateString();
}

export async function inboxView(): Promise<{ report: Omit<InboxReport, "items">; items: InboxView[] }> {
  const [{ items, ...report }, decisions, notes] = await Promise.all([loadReport(), loadDecisions(), loadNotes()]);
  const now = Date.now();
  const enriched = new Map(items.filter((i) => i.id.startsWith(NOTE_PREFIX)).map((i) => [i.id, i]));
  const pinned = notes
    .filter(closedToday)
    .map((note, n) =>
      noteView(note, `N${n + 1}`, enriched.get(NOTE_PREFIX + note.id), decisions[NOTE_PREFIX + note.id])
    );
  const regular = items
    .filter((i) => !i.id.startsWith(NOTE_PREFIX))
    .map((item) => {
      const d = decisions[item.id];
      return {
        ...item,
        ...approvalOf(item, d),
        status: statusOf(item, d, now),
        pinned: false,
        remindAt: "",
        noteText: "",
      };
    });
  return { report, items: [...pinned, ...regular] };
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

const NOTE_PATCH: Record<InboxStatus, "open" | "done" | "dismissed"> = {
  pending: "open",
  done: "done",
  dismissed: "dismissed",
  snoozed: "open",
};

export async function saveDecision(id: string, patch: DecisionPatch): Promise<unknown> {
  if (id.startsWith(NOTE_PREFIX) && patch.status !== undefined) {
    return updateNote(id.slice(NOTE_PREFIX.length), {
      status: NOTE_PATCH[patch.status],
      ...(patch.status === "snoozed" ? { remindAt: tomorrowMorning() } : {}),
    });
  }
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
