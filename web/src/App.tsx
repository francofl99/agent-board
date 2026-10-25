import { useCallback, useEffect, useState } from "react";
import { getFleet, saveUser } from "./api";
import { List } from "./List";
import { Settings } from "./Settings";
import { useTheme } from "./useTheme";
import type { FleetResponse, Session } from "./types";

export function App() {
  const [data, setData] = useState<FleetResponse | null>(null);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(false);
  const { themes, themesDir, themeId, setThemeId } = useTheme();

  useEffect(() => {
    let stop = false;
    let timer: number;
    const tick = async () => {
      let next = 5000;
      try {
        const d = await getFleet();
        if (!stop) {
          setData(d);
          setError("");
        }
        next = d.refreshMs;
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
      if (!stop) timer = window.setTimeout(tick, next);
    };
    tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, []);

  const patch = useCallback((id: string, p: Partial<Session>) => {
    setData((d) => (d === null ? d : { ...d, sessions: d.sessions.map((s) => (s.id === id ? { ...s, ...p } : s)) }));
  }, []);

  // Optimistic: the row must move on the keypress, not on the next poll.
  const dismiss = useCallback(
    (s: Session, dismissed: boolean) => {
      patch(s.id, { dismissed, dismissedAt: dismissed ? s.lastActivity : "" });
      saveUser(s.id, { dismissed }).catch(() => patch(s.id, { dismissed: !dismissed }));
    },
    [patch]
  );

  useEffect(() => {
    if (!settings) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSettings(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings]);

  if (settings) {
    return (
      <div className="app">
        <div className="sethead">
          <button onClick={() => setSettings(false)}>
            ← Lista <kbd>Esc</kbd>
          </button>
          <b>Ajustes</b>
        </div>
        <Settings themes={themes} themesDir={themesDir} themeId={themeId} onPickTheme={setThemeId} fleet={data} />
      </div>
    );
  }

  return <List data={data} error={error} onDismiss={dismiss} onSettings={() => setSettings(true)} />;
}
