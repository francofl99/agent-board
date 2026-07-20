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
  lastMessage: string; // text of the last message that had content
  lastMessageRole: "user" | "assistant" | ""; // who sent that last message
  messageCount: number;
  lastActivity: string; // ISO
  sizeBytes: number;
  active: boolean; // derived from mtime window
  filePath: string;
}
