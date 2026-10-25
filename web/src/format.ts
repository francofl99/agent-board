export function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function duration(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!isFinite(ms) || ms < 0) return "—";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function tokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

export function usd(n: number): string {
  if (n === 0) return "—";
  if (n < 1) return `$${n.toFixed(2)}`;
  if (n < 1000) return `$${n.toFixed(n < 100 ? 1 : 0)}`;
  return `$${(n / 1000).toFixed(1)}k`;
}

export function clock(iso: string): string {
  if (iso === "") return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function shortModel(m: string): string {
  return m.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

export function projectName(p: string | null, slug: string): string {
  const base = (p ?? "").split("/").filter(Boolean).pop();
  return base ?? slug;
}

// Status colours live under their own token names (--wait/--ok/--idle/--ended), so a
// status string is never a variable name on its own.
export function statusVar(status: string, dismissed = false): string {
  if (dismissed) return "var(--ended)";
  if (status === "waiting_input") return "var(--wait)";
  if (status === "working") return "var(--ok)";
  if (status === "idle") return "var(--idle)";
  return "var(--ended)";
}

export function statusClass(status: string, dismissed = false): string {
  return dismissed ? "ended" : status;
}

export function altTarget(s: { provider: string; client: string }): string {
  if (s.provider === "codex") return s.client === "desktop" ? "codex-cli" : "codex-desktop";
  return s.client === "desktop" ? "claude-cli" : "claude-desktop";
}
