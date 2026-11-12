import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./config.js";

// Written only by the board. The inbox-triage routine reads it and answers through inbox.json,
// with an item whose id is `note:<id>`.
const NOTES_FILE = path.join(CONFIG_DIR, "notes.json");

export type NoteSource = "pr" | "jira" | "slack" | "mail" | "note";
export type NoteStatus = "open" | "done" | "dismissed";

export interface Note {
  id: string;
  text: string;
  url: string;
  source: NoteSource;
  ref: string;
  createdAt: string;
  // Empty means "on the next run".
  remindAt: string;
  status: NoteStatus;
  closedAt: string;
}

const SLACK = /https?:\/\/[\w-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p\d+/i;
const PR = /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/i;
const JIRA_URL = /https?:\/\/[\w-]+\.atlassian\.net\/browse\/([A-Z][A-Z0-9]+-\d+)/;
const JIRA_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;
const GMAIL = /https?:\/\/mail\.google\.com\//i;

export function detectSource(url: string, text: string): { source: NoteSource; ref: string } {
  let m = url.match(SLACK);
  if (m) return { source: "slack", ref: "hilo" };
  m = url.match(PR);
  if (m) return { source: "pr", ref: `${m[1].split("/")[1]}#${m[2]}` };
  m = url.match(JIRA_URL) ?? text.match(JIRA_KEY);
  if (m) return { source: "jira", ref: m[1] };
  if (GMAIL.test(url)) return { source: "mail", ref: "Gmail" };
  return { source: "note", ref: "" };
}

export async function loadNotes(): Promise<Note[]> {
  const raw = await fs.readFile(NOTES_FILE, "utf8").catch(() => "");
  if (raw === "") return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as Note[]) : [];
  } catch {
    return [];
  }
}

async function saveNotes(notes: Note[]): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const tmp = NOTES_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(notes, null, 2) + "\n");
  await fs.rename(tmp, NOTES_FILE);
}

const URL_IN_TEXT = /https?:\/\/\S+/;

export async function addNote(input: { text?: unknown; url?: unknown; remindAt?: unknown }): Promise<Note | null> {
  let text = typeof input.text === "string" ? input.text.trim() : "";
  let url = typeof input.url === "string" ? input.url.trim() : "";
  if (url === "") {
    const found = text.match(URL_IN_TEXT);
    if (found) {
      url = found[0];
      text = text.replace(found[0], "").trim();
    }
  }
  if (text === "" && url === "") return null;
  const remindAt = typeof input.remindAt === "string" && !Number.isNaN(Date.parse(input.remindAt)) ? input.remindAt : "";
  const note: Note = {
    id: randomUUID().slice(0, 8),
    text,
    url,
    ...detectSource(url, text),
    createdAt: new Date().toISOString(),
    remindAt,
    status: "open",
    closedAt: "",
  };
  const notes = await loadNotes();
  notes.push(note);
  await saveNotes(notes);
  return note;
}

export async function updateNote(
  id: string,
  patch: { status?: NoteStatus; remindAt?: string }
): Promise<Note | null> {
  const notes = await loadNotes();
  const note = notes.find((n) => n.id === id);
  if (note === undefined) return null;
  if (patch.status !== undefined) {
    note.status = patch.status;
    note.closedAt = patch.status === "open" ? "" : new Date().toISOString();
  }
  if (patch.remindAt !== undefined) note.remindAt = patch.remindAt;
  await saveNotes(notes);
  return note;
}
