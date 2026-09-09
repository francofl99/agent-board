import { useState, type DragEvent } from "react";
import { ago, projectName, statusClass, statusVar } from "./format";
import type { LiveStatus, Session } from "./types";
import { PROVIDER_LABEL, ProviderIcon } from "./ProviderIcon";

const NO_GROUP = "__none__";

const STATUS_LABEL: Record<LiveStatus, string> = {
  waiting_input: "esperando respuesta",
  working: "trabajando",
  idle: "inactiva",
  ended: "terminada",
};

interface Props {
  sessions: Session[];
  groups: string[];
  selected: string | null;
  onSelect: (id: string) => void;
  onMove: (s: Session, group: string) => void;
  onAddGroup: (name: string) => void;
}

export function Board({ sessions, groups, selected, onSelect, onMove, onAddGroup }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const columns = [NO_GROUP, ...groups];
  const cardsOf = (col: string) =>
    sessions.filter((s) => (col === NO_GROUP ? s.group === "" : s.group === col));

  // The id travels in the drag payload, not only in state: a drop handler created in
  // an earlier render would otherwise read a stale `dragging`.
  const drop = (col: string, e: DragEvent) => {
    const id = e.dataTransfer.getData("text/plain") || dragging;
    const s = sessions.find((x) => x.id === id);
    if (s !== undefined) onMove(s, col === NO_GROUP ? "" : col);
    setDragging(null);
    setOver(null);
  };

  const newColumn = () => {
    const name = window.prompt("Nombre de la columna");
    if (name !== null && name.trim() !== "") onAddGroup(name.trim());
  };

  return (
    <div className="board">
      <div className="boardbar">
        <span>Columnas tuyas. El status lo sigue calculando la app.</span>
        <span style={{ flex: 1 }} />
        <button onClick={newColumn}>Nueva columna</button>
      </div>
      <div className="cols">
        {columns.map((col) => {
          const cards = cardsOf(col);
          return (
            <div
              key={col}
              className={`col${over === col ? " over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col);
              }}
              onDragLeave={() => setOver((c) => (c === col ? null : c))}
              onDrop={(e) => drop(col, e)}
            >
              <div className="colhead">
                <i />
                <b>{col === NO_GROUP ? "Sin grupo" : col}</b>
                <span style={{ flex: 1 }} />
                <span className="mono count">{cards.length}</span>
              </div>
              {cards.map((s) => (
                <div
                  key={s.id}
                  className={`card st-${statusClass(s.liveStatus, s.dismissed)}${
                    selected === s.id ? " sel" : ""
                  }${s.dismissed ? " dismissed" : ""}`}
                  style={{ borderLeftColor: statusVar(s.liveStatus, s.dismissed) }}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", s.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(s.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  onClick={() => onSelect(s.id)}
                >
                  <div className="tags">
                    <span className={`tag-prov ${s.provider}`} title={PROVIDER_LABEL[s.provider]}>
          <ProviderIcon provider={s.provider} />
        </span>
                    <span className={`tag-cli ${s.client}`}>{s.client === "desktop" ? "APP" : "CLI"}</span>
                    <span style={{ flex: 1 }} />
                    <span className="mono when">{ago(s.lastActivity)}</span>
                  </div>
                  <div className="nm">{s.name}</div>
                  <div className="mono where">
                    {projectName(s.projectPath, s.projectSlug)}
                    {s.gitBranch ? ` · ${s.gitBranch}` : ""}
                  </div>
                  <div className="st">
                    <i className={`statusdot ${statusClass(s.liveStatus, s.dismissed)}`} />
                    <span>{s.dismissed ? "cerrada por vos" : STATUS_LABEL[s.liveStatus]}</span>
                  </div>
                </div>
              ))}
              {over === col && dragging !== null && <div className="dropzone" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
