import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import type { BoardColumn, ColumnRule, SessionState } from "./types.js";

const DATA_DIR = path.join(os.homedir(), ".agent-board");
const DB_PATH = path.join(DATA_DIR, "state.db");

let db: Database.Database;

export async function initStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_state (
      id         TEXT PRIMARY KEY,
      col        TEXT,
      notes      TEXT NOT NULL DEFAULT '',
      archived   INTEGER NOT NULL DEFAULT 0,
      read_at    TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
  `);
  // Add read_at to databases created before this column existed.
  const cols = db.prepare("PRAGMA table_info(session_state)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "read_at")) {
    db.exec("ALTER TABLE session_state ADD COLUMN read_at TEXT NOT NULL DEFAULT ''");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS board_column (
      id       TEXT PRIMARY KEY,
      label    TEXT NOT NULL,
      position INTEGER NOT NULL,
      rule     TEXT
    );
  `);
  seedColumns();
}

const DEFAULT_COLUMNS: { label: string; rule: ColumnRule }[] = [
  { label: "Activa ahora", rule: "active" },
  { label: "Inactiva", rule: "inactive" },
  { label: "En progreso", rule: null },
  { label: "Revisar", rule: null },
  { label: "Archivada", rule: null },
];

function seedColumns(): void {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM board_column").get() as { n: number }).n;
  if (count > 0) return;
  const insert = db.prepare(
    "INSERT INTO board_column (id, label, position, rule) VALUES (?, ?, ?, ?)"
  );
  DEFAULT_COLUMNS.forEach((c, i) => insert.run(randomUUID(), c.label, i, c.rule));
}

function rowToColumn(r: any): BoardColumn {
  return { id: r.id, label: r.label, position: r.position, rule: (r.rule ?? null) as ColumnRule };
}

export function getColumns(): BoardColumn[] {
  return (db.prepare("SELECT * FROM board_column ORDER BY position").all() as any[]).map(
    rowToColumn
  );
}

export function createColumn(label: string): BoardColumn {
  const max = (db.prepare("SELECT MAX(position) AS m FROM board_column").get() as { m: number | null })
    .m;
  const col: BoardColumn = { id: randomUUID(), label, position: (max ?? -1) + 1, rule: null };
  db.prepare("INSERT INTO board_column (id, label, position, rule) VALUES (?, ?, ?, ?)").run(
    col.id,
    col.label,
    col.position,
    col.rule
  );
  return col;
}

export function renameColumn(id: string, label: string): void {
  db.prepare("UPDATE board_column SET label = ? WHERE id = ?").run(label, id);
}

export function deleteColumn(id: string): void {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM board_column WHERE id = ?").run(id);
    // Cards pinned to the removed column fall back to their auto bucket.
    db.prepare("UPDATE session_state SET col = NULL WHERE col = ?").run(id);
  });
  tx();
}

export function reorderColumns(orderedIds: string[]): void {
  const tx = db.transaction(() => {
    const upd = db.prepare("UPDATE board_column SET position = ? WHERE id = ?");
    orderedIds.forEach((id, i) => upd.run(i, id));
  });
  tx();
}

function rowToState(r: any): SessionState {
  return {
    id: r.id,
    column: r.col ?? null,
    notes: r.notes ?? "",
    archived: r.archived === 1,
    lastReadAt: r.read_at ?? "",
    updatedAt: r.updated_at,
  };
}

export function getAllStates(): Map<string, SessionState> {
  const rows = db.prepare("SELECT * FROM session_state").all();
  const m = new Map<string, SessionState>();
  for (const r of rows) m.set((r as any).id, rowToState(r));
  return m;
}

export function defaultState(id: string): SessionState {
  return { id, column: null, notes: "", archived: false, lastReadAt: "", updatedAt: "" };
}

export interface StatePatch {
  column?: string | null;
  notes?: string;
  archived?: boolean;
  lastReadAt?: string;
}

export function upsertState(id: string, patch: StatePatch): SessionState {
  const existing =
    (db.prepare("SELECT * FROM session_state WHERE id = ?").get(id) as any) ?? null;
  const merged: SessionState = existing
    ? rowToState(existing)
    : defaultState(id);
  if ("column" in patch) merged.column = patch.column ?? null;
  if ("notes" in patch) merged.notes = patch.notes ?? "";
  if ("archived" in patch) merged.archived = Boolean(patch.archived);
  if ("lastReadAt" in patch) merged.lastReadAt = patch.lastReadAt ?? "";
  merged.updatedAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO session_state (id, col, notes, archived, read_at, updated_at)
     VALUES (@id, @col, @notes, @archived, @read_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       col = @col, notes = @notes, archived = @archived, read_at = @read_at, updated_at = @updated_at`
  ).run({
    id: merged.id,
    col: merged.column,
    notes: merged.notes,
    archived: merged.archived ? 1 : 0,
    read_at: merged.lastReadAt,
    updated_at: merged.updatedAt,
  });
  return merged;
}
