import { useEffect, useRef, useState } from "react";
import { getDetail, revealSession, saveUser } from "./api";
import { ago, clock, duration, shortModel, statusClass, tokens, usd } from "./format";
import type { DetailResponse, Session } from "./types";
import { PROVIDER_LABEL, ProviderIcon } from "./ProviderIcon";

function relative(file: string, cwd: string | null): string {
  return cwd !== null && file.startsWith(cwd + "/") ? file.slice(cwd.length + 1) : file;
}

const LIVE_LABEL: Record<string, string> = {
  waiting_input: "Esperando tu respuesta",
  working: "Trabajando",
  idle: "Inactiva",
  ended: "Terminada",
};

interface Props {
  session: Session;
  groups: string[];
  onOpen: (s: Session, target?: string) => void;
  onUserChange: (id: string, patch: { group?: string; notes?: string }) => void;
  onDismiss: (s: Session, dismissed: boolean) => void;
  onClose: () => void;
}

export function Detail({ session, groups, onOpen, onUserChange, onDismiss, onClose }: Props) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [menu, setMenu] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [notes, setNotes] = useState(session.notes);
  const notesTimer = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setMenu(false);
    setNotes(session.notes);
    getDetail(session.id).then((d) => {
      if (live) setData(d);
    });
    return () => {
      live = false;
    };
  }, [session.id]);

  // Notes are the user's own column: debounce the write, never lose it to a refresh.
  useEffect(() => {
    if (notes === session.notes) return;
    if (notesTimer.current !== null) window.clearTimeout(notesTimer.current);
    notesTimer.current = window.setTimeout(() => {
      saveUser(session.id, { notes }).then(() => onUserChange(session.id, { notes }));
    }, 500);
    return () => {
      if (notesTimer.current !== null) window.clearTimeout(notesTimer.current);
    };
  }, [notes]);

  const setGroup = (g: string) => {
    const next = session.group === g ? "" : g;
    saveUser(session.id, { group: next }).then(() => onUserChange(session.id, { group: next }));
  };

  // What the agent said is the signal. Your own prompts you already know, and tool
  // calls are the log — both are off until asked for.
  // Newest first: what the session is doing now is what you came to read.
  const timeline = (data?.timeline ?? [])
    .filter((e) => (e.kind === "tool" ? showTools : e.kind === "prompt" ? showPrompts : true))
    .reverse();

  const options = data?.openOptions ?? [];
  const primary = options.find((o) => o.target === data?.defaultTarget) ?? options[0];

  const metrics: [string, string][] = [
    ["Modelo", shortModel(session.model) || "—"],
    ["Mensajes", String(session.messageCount)],
    ["Tokens in", tokens(session.tokensIn + session.cacheReadTokens + session.cacheWriteTokens)],
    ["Tokens out", tokens(session.tokensOut)],
    ["Costo est.", usd(session.costUsd)],
    ["Duración", duration(session.startedAt, session.lastActivity)],
    ["Rama", session.gitBranch ?? "—"],
    ["Actividad", `hace ${ago(session.lastActivity)}`],
  ];

  return (
    <div className={`detail st-${statusClass(session.liveStatus, session.dismissed)}`}>
      <section>
        <div className="tags">
          <span className={`tag-prov ${session.provider}`} title={PROVIDER_LABEL[session.provider]}>
            <ProviderIcon provider={session.provider} size={13} />
          </span>
          <span className={`tag-cli ${session.client}`}>{session.client === "desktop" ? "APP" : "CLI"}</span>
          <span className={`livetag ${statusClass(session.liveStatus, session.dismissed)}`}>
            <i className={`statusdot ${statusClass(session.liveStatus, session.dismissed)}`} />
            {session.dismissed ? "Cerrada por vos" : LIVE_LABEL[session.liveStatus]}
          </span>
          <button className="close" onClick={onClose} title="Cerrar panel (Esc)">
            ✕
          </button>
        </div>
        <h1>{session.name}</h1>
        {session.processName !== "" && session.processName !== session.name && (
          <div className="id">{session.processName}{session.pid !== null ? ` · pid ${session.pid}` : ""}</div>
        )}
        <div className="id">{session.id}</div>
        <div className="id">{session.projectPath ?? session.projectSlug}</div>
      </section>

      <section>
        <div className="openbar">
          <button className="main" onClick={() => onOpen(session)}>
            Abrir en {primary?.label ?? "cliente"} <span className="kbd">⏎</span>
          </button>
          <button className="caret" onClick={() => setMenu(!menu)} title="Elegir destino">
            ▾
          </button>
        </div>
        {menu && (
          <div className="menu">
            <div className="hd label">Abrir en</div>
            {options.map((o, i) => (
              <button
                key={o.target}
                onClick={() => {
                  setMenu(false);
                  onOpen(session, o.target);
                }}
              >
                <span>{o.label}</span>
                <span className="hint">{o.hint}</span>
                <span className="kbd">{o.target === data?.defaultTarget ? "⏎" : i === 1 ? "⇧⏎" : ""}</span>
              </button>
            ))}
          </div>
        )}
        <div className="ghosts">
          <button onClick={() => navigator.clipboard.writeText(session.id)}>Copiar sessionId</button>
          <button onClick={() => revealSession(session.id)}>Revelar transcript</button>
        </div>
        <div className="ghosts">
          <button onClick={() => onDismiss(session, !session.dismissed)}>
            {session.dismissed ? "Reabrir sesión" : "Dar por cerrada"} <span className="kbd">x</span>
          </button>
        </div>
        {session.dismissed && (
          <div className="hushed" style={{ marginTop: 8, lineHeight: 1.5 }}>
            Vuelve sola a la lista en cuanto la sesión tenga actividad nueva.
          </div>
        )}
      </section>

      <div className="metrics">
        {metrics.map(([k, v]) => (
          <div key={k}>
            <div className="k">{k}</div>
            <div className="v" title={v}>{v}</div>
          </div>
        ))}
      </div>

      <section>
        <div className="rowbetween">
          <span className="label">Timeline</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className={`toggle${showPrompts ? " on" : ""}`}
              onClick={() => setShowPrompts(!showPrompts)}
            >
              tus mensajes
            </button>
            <button className={`toggle${showTools ? " on" : ""}`} onClick={() => setShowTools(!showTools)}>
              herramientas
            </button>
            <span className="hushed mono">{data === null ? "leyendo…" : `${data.totalEvents} eventos`}</span>
          </span>
        </div>
        <div className="tl">
          {timeline.slice(0, 40).map((e, i) => (
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
      </section>

      {(data?.prs.length ?? 0) > 0 && (
        <section>
          <div className="label" style={{ marginBottom: 6 }}>
            Pull requests
          </div>
          <div className="id">
            {data!.prs.map((u) => (
              <div key={u}>
                <a href={u} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>
                  {u.replace("https://github.com/", "")}
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      {(data?.files.length ?? 0) > 0 && (
        <section>
          <div className="label" style={{ marginBottom: 6 }}>
            Archivos tocados
          </div>
          <div className="filelist mono">
            {data!.files.map((f) => (
              <div key={f} title={f}>
                {relative(f, session.projectPath)}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="rowbetween">
          <span className="label">Grupo</span>
          <span className="hushed">tuyo · no se sobreescribe</span>
        </div>
        <div className="chips">
          {groups.map((g) => (
            <button key={g} className={session.group === g ? "on" : ""} onClick={() => setGroup(g)}>
              {g}
            </button>
          ))}
        </div>
        <div className="label" style={{ margin: "12px 0 6px" }}>
          Notas
        </div>
        <textarea
          className="notes"
          value={notes}
          placeholder="Qué te dejó pendiente esta sesión…"
          onChange={(e) => setNotes(e.target.value)}
        />
      </section>
    </div>
  );
}
