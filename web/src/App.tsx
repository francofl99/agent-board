import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addGroup, getFleet, openSession, saveUser } from "./api";
import { usePersisted } from "./persist";
import { Board } from "./Board";
import { Graph } from "./Graph";
import { Settings } from "./Settings";
import { useTheme } from "./useTheme";
import { Detail } from "./Detail";
import { Empty, Fleet, NoMatch, groupSessions } from "./Fleet";
import { ago, altTarget } from "./format";
import { Wall, wallOrder } from "./Wall";
import type { FleetResponse, Session } from "./types";

type GroupBy = "project" | "provider" | "status";
const GROUP_CYCLE: GroupBy[] = ["project", "provider", "status"];

type View = "fleet" | "wall" | "board" | "graph" | "settings";

type StatusFilter = "waiting_input" | "working";
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "waiting_input", label: "Esperando respuesta" },
  { key: "working", label: "En curso" },
];

export function App() {
  const [data, setData] = useState<FleetResponse | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [groupBy, setGroupBy] = usePersisted<GroupBy>("groupBy", "project");
  const [filter, setFilter] = usePersisted("filter", "");
  const [statuses, setStatuses] = usePersisted<StatusFilter[]>("statuses", []); // empty = todas
  const [view, setView] = usePersisted<View>("view", "fleet");
  const { themes, themesDir, themeId, setThemeId } = useTheme();
  const [selected, setSelected] = useState<string | null>(null);
  const [wallFocus, setWallFocus] = usePersisted<string | null>("wallFocus", null);
  const [menuOpen, setMenuOpen] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let stop = false;
    let timer: number;
    const tick = async () => {
      try {
        const d = await getFleet();
        if (!stop) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
      if (!stop) timer = window.setTimeout(tick, data?.refreshMs ?? 5000);
    };
    tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, []);

  const sessions = data?.sessions ?? [];
  const counts = useMemo(
    () => ({
      waiting_input: sessions.filter((s) => s.liveStatus === "waiting_input" && !s.dismissed).length,
      working: sessions.filter((s) => s.liveStatus === "working" && !s.dismissed).length,
    }),
    [sessions]
  );

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return sessions.filter((s) => {
      if (statuses.length > 0 && (s.dismissed || !statuses.includes(s.liveStatus as StatusFilter))) return false;
      if (q === "") return true;
      return [s.name, s.projectPath ?? "", s.gitBranch ?? "", s.model, s.group, s.preview]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [sessions, filter, statuses]);

  // Any click outside dismisses the menu; the trigger and the panel stop the event
  // so they don't close it on the way in.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const toggleStatus = (key: StatusFilter) =>
    setStatuses(statuses.includes(key) ? statuses.filter((k) => k !== key) : [...statuses, key]);

  const groups = useMemo(() => groupSessions(visible, groupBy), [visible, groupBy]);
  const ordered = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const waiting = visible.filter((s) => s.liveStatus === "waiting_input" && !s.dismissed);
  // Looked up across every session, not just the visible ones: a session that leaves
  // the active filter (it went from waiting to working) must not close the panel.
  const current = sessions.find((s) => s.id === selected) ?? null;
  const wallOrdered = useMemo(() => wallOrder(visible), [visible]);
  const staged = sessions.find((s) => s.id === wallFocus) ?? null;
  const wall = view === "wall";
  const target = wall ? staged : current;

  const open = useCallback(async (s: Session, target?: string) => {
    try {
      const r = await openSession(s.id, target ?? "");
      setToast(r.ran ?? "abierto");
    } catch (e) {
      setToast(`No se pudo abrir: ${(e as Error).message}`);
    }
    window.setTimeout(() => setToast(""), 4000);
  }, []);

  const patchUser = useCallback((id: string, patch: Partial<Session>) => {
    setData((d) =>
      d === null ? d : { ...d, sessions: d.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
    );
  }, []);

  // Optimistic: the row must dim on the click, not on the next poll.
  const dismiss = useCallback(
    (s: Session, dismissed: boolean) => {
      patchUser(s.id, { dismissed, dismissedAt: dismissed ? s.lastActivity : "" });
      saveUser(s.id, { dismissed }).catch(() => patchUser(s.id, { dismissed: !dismissed }));
    },
    [patchUser]
  );

  const move = useCallback(
    (delta: number) => {
      if (ordered.length === 0) return;
      const i = ordered.findIndex((s) => s.id === selected);
      const next = i === -1 ? 0 : Math.min(ordered.length - 1, Math.max(0, i + delta));
      setSelected(ordered[next].id);
      document.querySelector(`[data-row="${ordered[next].id}"]`)?.scrollIntoView({ block: "nearest" });
    },
    [ordered, selected]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA";
      if (e.key === "Escape") {
        if (typing) el.blur();
        else if (wall && staged !== null) setWallFocus(null);
        else if (!wall && selected !== null) setSelected(null); // close the panel before clearing filters
        else setFilter("");
        return;
      }
      if (typing || view === "settings") return;
      const listMode = view === "fleet";
      if (!listMode && (e.key === "j" || e.key === "k" || e.key === "g")) return;
      if (wall && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
        const s = wallOrdered[Number(e.key) - 1];
        if (s !== undefined) setWallFocus(s.id);
        return;
      }
      if (wall && (e.key === "[" || e.key === "]") && staged !== null && wallOrdered.length > 0) {
        const i = wallOrdered.findIndex((s) => s.id === staged.id);
        const step = e.key === "]" ? 1 : wallOrdered.length - 1;
        setWallFocus(wallOrdered[(Math.max(i, 0) + step) % wallOrdered.length].id);
        return;
      }
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "Enter" && target !== null) {
        e.preventDefault();
        open(target, e.shiftKey ? altTarget(target) : undefined);
      } else if (e.key === "x" && target !== null) {
        e.preventDefault();
        dismiss(target, !target.dismissed);
      } else if (e.key === "g") {
        setGroupBy(GROUP_CYCLE[(GROUP_CYCLE.indexOf(groupBy) + 1) % GROUP_CYCLE.length]);
      } else if (e.key === "w" && wall && waiting.length > 0) {
        setWallFocus(waiting[0].id);
      } else if (e.key === "w" && waiting.length > 0) {
        setSelected(waiting[0].id);
        document.querySelector(`[data-row="${waiting[0].id}"]`)?.scrollIntoView({ block: "center" });
      } else if (e.key === "/") {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    move, target, open, waiting, dismiss, groupBy, setGroupBy, setFilter, selected, view,
    wall, staged, wallOrdered, setWallFocus,
  ]);

  const moveToGroup = useCallback(
    (s: Session, group: string) => {
      patchUser(s.id, { group });
      saveUser(s.id, { group }).catch(() => patchUser(s.id, { group: s.group }));
    },
    [patchUser]
  );

  const createGroup = useCallback((name: string) => {
    addGroup(name).then((r) => setData((d) => (d === null ? d : { ...d, groups: r.groups })));
  }, []);

  const stale = data !== null && Date.now() - new Date(data.scannedAt).getTime() > 30_000;

  return (
    <div className="app">
      <div className="chrome">
        <div className="brand">
          <img src="/logo.png" alt="" width="22" height="22" />
          <b>Agent Board</b>
        </div>
        <span className="divider" />
        <div className="modes seg">
          {([["fleet", "Fleet"], ["wall", "Muro"], ["board", "Board"], ["graph", "Grafo"]] as const).map(([v, label]) => (
            <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
              {label}
            </button>
          ))}
        </div>
        <span className="chrome-title">{toast !== "" ? toast : error !== "" ? `sin backend — ${error}` : ""}</span>
        <div className="chrome-right">
          <span className="refresh" title={data === null ? "" : `último escaneo ${data.scannedAt}`}>
            <i className={`dot${stale || error !== "" ? " stale" : ""}`} />
            <span className="mono">{data === null ? "escaneando…" : `hace ${ago(data.scannedAt)}`}</span>
          </span>
          <div className="usermenu">
            <button
              className={`avatar${menuOpen ? " on" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
              title="Cuenta y ajustes"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="8.5" r="3.6" fill="currentColor" />
                <path
                  d="M4.6 20c.7-4 3.8-6 7.4-6s6.7 2 7.4 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            {menuOpen && (
              <div className="dropdown" onClick={(e) => e.stopPropagation()}>
                <div className="who">
                  <b>Local</b>
                  <span className="mono">sin cuenta · todo en tu máquina</span>
                </div>
                <button
                  onClick={() => {
                    setView("settings");
                    setMenuOpen(false);
                  }}
                >
                  Ajustes
                </button>
                <button disabled title="Próximamente">Histórico</button>
                <button disabled title="Próximamente">Costos</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {view === "settings" ? (
        <Settings
          themes={themes}
          themesDir={themesDir}
          themeId={themeId}
          onPickTheme={setThemeId}
          fleet={data}
        />
      ) : (
      <>
      <div className="toolbar">
        <div className="chips filters">
          <button className={statuses.length === 0 ? "on" : ""} onClick={() => setStatuses([])}>
            Todas <span className="n">{sessions.length}</span>
          </button>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              className={`${statuses.includes(f.key) ? "on " : ""}${f.key === "waiting_input" ? "wait" : "work"}`}
              onClick={() => toggleStatus(f.key)}
            >
              <i className={`statusdot ${f.key}`} />
              {f.label} <span className="n">{counts[f.key]}</span>
            </button>
          ))}
        </div>

        {view === "fleet" && (
          <>
            <span className="divider" />
            <div className="seg">
              {GROUP_CYCLE.map((g) => (
                <button key={g} className={groupBy === g ? "on" : ""} onClick={() => setGroupBy(g)}>
                  {g === "project" ? "Proyecto" : g === "provider" ? "Proveedor" : "Status"}
                </button>
              ))}
            </div>
          </>
        )}

        {wall && (
          <>
            <span className="divider" />
            <span className="label">{staged !== null ? "Escenario" : "Muro"}</span>
          </>
        )}

        <span style={{ flex: 1 }} />

        <div className={`search${filter !== "" ? " active" : ""}`}>
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <input
            ref={filterRef}
            value={filter}
            placeholder="Buscar sesión, proyecto, rama…"
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter === "" ? (
            <span className="kbd">/</span>
          ) : (
            <button className="clear" onClick={() => setFilter("")} title="Limpiar (Esc)">
              ✕
            </button>
          )}
        </div>
        <span className="mono shown">
          {visible.length === sessions.length ? `${sessions.length}` : `${visible.length}/${sessions.length}`}
        </span>
      </div>

      <div className={`body${wall ? " wallmode" : ""}`}>
        {wall && data !== null && (visible.length > 0 || staged !== null) ? (
          <Wall
            ordered={wallOrdered}
            current={staged}
            scannedAt={data.scannedAt}
            onFocus={setWallFocus}
            onOpen={open}
            onDismiss={dismiss}
          />
        ) : (
        <div className="list">
          {data !== null && sessions.length === 0 ? (
            <Empty paths={data.paths} scannedAt={data.scannedAt} />
          ) : visible.length === 0 ? (
            <NoMatch
              onClear={() => {
                setStatuses([]);
                setFilter("");
              }}
            />
          ) : view === "board" ? (
            <Board
              sessions={visible}
              groups={data?.groups ?? []}
              selected={selected}
              onSelect={setSelected}
              onMove={moveToGroup}
              onAddGroup={createGroup}
            />
          ) : view === "graph" ? (
            <Graph sessions={visible} selected={selected} onSelect={setSelected} />
          ) : (
            <Fleet
              groups={groups}
              selected={selected}
              onSelect={setSelected}
              onOpen={open}
              onDismiss={dismiss}
            />
          )}
        </div>
        )}
        {!wall && current !== null && (
          <Detail
            session={current}
            groups={data?.groups ?? []}
            onOpen={open}
            onUserChange={patchUser}
            onDismiss={dismiss}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      <div className="help">
        {wall ? (
          <>
            <span><b>1–9</b> traer al escenario</span>
            <span><b>w</b> la que más espera</span>
            <span><b>[ ]</b> anterior / siguiente</span>
            <span><b>⏎</b> abrir en su cliente</span>
            <span><b>⇧⏎</b> en el otro cliente</span>
            <span><b>x</b> dar por cerrada</span>
            <span><b>Esc</b> volver al muro</span>
          </>
        ) : view === "fleet" ? (
          <>
            <span><b>j/k</b> mover</span>
            <span><b>⏎</b> abrir</span>
            <span><b>⇧⏎</b> abrir en el otro cliente</span>
            <span><b>x</b> dar por cerrada</span>
            <span><b>w</b> primera esperando</span>
            <span><b>g</b> agrupar</span>
            <span><b>/</b> filtrar</span>
          </>
        ) : view === "board" ? (
          <>
            <span>Arrastrá una tarjeta para cambiarla de columna</span>
            <span><b>click</b> ver el detalle</span>
            <span><b>Esc</b> cerrar panel</span>
          </>
        ) : (
          <>
            <span><b>click</b> en el proyecto para plegarlo</span>
            <span><b>▾</b> pliega lo que la sesión tiene en curso</span>
            <span><b>Esc</b> cerrar panel</span>
          </>
        )}
      </div>
      </>
      )}
    </div>
  );
}
