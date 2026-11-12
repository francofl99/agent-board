export type LiveStatus = "working" | "waiting_input" | "idle" | "ended";
export type Provider = "claude" | "codex" | "opencode";
export type Client = "cli" | "desktop" | "";

export interface Session {
  id: string;
  name: string;
  processName: string;
  provider: Provider;
  client: Client;
  liveStatus: LiveStatus;
  pid: number | null;
  projectPath: string | null;
  projectSlug: string;
  gitBranch: string | null;
  model: string;
  messageCount: number;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  startedAt: string;
  lastActivity: string;
  pullRequests: string[];
  running: { id: string; name: string; kind: "agent" | "background"; startedAt: string }[];
  preview: string;
  recentMessages: { role: string; text: string }[];
  filePath: string;
  group: string;
  notes: string;
  dismissed: boolean;
  dismissedAt: string;
}

export interface FleetResponse {
  sessions: Session[];
  scannedAt: string;
  paths: { path: string; found: number }[];
  groups: string[];
  refreshMs: number;
}

export interface TimelineEvent {
  at: string;
  kind: "prompt" | "assistant" | "tool";
  text: string;
  meta: string;
}

export interface OpenOption {
  target: string;
  label: string;
  hint: string;
}

export interface DetailResponse {
  session: Session;
  timeline: TimelineEvent[];
  totalEvents: number;
  files: string[];
  prs: string[];
  openOptions: OpenOption[];
  defaultTarget: string;
}

export interface Theme {
  id: string;
  name: string;
  desc: string;
  fonts: string;
  source: "built-in" | "file";
  scheme: "dark" | "light";
  tokens: Record<string, string>;
}

export interface Settings {
  claudeProjectsDir: string;
  claudeSessionsDir: string;
  codexDir: string;
  codexIndexFile: string;
  refreshMs: number;
  fleetWindowHours: number;
  port: number;
}

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
  status: InboxStatus;
  approved: boolean;
  approvedText: string;
}

export interface InboxResponse {
  report: {
    generatedAt: string | null;
    nextRunAt: string | null;
    sourcesDown: { source: string; error: string }[];
    notes: Partial<Record<InboxSource, string>>;
  };
  items: InboxItem[];
}
