import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./config.js";

// The user's own columns live here, not in the transcripts: a refresh re-derives
// everything else from disk and must never clobber these.
export interface UserData {
  group: string;
  notes: string;
  // When you closed the book on a session. Kept as a timestamp, not a boolean, so the
  // flag clears itself: any later activity in the transcript outranks it.
  dismissedAt: string;
}

const FILE = path.join(CONFIG_DIR, "user-data.json");
const GROUPS_FILE = path.join(CONFIG_DIR, "groups.json");
const EMPTY: UserData = { group: "", notes: "", dismissedAt: "" };

export const DEFAULT_GROUPS = ["Ahora", "Esperando", "Revisar", "Archivo"];

export async function loadUserData(): Promise<Record<string, UserData>> {
  const raw = await fs.readFile(FILE, "utf8").catch(() => "");
  if (raw === "") return {};
  try {
    return JSON.parse(raw) as Record<string, UserData>;
  } catch {
    return {};
  }
}

export function userDataFor(all: Record<string, UserData>, id: string): UserData {
  return { ...EMPTY, ...(all[id] ?? {}) };
}

export async function saveUserData(id: string, patch: Partial<UserData>): Promise<UserData> {
  const all = await loadUserData();
  const next = { ...userDataFor(all, id), ...patch };
  all[id] = next;
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(all, null, 2) + "\n");
  await fs.rename(tmp, FILE); // atomic: a crash mid-write must not lose the buckets
  return next;
}

// Board columns outlive the cards in them: a column you just created has no sessions
// yet, so it has to be stored on its own.
async function storedGroups(): Promise<string[]> {
  const raw = await fs.readFile(GROUPS_FILE, "utf8").catch(() => "");
  if (raw === "") return DEFAULT_GROUPS;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((g) => typeof g === "string") : DEFAULT_GROUPS;
  } catch {
    return DEFAULT_GROUPS;
  }
}

export async function knownGroups(): Promise<string[]> {
  const all = await loadUserData();
  const used = Object.values(all).map((u) => u.group).filter((g) => g !== "");
  return [...new Set([...(await storedGroups()), ...used])];
}

export async function addGroup(name: string): Promise<string[]> {
  const next = [...new Set([...(await storedGroups()), name])];
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(GROUPS_FILE, JSON.stringify(next, null, 2) + "\n");
  return knownGroups();
}
