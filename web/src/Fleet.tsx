import type { Session } from "./types";
import { PROVIDER_LABEL, ProviderIcon } from "./ProviderIcon";
import { ago, projectName, shortModel, statusClass, tokens, usd } from "./format";

export interface Group {
  key: string;
  label: string;
  sub: string;
  rows: Session[];
}

const STATUS_LABEL: Record<string, string> = {
  waiting_input: "Esperando input",
  working: "Trabajando",
  idle: "Inactivas",
  ended: "Terminadas",
  dismissed: "Cerradas por vos",
};

export function groupSessions(list: Session[], by: "project" | "provider" | "status"): Group[] {
  const map = new Map<string, Group>();
  for (const s of list) {
    const status = s.dismissed ? "dismissed" : s.liveStatus;
    const key =
      by === "project" ? s.projectPath ?? s.projectSlug : by === "provider" ? `${s.provider}·${s.client}` : status;
    let g = map.get(key);
    if (g === undefined) {
      g = {
        key,
        label:
          by === "project"
            ? projectName(s.projectPath, s.projectSlug)
            : by === "provider"
              ? `${s.provider === "claude" ? "Claude Code" : "Codex"} · ${s.client === "desktop" ? "Desktop" : "CLI"}`
              : STATUS_LABEL[status] ?? status,
        sub: by === "project" ? s.projectPath ?? "" : "",
        rows: [],
      };
      map.set(key, g);
    }
    g.rows.push(s);
  }
  const groups = [...map.values()];
  if (by === "status") {
    const order = ["waiting_input", "working", "idle", "ended", "dismissed"];
    groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  } else {
    groups.sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
  }
  return groups;
}

interface RowProps {
  s: Session;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (s: Session) => void;
  onDismiss: (s: Session, dismissed: boolean) => void;
}

function Row({ s, selected, onSelect, onOpen, onDismiss }: RowProps) {
  const waiting = s.liveStatus === "waiting_input" && !s.dismissed;
  const pr = s.pullRequests.length > 0 ? `PR ${s.pullRequests[0].split("/").pop()}` : "";
  return (
    <div
      className={`grid row st-${statusClass(s.liveStatus, s.dismissed)}${selected ? " sel" : ""}${
        waiting ? " waiting" : ""
      }${s.dismissed ? " dismissed" : ""}`}
      onClick={() => onSelect(s.id)}
      onDoubleClick={() => onOpen(s)}
      data-row={s.id}
    >
      <span>
        <i className={`statusdot ${statusClass(s.liveStatus, s.dismissed)}`} />
      </span>
      <span className="tags origin">
        <span className={`tag-prov ${s.provider}`} title={PROVIDER_LABEL[s.provider]}>
          <ProviderIcon provider={s.provider} />
        </span>
        <span className={`tag-cli ${s.client}`}>{s.client === "desktop" ? "APP" : "CLI"}</span>
      </span>
      <span className="tags" style={{ minWidth: 0 }}>
        <span className="name">{s.name}</span>
        {pr !== "" && <span className="pr">{pr}</span>}
      </span>
      <span className="m project col-project">
        {projectName(s.projectPath, s.projectSlug)}
        {s.gitBranch ? ` · ${s.gitBranch}` : ""}
      </span>
      <span className="m col-model">{shortModel(s.model)}</span>
      <span className="m r col-msg">{s.messageCount}</span>
      <span className="m r col-tokens">
        {tokens(s.tokensOut + s.cacheReadTokens + s.cacheWriteTokens + s.tokensIn)}
      </span>
      <span className="m cost r col-cost">{usd(s.costUsd)}</span>
      <span className="act">
        <span className="m ago" style={{ color: waiting ? "var(--wait-ink)" : undefined }}>
          {ago(s.lastActivity)}
        </span>
        <span className="actions">
          <button
            className="open"
            title="Abrir en su cliente (⏎)"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(s.id); // opening from the row also brings its detail into view
              onOpen(s);
            }}
          >
            Abrir
          </button>
          <button
            className="dismiss"
            title={s.dismissed ? "Reabrir esta sesión (x)" : "Dar por cerrada (x)"}
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(s, !s.dismissed);
            }}
          >
            {s.dismissed ? "↺" : "✓"}
          </button>
        </span>
      </span>
    </div>
  );
}

interface FleetProps {
  groups: Group[];
  selected: string | null;
  onSelect: (id: string) => void;
  onOpen: (s: Session) => void;
  onDismiss: (s: Session, dismissed: boolean) => void;
}

export function Fleet({ groups, selected, onSelect, onOpen, onDismiss }: FleetProps) {
  return (
    <div className="listinner">
      <div className="grid head">
        <span />
        <span className="tags origin">Origen</span>
        <span>Sesión</span>
        <span className="col-project">Proyecto · rama</span>
        <span className="col-model">Modelo</span>
        <span className="r col-msg">Msg</span>
        <span className="r col-tokens">Tokens</span>
        <span className="r col-cost">Costo</span>
        <span className="r">Actividad</span>
      </div>
      {groups.map((g) => (
        <div key={g.key}>
          <div className="grouphead">
            <b>{g.label}</b>
            <span className="sub">{g.sub}</span>
            <span style={{ flex: 1 }} />
            <span className="count">{g.rows.length}</span>
          </div>
          {g.rows.map((s) => (
            <Row
              key={s.id}
              s={s}
              selected={selected === s.id}
              onSelect={onSelect}
              onOpen={onOpen}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <div className="empty">
      <div className="box" />
      <h2>Ninguna sesión coincide</h2>
      <p>Hay sesiones detectadas, pero ninguna pasa los filtros activos.</p>
      <div className="chips">
        <button onClick={onClear}>Limpiar filtros</button>
      </div>
    </div>
  );
}

interface EmptyProps {
  paths: { path: string; found: number }[];
  scannedAt: string;
}

export function Empty({ paths, scannedAt }: EmptyProps) {
  return (
    <div className="empty">
      <div className="box" />
      <h2>No se detectaron sesiones</h2>
      <p>Agent Board sólo lee archivos locales. Estas son las rutas que escaneó hace {ago(scannedAt)}:</p>
      <div className="paths">
        {paths.map((p) => (
          <div key={p.path} style={{ display: "flex", gap: 10 }}>
            <span style={{ color: "var(--ended)" }}>·</span>
            <span>{p.path}</span>
            <span style={{ color: "var(--ended)" }}>{p.found} archivos</span>
          </div>
        ))}
      </div>
    </div>
  );
}
