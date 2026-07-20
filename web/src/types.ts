export interface SessionState {
  id: string;
  column: string | null;
  notes: string;
  archived: boolean;
  lastReadAt: string;
  updatedAt: string;
}

export type Provider = "claude" | "codex" | "opencode";

export type SessionStatus = "working" | "waiting_user" | "idle";

export interface StatusMeta {
  key: SessionStatus;
  label: string;
  color: string;
}

export const STATUS: Record<SessionStatus, StatusMeta> = {
  working: { key: "working", label: "Trabajando", color: "#e0b341" },
  waiting_user: { key: "waiting_user", label: "Esperando respuesta", color: "#4f8cff" },
  idle: { key: "idle", label: "Inactiva", color: "#8b93a1" },
};

export interface ProviderMeta {
  key: Provider;
  label: string;
  color: string;
}

export const PROVIDERS: ProviderMeta[] = [
  { key: "claude", label: "Claude", color: "#d97757" },
  { key: "codex", label: "Codex", color: "#10a37f" },
  { key: "opencode", label: "OpenCode", color: "#e0b341" },
];

export function providerMeta(p: Provider): ProviderMeta {
  return PROVIDERS.find((m) => m.key === p) ?? PROVIDERS[0];
}

export interface Session {
  id: string;
  provider: Provider;
  status: SessionStatus;
  projectSlug: string;
  projectPath: string | null;
  gitBranch: string | null;
  title: string;
  preview: string;
  messageCount: number;
  lastActivity: string;
  sizeBytes: number;
  active: boolean;
  filePath: string;
  state: SessionState;
}

export type ColumnRule = "active" | "inactive" | null;

export interface BoardColumn {
  id: string;
  label: string;
  position: number;
  rule: ColumnRule;
}

// Human-readable project name: basename of cwd, fallback to the on-disk slug.
export function projectName(s: Session): string {
  if (s.projectPath) return s.projectPath.split("/").pop() || s.projectPath;
  // Fallback: slug is the cwd with "/" replaced by "-"; take the last segment.
  return s.projectSlug.split("-").filter(Boolean).pop() || s.projectSlug;
}

// Unread = the agent produced output the user hasn't opened yet. Working sessions
// (you're presumably in them) don't count. "" lastReadAt => never opened => unread.
export function isUnread(s: Session): boolean {
  if (s.status === "working") return false;
  const read = s.state.lastReadAt;
  return read === "" || s.lastActivity > read;
}

// Grouping key: the full working directory, so different folders never merge
// (e.g. ~/Projects/Picallex vs ~/Projects/Picallex/picallex).
export function projectKey(s: Session): string {
  return s.projectPath ?? s.projectSlug;
}

// Home-relative path for display, mirroring how desktop apps label projects.
export function tildePath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

// Which column a session renders in: explicit manual pin (if it still exists),
// else the first auto column whose rule matches the session's live flag, else
// the first column so nothing ever disappears.
export function columnIdOf(s: Session, columns: BoardColumn[]): string {
  const pinned = s.state.column;
  if (pinned && columns.some((c) => c.id === pinned)) return pinned;
  const rule: ColumnRule = s.active ? "active" : "inactive";
  const auto = columns.find((c) => c.rule === rule);
  return auto?.id ?? columns[0]?.id ?? "";
}
