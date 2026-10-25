import type { Session } from "./types";

export const isLive = (s: Session) =>
  !s.dismissed && (s.liveStatus === "waiting_input" || s.liveStatus === "working");

export const firstLine = (t: string) => t.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";

export function lastAgentText(s: Session): string {
  const m = [...s.recentMessages].reverse().find((r) => r.role === "assistant");
  return m?.text ?? s.preview;
}

export function runningSummary(s: Session): string {
  const agents = s.running.filter((r) => r.kind === "agent").length;
  const background = s.running.length - agents;
  return [
    agents > 0 ? `${agents} sub-agente${agents > 1 ? "s" : ""}` : "",
    background > 0 ? `${background} en segundo plano` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export interface Groups {
  waiting: Session[];
  working: Session[];
}

// The longest wait leads, since it is the one most likely forgotten; working sessions
// keep the scan's order. Idle, ended and closed sessions are left out.
export function groupByStatus(list: Session[]): Groups {
  const waiting = list
    .filter((s) => isLive(s) && s.liveStatus === "waiting_input")
    .sort((a, b) => a.lastActivity.localeCompare(b.lastActivity));
  const working = list.filter((s) => isLive(s) && s.liveStatus === "working");
  return { waiting, working };
}

// Previews are one line of prose, not a rendered document: strip the markdown the agent
// wrote for a chat window.
export function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[\s>#*-]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
