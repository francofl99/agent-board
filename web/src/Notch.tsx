import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getSessionPrs, openPullRequest, saveUser } from "./api";
import { ago, duration, projectName, shortModel, tokens, usd } from "./format";
import { ProviderIcon } from "./ProviderIcon";
import { tauri, type EdgeState } from "./shell";
import { lastAgentText, runningSummary } from "./Wall";
import type { FleetResponse, PrStatus, Session } from "./types";

// A fixed-width chip plus its gap: the step of the carousel.
const CHIP = 168;
const STEP = CHIP + 6;
const PAGE_MS = 3500;
const FRESH_MS = 5000;

const firstLine = (t: string) => t.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
const home = (p: string | null) => (p ?? "").replace(/^\/Users\/[^/]+/, "~");

// Sessions that start waiting while the bar is up are flagged for a few seconds, so
// the new one enters filled next to the notch before settling in with the rest.
function useFresh(ids: string[]): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const key = ids.join(",");
  useEffect(() => {
    const prev = seen.current;
    seen.current = new Set(ids);
    if (prev === null) return;
    const added = ids.filter((id) => !prev.has(id));
    if (added.length === 0) return;
    setFresh((f) => [...f, ...added]);
    window.setTimeout(() => setFresh((f) => f.filter((id) => !added.includes(id))), FRESH_MS);
  }, [key]);
  return new Set(fresh);
}

// Chips carry the title and the time only, so as many sessions as possible fit.
function WaitChip({ s, fresh, fixed }: { s: Session; fresh?: boolean; fixed?: boolean }) {
  return (
    <span className={`nchip wait${fresh ? " fresh" : ""}${fixed ? " fixed" : ""}`} title={s.name}>
      <i className="dot" />
      <span className="nm">{s.name}</span>
      <span className="t">{fresh ? "ahora" : ago(s.lastActivity)}</span>
    </span>
  );
}

function WorkChip({ s, fixed }: { s: Session; fixed?: boolean }) {
  return (
    <span className={`nchip work${fixed ? " fixed" : ""}`} title={s.name}>
      <span className="pulse">
        <i />
        <i />
        <i />
      </span>
      <span className="nm">{s.name}</span>
      <span className="t">{ago(s.lastActivity)}</span>
    </span>
  );
}

interface SideProps {
  side: "left" | "right";
  counter: ReactNode;
  pin?: ReactNode;
  chips: ReactNode[];
  carousel: ReactNode[];
  page: number;
  style: CSSProperties;
}

// One side of the full bar. Everything shows while it fits; otherwise the side turns
// into pages of fixed chips that rotate, with the pinned chip held next to the notch.
function Side({ side, counter, pin, chips, carousel, page, style }: SideProps) {
  const box = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const b = box.current;
    const m = measure.current;
    if (b === null || m === null) return;
    const check = () => {
      setWidth(b.clientWidth);
      setFits(m.offsetWidth <= b.clientWidth);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(b);
    ro.observe(m);
    return () => ro.disconnect();
  }, []);

  // Room left after the counter (~56px) and the page dots (~40px); the last chip has no gap.
  const per = Math.max(1, Math.floor((width - 56 - (pin ? STEP : 0) - 40 + 6) / STEP));
  const pages = Math.max(1, Math.ceil(carousel.length / per));
  const current = page % pages;
  const offset = current * per * STEP;

  return (
    <div className={`nside ${side}`} style={style} ref={box}>
      <div className="nmeasure" ref={measure} aria-hidden="true">
        {counter}
        {chips}
      </div>
      {fits ? (
        <>
          {counter}
          {chips}
        </>
      ) : (
        <>
          {counter}
          {pin}
          <div className="nwindow" style={{ width: per * STEP - 6 }}>
            <div className="ntrack" style={{ transform: `translateX(${side === "left" ? offset : -offset}px)` }}>
              {carousel}
            </div>
          </div>
          {pages > 1 && (
            <span className="ndots">
              {Array.from({ length: pages }, (_, i) => (
                <i key={i} className={i === current ? "on" : ""} />
              ))}
            </span>
          )}
        </>
      )}
    </div>
  );
}

interface Props {
  data: FleetResponse | null;
  error: string;
  expanded: boolean;
  edge: EdgeState;
  hover: boolean;
  reload: () => void;
}

export function Notch({ data, error, expanded, edge, hover, reload }: Props) {
  const sessions = data?.sessions ?? [];
  const live = sessions.filter((s) => !s.dismissed && (s.liveStatus === "waiting_input" || s.liveStatus === "working"));
  // Longest wait first: it sits next to the notch and the rest fan outwards.
  const waiting = live
    .filter((s) => s.liveStatus === "waiting_input")
    .sort((a, b) => a.lastActivity.localeCompare(b.lastActivity));
  const working = live.filter((s) => s.liveStatus === "working");
  const fresh = useFresh(waiting.map((s) => s.id));

  // The shell shows the window once the page reports in.
  useEffect(() => {
    tauri?.core.invoke("rail_height", { height: 32 });
  }, []);

  if (expanded) {
    return <Panel waiting={waiting} working={working} reload={reload} />;
  }
  // On a desktop the menu bar is showing and there is no black strip to use: the window
  // shrinks to the notch itself and only paints its black, so the menu stays clear.
  if (!edge.full) {
    return <div className="nbar" />;
  }
  return (
    <FullBar waiting={waiting} working={working} fresh={fresh} edge={edge} hover={hover} error={error} />
  );
}

interface FullBarProps {
  waiting: Session[];
  working: Session[];
  fresh: Set<string>;
  edge: EdgeState;
  hover: boolean;
  error: string;
}

function FullBar({ waiting, working, fresh, edge, hover, error }: FullBarProps) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (hover) return;
    const t = window.setInterval(() => setPage((p) => p + 1), PAGE_MS);
    return () => window.clearInterval(t);
  }, [hover]);

  const gap = edge.notchWidth / 2 + 10;
  const newOnes = waiting.filter((s) => fresh.has(s.id));
  const settled = waiting.filter((s) => !fresh.has(s.id));
  const ordered = [...newOnes, ...settled];
  // While a new wait is announced the side keeps just it and the longest wait, so the
  // alert reads at a glance; the rest fold into a count until it settles.
  const shown = newOnes.length > 0 ? [...newOnes, ...settled.slice(0, 1)] : ordered;
  const hidden = ordered.length - shown.length;
  const more = hidden > 0 && (
    <span className="nchip wait more" key="more">
      <span className="nm">+{hidden}</span>
    </span>
  );

  const waitCounter = (
    <span className="ncount wait" key="count">
      <b>{waiting.length}</b>
      {waiting.length > 0 && <span>{ago(waiting[0].lastActivity)}</span>}
    </span>
  );
  const workCounter = (
    <span className="ncount work" key="count">
      <b>{working.length}</b>
    </span>
  );

  return (
    <div className="nbar full">
      {error !== "" ? (
        <span className="nside left" style={{ left: 14, right: `calc(50% + ${gap}px)` }}>
          <span className="ncount">sin backend</span>
          <i className="statusdot ended" title={error} />
        </span>
      ) : (
        <>
          <Side
            side="left"
            style={{ left: 14, right: `calc(50% + ${gap}px)` }}
            counter={waitCounter}
            chips={[...shown.map((s) => <WaitChip key={s.id} s={s} fresh={fresh.has(s.id)} />), more]}
            pin={ordered[0] && <WaitChip key="pin" s={ordered[0]} fresh={fresh.has(ordered[0].id)} fixed />}
            carousel={ordered.slice(1).map((s) => <WaitChip key={s.id} s={s} fixed />)}
            page={page}
          />
          <Side
            side="right"
            style={{ left: `calc(50% + ${gap}px)`, right: 14 }}
            counter={workCounter}
            chips={working.map((s) => <WorkChip key={s.id} s={s} />)}
            carousel={working.map((s) => <WorkChip key={s.id} s={s} fixed />)}
            page={page}
          />
        </>
      )}
    </div>
  );
}

interface PanelProps {
  waiting: Session[];
  working: Session[];
  reload: () => void;
}

const LIVE_LABEL: Record<string, string> = {
  waiting_input: "Esperando tu respuesta",
  working: "Trabajando",
  idle: "Inactiva",
  ended: "Terminada",
};

// Drops like a pull-down terminal: the list on the left, the selected session in the
// middle, its numbers and output on the right, all reachable from the keyboard.
function Panel({ waiting, working, reload }: PanelProps) {
  const rows = [...waiting, ...working];
  const [selId, setSelId] = useState<string | null>(null);
  const sel = rows.find((s) => s.id === selId) ?? rows[0];
  const dismiss = (s: Session) => saveUser(s.id, { dismissed: !s.dismissed }).then(reload);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = sel === undefined ? -1 : rows.indexOf(sel);
      if (e.key === "Escape") tauri?.core.invoke("rail_collapse");
      else if (e.key === "ArrowDown" && i < rows.length - 1) setSelId(rows[i + 1].id);
      else if (e.key === "ArrowUp" && i > 0) setSelId(rows[i - 1].id);
      else if (e.key === "x" && sel !== undefined) dismiss(sel);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const row = (s: Session) => {
    const w = s.liveStatus === "waiting_input";
    return (
      <button
        key={s.id}
        className={`nrow ${w ? "wait" : "work"}${s.id === sel?.id ? " sel" : ""}`}
        onClick={() => setSelId(s.id)}
      >
        <span className="ico">
          <ProviderIcon provider={s.provider} size={13} />
        </span>
        <span className="nbody">
          <span className="nm">{s.name}</span>
          <span className="where">{[projectName(s.projectPath, s.projectSlug), s.gitBranch].filter(Boolean).join(" · ")}</span>
          <span className="det">{w ? firstLine(lastAgentText(s)) : runningSummary(s) || firstLine(lastAgentText(s))}</span>
        </span>
        <span className="t">{ago(s.lastActivity)}</span>
      </button>
    );
  };

  return (
    <div className="npanel">
      <div className="nband">
        <span className="ncount wait">
          <b>{waiting.length}</b>
          <span>
            {waiting.length === 0
              ? "nadie te espera"
              : `te ${waiting.length === 1 ? "espera" : "esperan"} · la más vieja ${ago(waiting[0].lastActivity)}`}
          </span>
        </span>
        <span className="ncount work">
          <span>trabajando</span>
          <b>{working.length}</b>
        </span>
      </div>

      <div className="ngrid">
        <div className="nlist">
          {waiting.length > 0 && <div className="nlabel">Te esperan</div>}
          {waiting.map(row)}
          {working.length > 0 && <div className="nlabel">Trabajando</div>}
          {working.map(row)}
        </div>

        {sel === undefined ? (
          <div className="nempty">Ningún agente activo.</div>
        ) : (
          <div className="ndetail">
            <div className="nhead">
              <span className="ntags">
                <span className={`nprov ${sel.provider}`}>{sel.provider.toUpperCase()}</span>
                <span className="ncli">{sel.client === "desktop" ? "APP" : "CLI"}</span>
                <span className={`state ${sel.dismissed ? "ended" : sel.liveStatus}`}>
                  <i />
                  {sel.dismissed ? "Cerrada por vos" : LIVE_LABEL[sel.liveStatus]} · {ago(sel.lastActivity)}
                </span>
              </span>
              <b className="title">{sel.name}</b>
              <span className="nsub">
                {[home(sel.projectPath) || sel.projectSlug, sel.gitBranch, shortModel(sel.model)].filter(Boolean).join(" · ")}
              </span>
              <span className="actions">
                <button onClick={() => dismiss(sel)}>
                  {sel.dismissed ? "Reabrir" : "Dar por cerrada"} <kbd>x</kbd>
                </button>
                <button onClick={() => navigator.clipboard.writeText(sel.id)}>Copiar sessionId</button>
              </span>
            </div>
            <Context s={sel} />
          </div>
        )}
      </div>

      <div className="nfoot">
        <span>
          <b>↑↓</b> moverse
        </span>
        <span>
          <b>x</b> dar por cerrada
        </span>
        <span>
          <b>Esc</b> ocultar
        </span>
        <span className="grow" />
        <span>
          <b>⌘⇧A</b> mostrar / ocultar desde cualquier app
        </span>
      </div>
    </div>
  );
}

const MERGE_TEXT: Record<string, string> = {
  draft: "draft",
  conflicts: "conflictos",
  behind: "falta actualizar base",
  checksFailing: "checks requeridos fallando",
  changesRequested: "cambios pedidos",
  checksRunning: "checks corriendo",
  reviewRequired: "falta review",
  blocked: "bloqueado",
  unstable: "checks no requeridos fallando",
  ready: "listo para mergear",
};
const CHECK_MARK = { ok: "✓", failed: "✕", pending: "●" };
const MAX_CHECKS = 8;

function PrBlock({ pr }: { pr: PrStatus }) {
  const ok = pr.checks.filter((c) => c.result === "ok").length;
  const merge =
    pr.state === "MERGED" ? "mergeado" : pr.state === "CLOSED" ? "cerrado" : MERGE_TEXT[pr.merge] ?? "";
  const mergeTone = pr.state === "MERGED" || pr.merge === "ready" ? "ok" : pr.state === "CLOSED" ? "" : "wait";
  return (
    <div className="nprblock">
      <button className="npr" onClick={() => openPullRequest(pr.url)} title={`Abrir ${pr.url}`}>
        <b>#{pr.number}</b>
        <span>{pr.title}</span>
      </button>
      <span className="npills">
        {pr.checks.length > 0 && (
          <span className={`npill ${ok === pr.checks.length ? "ok" : "wait"}`}>
            checks {ok}/{pr.checks.length}
          </span>
        )}
        {merge !== "" && <span className={`npill ${mergeTone}`}>{merge}</span>}
      </span>
      {pr.checks.slice(0, MAX_CHECKS).map((c) => (
        <span className={`ncheck ${c.result}`} key={c.name}>
          <i>{CHECK_MARK[c.result]}</i>
          {c.name}
        </span>
      ))}
    </div>
  );
}

function Context({ s }: { s: Session }) {
  const [statuses, setStatuses] = useState<PrStatus[] | null>(null);
  useEffect(() => {
    let live = true;
    getSessionPrs(s.id).then(
      (r) => live && setStatuses(r.prs),
      () => live && setStatuses([])
    );
    return () => {
      live = false;
    };
  }, [s.id, s.lastActivity]);
  useEffect(() => setStatuses(null), [s.id]);

  const metrics: [string, string][] = [
    ["Modelo", shortModel(s.model) || "—"],
    ["Mensajes", String(s.messageCount)],
    ["Tokens", tokens(s.tokensIn + s.tokensOut + s.cacheReadTokens + s.cacheWriteTokens)],
    ["Costo est.", usd(s.costUsd)],
    ["Duración", duration(s.startedAt, s.lastActivity)],
    ["Actividad", `hace ${ago(s.lastActivity)}`],
  ];
  const prs = s.pullRequests;
  return (
    <div className="ncontext">
      <div className="nsec">
        <div className="nlabel">Métricas</div>
        <div className="nmetrics">
          {metrics.map(([k, v]) => (
            <div key={k}>
              <span className="k">{k}</span>
              <span className="v">{v}</span>
            </div>
          ))}
        </div>
      </div>
      {statuses !== null && statuses.length > 0 ? (
        <div className="nsec">
          <div className="nlabel">Pull request{statuses.length > 1 ? "s" : ""}</div>
          {statuses.map((pr) => (
            <PrBlock pr={pr} key={pr.url} />
          ))}
        </div>
      ) : prs.length > 0 && (
        <div className="nsec">
          <div className="nlabel">Pull request{prs.length > 1 ? "s" : ""}</div>
          {prs.map((u) => {
            const m = u.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
            return (
              <button className="npr" key={u} onClick={() => openPullRequest(u)} title={`Abrir ${u}`}>
                <b>#{m?.[2] ?? "?"}</b>
                <span>{m?.[1] ?? u}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
