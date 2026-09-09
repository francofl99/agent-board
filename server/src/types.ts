export type Provider = "claude" | "codex" | "opencode";

// Which app the session was started from. Orthogonal to the provider: a Claude
// session may live in the terminal or in the desktop app.
export type Client = "cli" | "desktop" | "";

// Derived from the session's last real message event + file freshness.
export type SessionStatus = "working" | "waiting_user" | "idle";

export interface RawSession {
  id: string;
  provider: Provider;
  client: Client;
  status: SessionStatus;
  projectSlug: string;
  projectPath: string | null;
  gitBranch: string | null;
  title: string;
  preview: string;
  lastMessage: string; // text of the last message that had content
  lastMessageRole: "user" | "assistant" | ""; // who sent that last message
  pullRequests: string[]; // GitHub PR URLs found in the transcript
  // Work the main agent handed off and has not got back yet: sub-agents still
  // running and background shell tasks still running. Finished ones are dropped.
  running: { id: string; name: string; kind: "agent" | "background"; startedAt: string }[];
  model: string; // last model used in the session
  tokensOut: number; // output tokens generated across the session
  tokensIn: number; // fresh input tokens (cache reads/writes counted apart)
  cacheReadTokens: number;
  cacheWriteTokens: number;
  startedAt: string; // ISO of the first timestamped event
  recentMessages: { role: string; text: string }[]; // last few text messages, for summarization
  scheduledTask: string; // routine name if this is a scheduled-task run, else ""
  syncKey: string; // Notion dedup key: session id, or routine:<name> for routines
  messageCount: number;
  lastActivity: string; // ISO
  sizeBytes: number;
  active: boolean; // derived from mtime window
  filePath: string;
}

// A session as the Fleet view sees it: parsed transcript + the live process
// registry + whatever the user wrote about it.
export interface FleetSession extends RawSession {
  name: string; // what the session is called: its own title unless you renamed it
  processName: string; // handle the CLI derived for the live process ("tiledesk-d1")
  pid: number | null; // set while the process is alive
  liveStatus: "working" | "waiting_input" | "idle" | "ended";
  costUsd: number;
  group: string; // user's own bucket, never touched by the refresh
  notes: string;
  dismissed: boolean; // you closed it while it was waiting; cleared by new activity
  dismissedAt: string;
}
