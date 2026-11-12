import type { DetailResponse, FleetResponse, InboxResponse, InboxStatus, SentReply, Settings, Theme } from "./types";

// The desktop shell serves the bundled page from its own origin, so it has to name
// the local API explicitly; the browser build is served by the API itself.
const BASE = "__TAURI__" in window ? "http://127.0.0.1:4319" : "";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

export const getFleet = () => req<FleetResponse>("/api/fleet");
export const getThemes = () => req<{ themes: Theme[]; dir: string; selected: string }>("/api/themes");
export const saveTheme = (theme: string) =>
  req<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify({ theme }) });
export const getSettings = () => req<Settings>("/api/settings");

export const getDetail = (id: string) => req<DetailResponse>(`/api/sessions/${encodeURIComponent(id)}`);


export const saveUser = (id: string, patch: { group?: string; notes?: string; dismissed?: boolean }) =>
  req<{ group: string; notes: string; dismissedAt: string }>(`/api/sessions/${encodeURIComponent(id)}/user`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const getInbox = () => req<InboxResponse>("/api/inbox");
export const saveDecision = (id: string, patch: { status?: InboxStatus; approve?: boolean; text?: string }) =>
  req<unknown>(`/api/inbox/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });

export const addNote = (note: { text: string; url: string; remindAt: string }) =>
  req<unknown>("/api/notes", { method: "POST", body: JSON.stringify(note) });

export const getSlack = () => req<{ configured: boolean }>("/api/slack");
export const sendReply = (id: string, text: string) =>
  req<SentReply>(`/api/inbox/${encodeURIComponent(id)}/send`, { method: "POST", body: JSON.stringify({ text }) });
