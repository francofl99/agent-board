import { useCallback, useEffect, useState } from "react";
import { getFleet, getInbox, saveDecision, saveUser } from "./api";
import { type Decide, Inbox } from "./Inbox";
import { List } from "./List";
import { groupByStatus } from "./sessions";
import { Settings } from "./Settings";
import { useTheme } from "./useTheme";
import type { InboxItem, InboxResponse, Session } from "./types";

type View = "sessions" | "inbox" | "split";
type Pane = "sessions" | "inbox";
const VIEW_KEY = "agent-board.view";

function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "inbox" || v === "split" ? v : "sessions";
  } catch {
    return "sessions";
  }
}

function usePoll<T>(load: () => Promise<T>, every: (d: T) => number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stop = false;
    let timer: number;
    const tick = async () => {
      let next = 5000;
      try {
        const d = await load();
        if (!stop) {
          setData(d);
          setError("");
        }
        next = every(d);
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
  return { data, setData, error };
}

interface TabsProps {
  view: View;
  onView: (v: View) => void;
  waiting: number;
  inbox: number;
}

function Tabs({ view, onView, waiting, inbox }: TabsProps) {
  return (
    <nav className="tabs" aria-label="Vistas">
      <button aria-current={view === "sessions" ? "page" : undefined} onClick={() => onView("sessions")}>
        Sesiones <span className="n">{waiting}</span>
      </button>
      <button aria-current={view === "inbox" ? "page" : undefined} onClick={() => onView("inbox")}>
        Bandeja <span className="n">{inbox}</span>
      </button>
      <button
        className="split-btn"
        aria-current={view === "split" ? "page" : undefined}
        onClick={() => onView("split")}
        title="Pantalla dividida (v)"
        aria-label="Pantalla dividida"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4.5" width="18" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 4.5v15" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
    </nav>
  );
}

export function App() {
  const fleet = usePoll(getFleet, (d) => d.refreshMs);
  const inbox = usePoll<InboxResponse>(getInbox, () => 10_000);
  const [settings, setSettings] = useState(false);
  const [view, setViewState] = useState<View>(readView);
  const [pane, setPane] = useState<Pane>("inbox");
  const { themes, themesDir, themeId, setThemeId } = useTheme();

  const setView = useCallback((v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private windows may refuse storage; the tab still switches for this visit.
    }
  }, []);

  const patch = useCallback((id: string, p: Partial<Session>) => {
    fleet.setData((d) =>
      d === null ? d : { ...d, sessions: d.sessions.map((s) => (s.id === id ? { ...s, ...p } : s)) }
    );
  }, []);

  // Optimistic: the row must move on the keypress, not on the next poll.
  const dismiss = useCallback(
    (s: Session, dismissed: boolean) => {
      patch(s.id, { dismissed, dismissedAt: dismissed ? s.lastActivity : "" });
      saveUser(s.id, { dismissed }).catch(() => patch(s.id, { dismissed: !dismissed }));
    },
    [patch]
  );

  const decide = useCallback((item: InboxItem, p: Decide) => {
    const apply = (changes: Partial<InboxItem>) =>
      inbox.setData((d) =>
        d === null ? d : { ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, ...changes } : i)) }
      );
    apply({
      ...(p.status !== undefined ? { status: p.status } : {}),
      ...(p.approve !== undefined ? { approved: p.approve, approvedText: p.approve ? p.text ?? "" : "" } : {}),
    });
    saveDecision(item.id, p).catch(() =>
      apply({ status: item.status, approved: item.approved, approvedText: item.approvedText })
    );
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settings) {
        if (e.key === "Escape") setSettings(false);
        return;
      }
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "t") {
        if (view === "split") setPane(pane === "inbox" ? "sessions" : "inbox");
        else setView(view === "inbox" ? "sessions" : "inbox");
      } else if (e.key === "v") setView(view === "split" ? pane : "split");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings, view, pane, setView]);

  if (settings) {
    return (
      <div className="app">
        <div className="sethead">
          <button onClick={() => setSettings(false)}>
            ← Lista <kbd>Esc</kbd>
          </button>
          <b>Ajustes</b>
        </div>
        <Settings
          themes={themes}
          themesDir={themesDir}
          themeId={themeId}
          onPickTheme={setThemeId}
          fleet={fleet.data}
        />
      </div>
    );
  }

  const waiting = groupByStatus(fleet.data?.sessions ?? []).waiting.length;
  const pending = (inbox.data?.items ?? []).filter((i) => i.status === "pending" && i.executed === null).length;
  const tabs = <Tabs view={view} onView={setView} waiting={waiting} inbox={pending} />;

  const openSettings = () => setSettings(true);

  if (view === "split") {
    return (
      <div className="splitapp">
        <div className="lhead apphead">
          <b className="lbrand">Agent Board</b>
          {tabs}
          <span className="grow" />
          <span className="lmuted mono">
            <b>t</b> cambia de panel · <b>v</b> vuelve a una sola
          </span>
        </div>
        <div className="split">
          <div className={`pane${pane === "sessions" ? " active" : ""}`} onMouseDown={() => setPane("sessions")}>
            <List
              data={fleet.data}
              error={fleet.error}
              onDismiss={dismiss}
              onSettings={openSettings}
              active={pane === "sessions"}
              brand={false}
            />
          </div>
          <div className={`pane${pane === "inbox" ? " active" : ""}`} onMouseDown={() => setPane("inbox")}>
            <Inbox
              data={inbox.data}
              error={inbox.error}
              onDecide={decide}
              onSettings={openSettings}
              active={pane === "inbox"}
              brand={false}
            />
          </div>
        </div>
      </div>
    );
  }

  return view === "inbox" ? (
    <Inbox data={inbox.data} error={inbox.error} tabs={tabs} onDecide={decide} onSettings={() => setSettings(true)} />
  ) : (
    <List
      data={fleet.data}
      error={fleet.error}
      onDismiss={dismiss}
      onSettings={() => setSettings(true)}
      tabs={tabs}
    />
  );
}
