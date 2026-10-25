import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getDetail } from "./api";
import { altTarget, ago, clock, duration, projectName, shortModel, statusClass, tokens, usd } from "./format";
import type { DetailResponse, Session } from "./types";
import { PROVIDER_LABEL, ProviderIcon } from "./ProviderIcon";

const RANK: Record<string, number> = { waiting_input: 0, working: 1, idle: 2, ended: 3, dismissed: 4 };

const LIVE_LABEL: Record<string, string> = {
  waiting_input: "Esperando tu respuesta",
  working: "Trabajando",
  idle: "Inactiva",
  ended: "Terminada",
};

const status = (s: Session) => (s.dismissed ? "dismissed" : s.liveStatus);
const isLive = (s: Session) => !s.dismissed && (s.liveStatus === "waiting_input" || s.liveStatus === "working");

// Stable sort: within a status the API's order holds. The 1–9 keys follow this order.
export function wallOrder(list: Session[]): Session[] {
  return [...list].sort((a, b) => RANK[status(a)] - RANK[status(b)]);
}

function clientName(target: string): string {
  const [provider, client] = target.split("-");
  return `${provider === "codex" ? "Codex" : "Claude"} ${client === "desktop" ? "Desktop" : "CLI"}`;
}

function stateText(s: Session): string {
  if (s.dismissed) return "cerrada";
  if (s.liveStatus === "waiting_input") return `espera ${ago(s.lastActivity)}`;
  if (s.liveStatus === "working") return "trabajando";
  return `${s.liveStatus === "idle" ? "inactiva" : "terminada"} · ${ago(s.lastActivity)}`;
}

function lastAgentText(s: Session): string {
  const m = [...s.recentMessages].reverse().find((r) => r.role === "assistant");
  return m?.text ?? s.preview;
}

function Origin({ s, size }: { s: Session; size: number }) {
  return (
    <>
      <span className={`tag-prov ${s.provider}`} title={PROVIDER_LABEL[s.provider]}>
        <ProviderIcon provider={s.provider} size={size} />
      </span>
      <span className={`tag-cli ${s.client}`}>{s.client === "desktop" ? "APP" : "CLI"}</span>
    </>
  );
}

function Running({ s }: { s: Session }) {
  if (s.running.length === 0) return null;
  return (
    <div className="wrunning">
      {s.running.map((r) => (
        <span key={r.id} className={r.kind}>
          <i />
          {r.name} <span className="mono">{ago(r.startedAt)}</span>
        </span>
      ))}
    </div>
  );
}

function Tile({ s, keyHint, onFocus }: { s: Session; keyHint: string; onFocus: (id: string) => void }) {
  const st = statusClass(s.liveStatus, s.dismissed);
  const tail = s.recentMessages.filter((m) => m.role !== "user").slice(-3);
  const pr = s.pullRequests.length > 0 ? `PR ${s.pullRequests[0].split("/").pop()}` : "";
  return (
    <div className={`wtile st-${st}`} onClick={() => onFocus(s.id)}>
      <div className="whead">
        <span className="wkey">{keyHint}</span>
        <Origin s={s} size={12} />
        <b className="wname">{s.name}</b>
        <i className={`statusdot ${st}`} />
      </div>
      <div className="wbody">
        {tail.map((m, i) => (
          <div key={i} className={`wmsg ${m.role === "assistant" ? "assistant" : "tool"}`}>
            <i />
            <span>{m.text}</span>
          </div>
        ))}
        <Running s={s} />
      </div>
      <div className="wfoot mono">
        <span className="where">
          {projectName(s.projectPath, s.projectSlug)}
          {s.gitBranch ? ` · ${s.gitBranch}` : ""}
        </span>
        {pr !== "" && <span className="pr">{pr}</span>}
        <span className="state">{stateText(s)}</span>
      </div>
    </div>
  );
}

interface StageProps {
  session: Session;
  scannedAt: string;
  onOpen: (s: Session, target?: string) => void;
  onDismiss: (s: Session, dismissed: boolean) => void;
  onBack: () => void;
}

function Stage({ session, scannedAt, onOpen, onDismiss, onBack }: StageProps) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const tlRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    setData(null);
    pinned.current = true;
  }, [session.id]);

  // Refetched on every fleet poll so the timeline stays live while the stage is open.
  useEffect(() => {
    let live = true;
    getDetail(session.id).then((d) => {
      if (live) setData(d);
    });
    return () => {
      live = false;
    };
  }, [session.id, scannedAt]);

  // Oldest first, newest at the bottom, like a chat.
  const timeline = (data?.timeline ?? []).filter((e) =>
    e.kind === "tool" ? showTools : e.kind === "prompt" ? showPrompts : true
  );

  // Follow new events unless the user scrolled up to read something older.
  useLayoutEffect(() => {
    const el = tlRef.current;
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
  }, [timeline.length, session.id, session.liveStatus]);

  const st = statusClass(session.liveStatus, session.dismissed);
  const options = data?.openOptions ?? [];
  const primary = options.find((o) => o.target === data?.defaultTarget) ?? options[0];
  const own = primary?.label ?? clientName(session.provider + "-" + (session.client || "cli"));
  const waiting = session.liveStatus === "waiting_input" && !session.dismissed;
  const working = session.liveStatus === "working" && !session.dismissed;
  const agents = session.running.filter((r) => r.kind === "agent").length;
  const background = session.running.length - agents;
  const doing =
    [
      agents > 0 ? `${agents} sub-agente${agents > 1 ? "s" : ""}` : "",
      background > 0 ? `${background} en segundo plano` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "trabajando";

  const metrics: [string, string][] = [
    ["Modelo", shortModel(session.model) || "—"],
    ["Mensajes", String(session.messageCount)],
    ["Tokens", tokens(session.tokensIn + session.tokensOut + session.cacheReadTokens + session.cacheWriteTokens)],
    ["Costo est.", usd(session.costUsd)],
    ["Duración", duration(session.startedAt, session.lastActivity)],
    ["Actividad", `hace ${ago(session.lastActivity)}`],
  ];

  return (
    <div className={`stage st-${st}`}>
      <div className="shead">
        <div className="tags">
          <Origin s={session} size={13} />
          <span className={`livetag ${st}`}>
            <i className={`statusdot ${st}`} />
            {session.dismissed ? "Cerrada por vos" : LIVE_LABEL[session.liveStatus]}
          </span>
          <span style={{ flex: 1 }} />
          <button className="back" onClick={onBack}>
            Volver al muro <span className="kbd">Esc</span>
          </button>
        </div>
        <div className="stitle">
          <div className="sname">
            <b>{session.name}</b>
            <span className="mono">
              {session.projectPath ?? session.projectSlug}
              {session.gitBranch ? ` · ${session.gitBranch}` : ""}
            </span>
          </div>
          <div className="sactions">
            <button className="main" onClick={() => onOpen(session)}>
              Abrir en {own} <span className="kbd">⏎</span>
            </button>
            <button onClick={() => onOpen(session, altTarget(session))}>
              {clientName(altTarget(session))} <span className="kbd">⇧⏎</span>
            </button>
            <button onClick={() => onDismiss(session, !session.dismissed)}>
              {session.dismissed ? "Reabrir" : "Dar por cerrada"} <span className="kbd">x</span>
            </button>
          </div>
        </div>
      </div>

      <div className="smetrics">
        {metrics.map(([k, v]) => (
          <div key={k}>
            <div className="k">{k}</div>
            <div className="v" title={v}>{v}</div>
          </div>
        ))}
      </div>

      <div className="stlhead">
        <span className="label">Timeline · en vivo</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className={`toggle${showPrompts ? " on" : ""}`} onClick={() => setShowPrompts(!showPrompts)}>
            tus mensajes
          </button>
          <button className={`toggle${showTools ? " on" : ""}`} onClick={() => setShowTools(!showTools)}>
            herramientas
          </button>
          <span className="hushed mono">{data === null ? "leyendo…" : `${data.totalEvents} eventos`}</span>
        </span>
      </div>

      <div
        className="stl"
        ref={tlRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        <div className="tl">
          {timeline.map((e, i) => (
            <div className="tlrow" key={i}>
              <span className="time">{clock(e.at)}</span>
              <span className="rail">
                <i className={e.kind} />
              </span>
              <span>
                <span className={`txt ${e.kind}`}>{e.text}</span>
                {e.meta !== "" && <span className="meta">{e.meta}</span>}
              </span>
            </div>
          ))}
        </div>
        {working && (
          <div className="sdoing mono">
            <i />
            {doing}
          </div>
        )}
        {waiting && (
          <div className="swaiting">
            Esperando tu respuesta desde hace {ago(session.lastActivity)}. Respondé en {own} (⏎).
          </div>
        )}
      </div>
    </div>
  );
}

interface WallProps {
  ordered: Session[];
  current: Session | null;
  scannedAt: string;
  onFocus: (id: string | null) => void;
  onOpen: (s: Session, target?: string) => void;
  onDismiss: (s: Session, dismissed: boolean) => void;
}

export function Wall({ ordered, current, scannedAt, onFocus, onOpen, onDismiss }: WallProps) {
  const keyOf = (s: Session) => {
    const i = ordered.indexOf(s);
    return i >= 0 && i < 9 ? String(i + 1) : "";
  };

  if (current !== null) {
    return (
      <div className="wstage">
        <Stage
          session={current}
          scannedAt={scannedAt}
          onOpen={onOpen}
          onDismiss={onDismiss}
          onBack={() => onFocus(null)}
        />
        <div className="wrest">
          <span className="label">El resto del muro</span>
          {ordered
            .filter((s) => s.id !== current.id)
            .map((s) => {
              const st = statusClass(s.liveStatus, s.dismissed);
              return (
                <div
                  key={s.id}
                  className={`witem st-${st}${s.dismissed || s.liveStatus === "ended" ? " faded" : ""}`}
                  onClick={() => onFocus(s.id)}
                >
                  <span className="top">
                    <span className="wkey">{keyOf(s)}</span>
                    <i className={`statusdot ${st}`} />
                    <span className="nm">{s.name}</span>
                    <span className="ago mono">{ago(s.lastActivity)}</span>
                  </span>
                  <span className="last">{lastAgentText(s)}</span>
                </div>
              );
            })}
        </div>
      </div>
    );
  }

  const live = ordered.filter(isLive);
  const quiet = ordered.filter((s) => !isLive(s));

  return (
    <div className="wall">
      {live.length > 0 && (
        <div className="wgrid">
          {live.map((s) => (
            <Tile key={s.id} s={s} keyHint={keyOf(s)} onFocus={onFocus} />
          ))}
        </div>
      )}
      {quiet.length > 0 && (
        <div className="wquiet">
          <div className="hd">
            <span className="label">Quietas y terminadas</span>
            <span className="label">{quiet.length}</span>
          </div>
          <div className="pills">
            {quiet.map((s) => {
              const st = statusClass(s.liveStatus, s.dismissed);
              return (
                <div
                  key={s.id}
                  className={`wpill${s.dismissed || s.liveStatus === "ended" ? " faded" : ""}`}
                  onClick={() => onFocus(s.id)}
                >
                  <i className={`statusdot ${st}`} />
                  <span className="nm">{s.name}</span>
                  <span className="state mono">{stateText(s)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
