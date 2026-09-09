import { useState } from "react";
import { ago, projectName, shortModel, statusClass, statusVar, tokens, usd } from "./format";
import type { Session } from "./types";
import { PROVIDER_LABEL, ProviderIcon } from "./ProviderIcon";

interface Props {
  sessions: Session[];
  selected: string | null;
  onSelect: (id: string) => void;
}

interface ProjectNode {
  key: string;
  name: string;
  path: string;
  sessions: Session[];
  cost: number;
}

function byProject(sessions: Session[]): ProjectNode[] {
  const map = new Map<string, ProjectNode>();
  for (const s of sessions) {
    const key = s.projectPath ?? s.projectSlug;
    let n = map.get(key);
    if (n === undefined) {
      n = { key, name: projectName(s.projectPath, s.projectSlug), path: key, sessions: [], cost: 0 };
      map.set(key, n);
    }
    n.sessions.push(s);
    n.cost += s.costUsd;
  }
  return [...map.values()].sort((a, b) => b.sessions.length - a.sessions.length);
}

export function Graph({ sessions, selected, onSelect }: Props) {
  const [closed, setClosed] = useState<string[]>([]);
  // Live hand-offs are the reason to be in this view: expanded by default, chevron folds.
  const [foldedSubs, setFoldedSubs] = useState<string[]>([]);

  const projects = byProject(sessions);
  const allClosed = closed.length === projects.length;

  const toggle = (key: string) =>
    setClosed(closed.includes(key) ? closed.filter((k) => k !== key) : [...closed, key]);

  return (
    <div className="graph">
      <div className="graphbar">
        <span className="label">Jerarquía</span>
        <span className="legend">
          <span><i className="sq" />proyecto</span>
          <span className="arrow">→</span>
          <span><i className="ci" />agente</span>
          <span className="arrow">→</span>
          <span><i className="di" />sub-agente</span>
          <span className="arrow">·</span>
          <span><i className="di hollow" />tarea en background</span>
          <span className="only-live">sólo en curso</span>
        </span>
        <button
          className="toggle"
          onClick={() => setClosed(allClosed ? [] : projects.map((p) => p.key))}
        >
          {allClosed ? "Expandir todo" : "Colapsar todo"}
        </button>
        <span className="mono count">
          {projects.length} proyectos · {sessions.length} sesiones
        </span>
      </div>

      <div className="tree">
        {projects.map((p) => {
          const open = !closed.includes(p.key);
          return (
            <div className="pnode" key={p.key}>
              <button className="pcard" onClick={() => toggle(p.key)}>
                <span className="kind">
                  <span className="chev">{open ? "▾" : "▸"}</span>
                  <i className="sq" />
                  Proyecto
                </span>
                <span className="nm">{p.name}</span>
                <span className="mono path">{p.path}</span>
                <span className="mono meta">
                  <span>{p.sessions.length} sesiones</span>
                  <span>{usd(p.cost)}</span>
                </span>
              </button>

              {open && (
                <div className="kids">
                  {p.sessions.map((s) => {
                    const subsOpen = s.running.length > 0 && !foldedSubs.includes(s.id);
                    return (
                      <div className="kid" key={s.id}>
                        <div
                          className={`scard st-${statusClass(s.liveStatus, s.dismissed)}${
                            selected === s.id ? " sel" : ""
                          }`}
                          style={{ borderLeftColor: statusVar(s.liveStatus, s.dismissed) }}
                          onClick={() => onSelect(s.id)}
                        >
                          <div className="tags">
                            {s.running.length > 0 && (
                              <button
                                className="chev"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFoldedSubs(
                                    subsOpen ? [...foldedSubs, s.id] : foldedSubs.filter((x) => x !== s.id)
                                  );
                                }}
                                title={`${s.running.length} en curso`}
                              >
                                {subsOpen ? "▾" : "▸"}
                              </button>
                            )}
                            <i className={`statusdot ${statusClass(s.liveStatus, s.dismissed)}`} />
                            <span className={`tag-prov ${s.provider}`} title={PROVIDER_LABEL[s.provider]}>
                              <ProviderIcon provider={s.provider} />
                            </span>
                            <span className={`tag-cli ${s.client}`}>
                              {s.client === "desktop" ? "APP" : "CLI"}
                            </span>
                            <span style={{ flex: 1 }} />
                            {s.running.length > 0 && !subsOpen && (
                              <span className="mono kids-count">{s.running.length}</span>
                            )}
                            <span className="mono when">{ago(s.lastActivity)}</span>
                          </div>
                          <div className="nm">{s.name}</div>
                          <div className="mono meta">
                            <span>{s.gitBranch ?? "—"}</span>
                            <span>{shortModel(s.model)}</span>
                            <span>{tokens(s.tokensOut + s.cacheReadTokens + s.tokensIn)}</span>
                          </div>
                        </div>
                        {subsOpen && (
                          <div className="subs">
                            {s.running.map((w) => (
                              <div className={`sub ${w.kind}`} key={w.id}>
                                <i className="di" style={{ background: statusVar("working") }} />
                                <span className="mono nm">{w.name}</span>
                                <span className="mono kind">
                                  {w.kind === "agent" ? "sub-agente" : "background"}
                                </span>
                                <span className="mono calls">
                                  {w.startedAt === "" ? "" : `hace ${ago(w.startedAt)}`}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
