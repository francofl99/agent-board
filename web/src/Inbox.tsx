import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ago, clock } from "./format";
import { SOURCE_NAME, SourceIcon } from "./SourceIcon";
import type { InboxItem, InboxResponse, InboxSource, InboxStatus } from "./types";

export interface Decide {
  status?: InboxStatus;
  approve?: boolean;
  text?: string;
}

type Filter = "all" | InboxSource;

const FILTERS: [Filter, string][] = [
  ["all", "Todo"],
  ["pr", "PRs"],
  ["jira", "Jira"],
  ["slack", "Slack"],
  ["mail", "Mail"],
];

const SECTIONS: { key: InboxSource; label: string; empty: string }[] = [
  { key: "pr", label: "Pull requests", empty: "Sin PRs esperando tu review." },
  { key: "jira", label: "Jira", empty: "Sin novedades." },
  { key: "slack", label: "Slack", empty: "Sin menciones pendientes." },
  { key: "mail", label: "Mail", empty: "Nada relevante." },
  { key: "alert", label: "Alertas", empty: "" },
];

const STATUS_TAG: Partial<Record<InboxStatus, string>> = { snoozed: "pospuesto", dismissed: "descartado" };

function remindTag(i: InboxItem): string | undefined {
  if (!i.pinned || i.remindAt === "" || Date.parse(i.remindAt) <= Date.now()) return undefined;
  const at = new Date(i.remindAt);
  const day = at.toDateString() === new Date().toDateString() ? "hoy" : "mañana";
  return `recordar ${day} ${at.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`;
}

const resolved = (i: InboxItem) => i.status !== "pending" || i.executed !== null;
const hot = (i: InboxItem) => !resolved(i) && (i.priority === "red" || i.priority === "orange");
const matches = (i: InboxItem, q: string) =>
  [i.label, i.title, i.hint, i.where, i.who, i.summary].join(" ").toLowerCase().includes(q);

interface RowProps {
  item: InboxItem;
  selected: boolean;
  open: boolean;
  draft: string | undefined;
  onToggle: () => void;
  onDraft: (text: string) => void;
  onDecide: (patch: Decide) => void;
}

function Row({ item, selected, open, draft, onToggle, onDraft, onDecide }: RowProps) {
  const done = item.status === "done";
  const tag = item.executed !== null ? `ejecutada · ${item.executed.result}` : STATUS_TAG[item.status];
  const text = draft ?? (item.approved ? item.approvedText : item.action?.text ?? "");
  const cls = ["irow", item.source === "note" ? "pinsrc" : item.source, hot(item) ? "hot" : "", resolved(item) ? "resolved" : "", selected ? "sel" : ""];
  return (
    <article className={cls.filter(Boolean).join(" ")} data-row={item.id}>
      <div className="iline">
        <button
          className={`icheck${done ? " on" : ""}`}
          aria-pressed={done}
          aria-label={done ? `Marcar ${item.label} como pendiente` : `Marcar ${item.label} como tratado`}
          onClick={() => onDecide({ status: done ? "pending" : "done" })}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <i className={`iprio ${item.priority}`} aria-hidden="true" />
        <span className="ipill" title={SOURCE_NAME[item.source]}>
          <SourceIcon source={item.source} />
          <span className="sr">{SOURCE_NAME[item.source]} </span>
          {item.label}
        </span>
        <button className="imain" aria-expanded={open} onClick={onToggle}>
          <span className="ititle">{item.title}</span>
          <span className="ihint">{item.hint}</span>
        </button>
        {item.approved && <span className="itag ok">aprobada · próxima corrida</span>}
        {remindTag(item) !== undefined && <span className="itag">{remindTag(item)}</span>}
        {tag !== undefined && <span className="itag">{tag}</span>}
        <span className="iwhere">{item.where}</span>
        <span className="iwho">{item.who}</span>
        <span className="itime">{item.since === "" ? "—" : ago(item.since)}</span>
      </div>
      {open && (
        <div className="ibody">
          <div className="icol">
            {item.pinned && item.noteText !== "" && item.noteText !== item.title && (
              <div>
                <h4>Tu nota</h4>
                <p>{item.noteText}</p>
              </div>
            )}
            {item.summary !== "" && (
              <div>
                <h4>Resumen</h4>
                <p>{item.summary}</p>
              </div>
            )}
            {item.suggestion !== "" && (
              <div>
                <h4>Sugerencia</h4>
                <p>{item.suggestion}</p>
              </div>
            )}
            {item.findings.length > 0 && (
              <div>
                <h4>Hallazgos</h4>
                <ul className="ifind">
                  {item.findings.map((f, i) => (
                    <li key={i}>
                      <span className={`isev ${f.severity.toLowerCase()}`}>{f.severity}</span>
                      <span>
                        {f.location !== "" && <code>{f.location}</code>} {f.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {item.url !== "" && (
              <a href={item.url} target="_blank" rel="noreferrer">
                Abrir en {SOURCE_NAME[item.source]} ↗
              </a>
            )}
          </div>
          <div className="icol">
            {item.action !== null && item.executed === null && (
              <label className="iprop">
                <span className="ilabel">
                  <span>{item.action.label}</span>
                  <span className="dim">{item.action.target}</span>
                </span>
                <textarea
                  rows={5}
                  value={text}
                  disabled={item.approved}
                  onChange={(e) => onDraft(e.target.value)}
                />
              </label>
            )}
            <div className="iacts">
              {item.action !== null && item.executed === null && (
                <button
                  className={`primary${item.approved ? " on" : ""}`}
                  onClick={() => onDecide(item.approved ? { approve: false } : { approve: true, text })}
                >
                  {item.approved ? "Aprobada · deshacer" : "Aprobar"} <kbd>a</kbd>
                </button>
              )}
              <button onClick={() => onDecide({ status: done ? "pending" : "done" })}>
                {done ? "Reabrir" : "Tratado"} <kbd>x</kbd>
              </button>
              <button onClick={() => onDecide({ status: item.status === "snoozed" ? "pending" : "snoozed" })}>
                {item.status === "snoozed" ? "Despertar" : "Posponer a mañana"} <kbd>s</kbd>
              </button>
              <button
                className="ghost"
                onClick={() => onDecide({ status: item.status === "dismissed" ? "pending" : "dismissed" })}
              >
                {item.status === "dismissed" ? "Restaurar" : "Descartar"} <kbd>d</kbd>
              </button>
            </div>
            {item.action !== null && (
              <p className="inote">
                Nada se envía desde acá: Claude ejecuta lo aprobado en la próxima corrida, y solo si la propuesta
                sigue siendo la misma.
              </p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

interface Props {
  data: InboxResponse | null;
  error: string;
  tabs?: ReactNode;
  onDecide: (item: InboxItem, patch: Decide) => void;
  onSettings: () => void;
  active?: boolean;
  brand?: boolean;
}

export function Inbox({ data, error, tabs, onDecide, onSettings, active = true, brand = true }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selId, setSelId] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const search = useRef<HTMLInputElement>(null);

  const items = data?.items ?? [];
  const pending = items.filter((i) => !resolved(i));
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => (filter === "all" || i.source === filter) && (q === "" || matches(i, q)));
  }, [items, filter, query]);

  const pinned = visible.filter((i) => i.pinned && !resolved(i));
  const now = visible.filter((i) => i.now && !i.pinned && !resolved(i));
  const sections = SECTIONS.filter((s) => filter === "all" || s.key === filter)
    .map((s) => ({ ...s, rows: visible.filter((i) => i.source === s.key && !i.now && !i.pinned && !resolved(i)) }))
    .filter((s) => s.rows.length > 0 || (s.key !== "alert" && filter === s.key) || (filter === "all" && s.key !== "alert"));
  const done = visible.filter(resolved);
  const flat = [...pinned, ...now, ...sections.flatMap((s) => s.rows), ...done];
  const sel = flat.find((i) => i.id === selId) ?? flat[0];

  const toggle = (id: string) => {
    setSelId(id);
    setOpened((o) => ({ ...o, [id]: !o[id] }));
  };

  const decide = (item: InboxItem, patch: Decide) => {
    setSelId(item.id);
    if (patch.approve !== undefined)
      setDrafts(({ [item.id]: _, ...rest }) => rest);
    onDecide(item, patch);
  };

  const approve = (item: InboxItem) => {
    if (item.action === null || item.executed !== null) return;
    decide(item, item.approved ? { approve: false } : { approve: true, text: drafts[item.id] ?? item.action.text });
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key === "Escape") {
        if (typing) (e.target as HTMLElement).blur();
        else setQuery("");
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = sel === undefined ? -1 : flat.indexOf(sel);
      const f = Number(e.key);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next !== undefined) {
          setSelId(next.id);
          document.querySelector(`[data-row="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === " " && sel !== undefined) toggle(sel.id);
      else if (e.key === "x" && sel !== undefined) decide(sel, { status: sel.status === "done" ? "pending" : "done" });
      else if (e.key === "s" && sel !== undefined)
        decide(sel, { status: sel.status === "snoozed" ? "pending" : "snoozed" });
      else if (e.key === "d" && sel !== undefined)
        decide(sel, { status: sel.status === "dismissed" ? "pending" : "dismissed" });
      else if (e.key === "a" && sel !== undefined) approve(sel);
      else if (e.key === "/") search.current?.focus();
      else if (f >= 1 && f <= FILTERS.length) setFilter(FILTERS[f - 1][0]);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const red = pending.filter((i) => i.priority === "red").length;
  const orange = pending.filter((i) => i.priority === "orange").length;
  const approved = items.filter((i) => i.approved).length;
  const report = data?.report;
  const count = (f: Filter) => pending.filter((i) => f === "all" || i.source === f).length;

  const row = (item: InboxItem) => (
    <Row
      key={item.id}
      item={item}
      selected={item.id === sel?.id}
      open={opened[item.id] === true}
      draft={drafts[item.id]}
      onToggle={() => toggle(item.id)}
      onDraft={(text) => setDrafts((d) => ({ ...d, [item.id]: text }))}
      onDecide={(patch) => decide(item, patch)}
    />
  );

  return (
    <div className="list inbox">
      <div className="lhead">
        {brand && <b className="lbrand">Agent Board</b>}
        {tabs}
        <span className="icount red">
          <i />
          {red} urgente
        </span>
        <span className="icount orange">
          <i />
          {orange} hoy
        </span>
        {approved > 0 && <span className="icount ok">{approved} aprobadas</span>}
        <span className="grow" />
        <label className="lsearch">
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
            <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <input ref={search} value={query} placeholder="Buscar" onChange={(e) => setQuery(e.target.value)} />
          <kbd>/</kbd>
        </label>
        <span className="lscan mono" title={report?.generatedAt ?? ""}>
          <i className={error !== "" || (report?.sourcesDown.length ?? 0) > 0 ? "stale" : ""} />
          {report?.generatedAt
            ? `corrida hace ${ago(report.generatedAt)}${report.nextRunAt ? ` · próxima ${clock(report.nextRunAt)}` : ""}`
            : "sin corridas"}
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
          {data !== null && items.length === 0 ? (
            <div className="lempty">
              <b>La bandeja está vacía</b>
              <span>La rutina inbox-triage escribe ~/.agent-board/inbox.json en cada corrida.</span>
            </div>
          ) : (
            <>
              <div className="ichips" role="group" aria-label="Filtrar por fuente">
                {FILTERS.map(([key, label], n) => (
                  <button
                    key={key}
                    className={`ichip ${key}${filter === key ? " on" : ""}`}
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                    title={`${label} (${n + 1})`}
                  >
                    {key !== "all" && <SourceIcon source={key} />}
                    {label}
                    <span className="n">{count(key)}</span>
                  </button>
                ))}
              </div>

              {(report?.sourcesDown.length ?? 0) > 0 && (
                <div className="iwarn">
                  Fuentes caídas en la última corrida:{" "}
                  {report!.sourcesDown.map((s) => `${s.source} (${s.error})`).join(" · ")}
                </div>
              )}

              {pinned.length > 0 && (
                <section className="lgroup">
                  <div className="igrouphead now">
                    <SourceIcon source="pin" />
                    <span className="nm">Anotados</span>
                    <span className="n">{pinned.length}</span>
                    <span className="rule" />
                  </div>
                  {pinned.map(row)}
                </section>
              )}

              {now.length > 0 && (
                <section className="lgroup">
                  <div className="igrouphead now">
                    <SourceIcon source="now" />
                    <span className="nm">Ahora</span>
                    <span className="n">{now.length}</span>
                    <span className="rule" />
                  </div>
                  {now.map(row)}
                </section>
              )}

              {sections.map((s) => (
                <section className="lgroup" key={s.key}>
                  <div className={`igrouphead ${s.key}`}>
                    <SourceIcon source={s.key} />
                    <span className="nm">{s.label}</span>
                    <span className="n">{s.rows.length}</span>
                    <span className="rule" />
                  </div>
                  {s.rows.length === 0 && <p className="iempty">{report?.notes[s.key] ?? s.empty}</p>}
                  {s.rows.map(row)}
                  {s.rows.length > 0 && report?.notes[s.key] && <p className="ifoot">{report.notes[s.key]}</p>}
                </section>
              ))}

              {done.length > 0 && (
                <section className="lgroup">
                  <div className="igrouphead done">
                    <SourceIcon source="done" />
                    <span className="nm">Resueltos</span>
                    <span className="n">{done.length}</span>
                    <span className="rule" />
                  </div>
                  {done.map(row)}
                </section>
              )}
            </>
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
          <b>x</b> tratado
        </span>
        <span>
          <b>a</b> aprobar
        </span>
        <span>
          <b>s</b> posponer
        </span>
        <span>
          <b>d</b> descartar
        </span>
        <span>
          <b>1–5</b> fuente
        </span>
        <span>
          <b>t</b> pestaña
        </span>
        <span className="lnote" />
      </div>
    </div>
  );
}
