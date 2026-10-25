import { useEffect, useMemo, useRef, useState } from "react";
import { getDetail } from "./api";
import { ago, clock, projectName, shortModel, usd } from "./format";
import { ProviderIcon } from "./ProviderIcon";
import { firstLine, groupByStatus, lastAgentText, plain, runningSummary } from "./sessions";
import type { FleetResponse, Session, TimelineEvent } from "./types";

const TAIL = 3;

type Kind = "wait" | "work";

const kindOf = (s: Session): Kind => (s.liveStatus === "waiting_input" ? "wait" : "work");

function hint(s: Session, kind: Kind): string {
  const running = runningSummary(s);
  if (kind === "work" && running !== "") return `◆ ${running}`;
  return firstLine(plain(lastAgentText(s)));
}

// "mcp__server__tool" reads as just the tool, with what it was given beside it.
function toolLine(e: TimelineEvent): string {
  const name = e.text.split("__").pop() ?? e.text;
  const arg = firstLine(e.meta);
  return arg === "" ? name : `${name} · ${arg}`;
}

const matches = (s: Session, q: string) =>
  [s.name, s.projectPath ?? "", s.gitBranch ?? "", s.model, s.preview].join(" ").toLowerCase().includes(q);

// The last few things the agent said or ran, oldest first. Asked for only while the row
// is open, and again whenever the session moves.
function Tail({ s }: { s: Session }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  useEffect(() => {
    let live = true;
    getDetail(s.id).then(
      (d) => live && setEvents(d.timeline.filter((e) => e.kind !== "prompt").slice(-TAIL)),
      () => live && setEvents([])
    );
    return () => {
      live = false;
    };
  }, [s.id, s.lastActivity]);

  if (events === null) return <div className="ltail"><span className="lmuted">leyendo…</span></div>;
  return (
    <div className="ltail">
      {events.map((e, i) => (
        <div className={`lev ${e.kind}`} key={i}>
          <span className="at">{clock(e.at)}</span>
          <i />
          <span className="txt">{e.kind === "tool" ? toolLine(e) : plain(e.text)}</span>
        </div>
      ))}
    </div>
  );
}

interface RowProps {
  s: Session;
  n: number;
  selected: boolean;
  open: boolean;
  onToggle: () => void;
  onDismiss: () => void;
}

function Row({ s, n, selected, open, onToggle, onDismiss }: RowProps) {
  const kind = kindOf(s);
  return (
    <div className={`lrow ${kind}${selected ? " sel" : ""}${open ? " open" : ""}`} data-row={s.id}>
      <div className="lline" onClick={onToggle}>
        <span className="lkey">{n}</span>
        <span className="lstate">
          {kind === "work" ? (
            <span className="ldots">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <i className="ldot" />
          )}
        </span>
        <span className="lname">
          <span className={`lprov ${s.provider}`}>
            <ProviderIcon provider={s.provider} size={11} />
          </span>
          <span className="nm">{s.name}</span>
        </span>
        <span className="lhint">{hint(s, kind)}</span>
        <span className="lwhere">{[projectName(s.projectPath, s.projectSlug), s.gitBranch].filter(Boolean).join(" · ")}</span>
        <span className="ltime">{ago(s.lastActivity)}</span>
      </div>
      {open && (
        <div className="lbody">
          <Tail s={s} />
          <div className="lside">
            <button onClick={onDismiss}>
              Dar por cerrada <kbd>x</kbd>
            </button>
            <span className="lmeta">
              {[shortModel(s.model), usd(s.costUsd)].filter((v) => v !== "" && v !== "—").join(" · ")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  data: FleetResponse | null;
  error: string;
  onDismiss: (s: Session, dismissed: boolean) => void;
  onSettings: () => void;
}

// The one list of sessions: who waits on you and who is working, each row opening onto
// its last moves.
export function List({ data, error, onDismiss, onSettings }: Props) {
  const [filter, setFilter] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const search = useRef<HTMLInputElement>(null);

  const sessions = data?.sessions ?? [];
  const all = useMemo(() => groupByStatus(sessions), [sessions]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q === "" ? all : groupByStatus(sessions.filter((s) => matches(s, q)));
  }, [all, sessions, filter]);
  // Only live sessions: closing one with x takes it off the list until it moves again.
  const flat = [...shown.waiting, ...shown.working];
  const sel = flat.find((s) => s.id === selId) ?? flat[0];

  const toggle = (id: string) => {
    setSelId(id);
    setOpened((o) => ({ ...o, [id]: !o[id] }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).tagName === "INPUT";
      if (e.key === "Escape") {
        if (typing) search.current?.blur();
        else setFilter("");
        return;
      }
      if (typing) return;
      const i = sel === undefined ? -1 : flat.indexOf(sel);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next !== undefined) {
          setSelId(next.id);
          document.querySelector(`[data-row="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === " " && sel !== undefined) toggle(sel.id);
      else if (e.key === "x" && sel !== undefined) onDismiss(sel, true);
      else if (e.key === "/") search.current?.focus();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const stale = data !== null && Date.now() - new Date(data.scannedAt).getTime() > 30_000;
  const groups: [string, Kind, Session[]][] = [
    ["Te esperan", "wait", shown.waiting],
    ["Trabajando", "work", shown.working],
  ];

  return (
    <div className="list">
      <div className="lhead">
        <b className="lbrand">Agent Board</b>
        <span className="lcount wait">
          <b>{all.waiting.length}</b>
          <span>te esperan{all.waiting.length > 0 ? ` · ${ago(all.waiting[0].lastActivity)}` : ""}</span>
        </span>
        <span className="lcount work">
          <b>{all.working.length}</b>
          <span>trabajando</span>
        </span>
        <span className="grow" />
        <label className="lsearch">
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
            <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <input ref={search} value={filter} placeholder="Buscar" onChange={(e) => setFilter(e.target.value)} />
          <kbd>/</kbd>
        </label>
        <span className="lscan mono" title={data === null ? "" : `último escaneo ${data.scannedAt}`}>
          <i className={stale || error !== "" ? "stale" : ""} />
          {data === null ? "escaneando…" : `hace ${ago(data.scannedAt)}`}
        </span>
        <button className="lgear" onClick={onSettings} title="Ajustes">
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" />
            <path
              d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="lscroll">
        <div className="lcontent">
          {data !== null && sessions.length === 0 ? (
            <div className="lempty">
              <b>No se detectaron sesiones</b>
              <span>Agent Board sólo lee archivos locales. Rutas escaneadas:</span>
              {data.paths.map((p) => (
                <span className="mono" key={p.path}>
                  {p.path} · {p.found} archivos
                </span>
              ))}
            </div>
          ) : flat.length === 0 && filter !== "" ? (
            <div className="lempty">
              <b>Ninguna sesión coincide con “{filter}”</b>
              <button onClick={() => setFilter("")}>Limpiar búsqueda</button>
            </div>
          ) : flat.length === 0 ? (
            <div className="lempty">
              <b>{data === null ? "Escaneando…" : "Ningún agente activo"}</b>
              {data !== null && <span>Cuando una sesión trabaje o te espere, aparece acá.</span>}
            </div>
          ) : (
            groups
              .filter(([, , rows]) => rows.length > 0)
              .map(([label, kind, rows]) => (
                <section className="lgroup" key={kind}>
                  <div className={`lgrouphead ${kind}`}>
                    <span className="nm">{label}</span>
                    <span className="n">{rows.length}</span>
                    <span className="rule" />
                  </div>
                  {rows.map((s) => (
                    <Row
                      key={s.id}
                      s={s}
                      n={flat.indexOf(s) + 1}
                      selected={s.id === sel?.id}
                      open={opened[s.id] === true}
                      onToggle={() => toggle(s.id)}
                      onDismiss={() => onDismiss(s, true)}
                    />
                  ))}
                </section>
              ))
          )}
        </div>
      </div>

      <div className="lfoot">
        <span className="lnote mono">{error !== "" ? `sin backend — ${error}` : ""}</span>
        <span>
          <b>↑↓</b> moverse
        </span>
        <span>
          <b>Espacio</b> desplegar
        </span>
        <span>
          <b>x</b> dar por cerrada
        </span>
        <span>
          <b>/</b> buscar
        </span>
        <span className="lnote" />
      </div>
    </div>
  );
}
