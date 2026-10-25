interface TauriGlobal {
  core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  event: { listen: (name: string, cb: (e: { payload: unknown }) => void) => Promise<() => void> };
}

// Present only inside the desktop shell; the browser build runs without it.
export const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;

export interface EdgeState {
  edge: "left" | "right" | "notch";
  full: boolean;
  notchWidth: number;
}
