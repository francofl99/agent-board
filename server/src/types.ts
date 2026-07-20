export type Provider = "claude" | "codex" | "opencode";

// Derived from the session's last real message event + file freshness.
export type SessionStatus = "working" | "waiting_user" | "idle";

export interface RawSession {
  id: string;
  provider: Provider;
  status: SessionStatus;
  projectSlug: string;
  projectPath: string | null;
  gitBranch: string | null;
  title: string;
  preview: string;
  messageCount: number;
  lastActivity: string; // ISO
  sizeBytes: number;
  active: boolean; // derived from mtime window
  filePath: string;
}

export interface SessionState {
  id: string;
  column: string | null; // manual kanban column, null => derived bucket
  notes: string;
  archived: boolean;
  lastReadAt: string; // ISO of when the user last opened this session ("" => never)
  updatedAt: string;
}

export type Session = RawSession & { state: SessionState };

// A board column. rule=null => manual bucket (cards land by explicit drag).
// rule='active'|'inactive' => auto-fills by the session's live flag when unassigned.
export type ColumnRule = "active" | "inactive" | null;

export interface BoardColumn {
  id: string;
  label: string;
  position: number;
  rule: ColumnRule;
}
