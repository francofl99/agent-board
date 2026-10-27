import { projectName } from "./format";
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

export interface ProjectGroup {
  name: string;
  waiting: Session[];
  working: Session[];
}

export const projectOf = (s: Session) => projectName(s.projectPath, s.projectSlug);

// Projects with someone waiting lead, longest wait first; the rest follow by size.
export function groupByProject({ waiting, working }: Groups): ProjectGroup[] {
  const byName = new Map<string, ProjectGroup>();
  const at = (s: Session) => {
    const name = projectOf(s);
    if (!byName.has(name)) byName.set(name, { name, waiting: [], working: [] });
    return byName.get(name)!;
  };
  waiting.forEach((s) => at(s).waiting.push(s));
  working.forEach((s) => at(s).working.push(s));
  const oldestWait = (p: ProjectGroup) => p.waiting[0]?.lastActivity ?? "";
  return [...byName.values()].sort(
    (a, b) =>
      Number(b.waiting.length > 0) - Number(a.waiting.length > 0) ||
      oldestWait(a).localeCompare(oldestWait(b)) ||
      b.working.length - a.working.length ||
      a.name.localeCompare(b.name)
  );
}

// Same project, same hue, in every row and group head.
export function projectHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
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
