import type { BoardColumn, Session, SessionState } from "./types";

export async function fetchSessions(): Promise<Session[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error(`GET /api/sessions ${res.status}`);
  return res.json();
}

export async function patchState(
  id: string,
  patch: Partial<Pick<SessionState, "column" | "notes" | "archived" | "lastReadAt">>
): Promise<SessionState> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/state`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PATCH state ${res.status}`);
  return res.json();
}

export async function fetchColumns(): Promise<BoardColumn[]> {
  const res = await fetch("/api/columns");
  if (!res.ok) throw new Error(`GET /api/columns ${res.status}`);
  return res.json();
}

export async function createColumn(label: string): Promise<BoardColumn> {
  const res = await fetch("/api/columns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error(`POST column ${res.status}`);
  return res.json();
}

export async function renameColumn(id: string, label: string): Promise<void> {
  const res = await fetch(`/api/columns/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error(`PATCH column ${res.status}`);
}

export async function deleteColumn(id: string): Promise<void> {
  const res = await fetch(`/api/columns/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE column ${res.status}`);
}

export async function reorderColumns(ids: string[]): Promise<void> {
  const res = await fetch("/api/columns/order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`PUT column order ${res.status}`);
}

// SSE stream: calls onChange on any session/state/columns event.
export function subscribe(onChange: () => void): () => void {
  const es = new EventSource("/api/events");
  es.addEventListener("sessions", onChange);
  es.addEventListener("state", onChange);
  es.addEventListener("columns", onChange);
  return () => es.close();
}
