import type { DetailResponse, FleetResponse, PrStatus, Settings, Theme } from "./types";

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
export const getThemes = () => req<{ themes: Theme[]; dir: string }>("/api/themes");
export const getSettings = () => req<Settings>("/api/settings");

export const addGroup = (name: string) =>
  req<{ groups: string[] }>("/api/groups", { method: "POST", body: JSON.stringify({ name }) });
export const getDetail = (id: string) => req<DetailResponse>(`/api/sessions/${encodeURIComponent(id)}`);

export const openSession = (id: string, target: string) =>
  req<{ ok: boolean; ran?: string; error?: string }>(`/api/sessions/${encodeURIComponent(id)}/open`, {
    method: "POST",
    body: JSON.stringify({ target }),
  });

export const getSessionPrs = (id: string) =>
  req<{ prs: PrStatus[] }>(`/api/sessions/${encodeURIComponent(id)}/prs`);

export const revealSession = (id: string) =>
  req<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(id)}/reveal`, { method: "POST" });

export const saveUser = (id: string, patch: { group?: string; notes?: string; dismissed?: boolean }) =>
  req<{ group: string; notes: string; dismissedAt: string }>(`/api/sessions/${encodeURIComponent(id)}/user`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
