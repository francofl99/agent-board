import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getFleet, openSession } from "./api";
import { ago, statusClass } from "./format";
import { Notch } from "./Notch";
import { tauri, type EdgeState } from "./shell";
import { useTheme } from "./useTheme";
import { lastAgentText, runningSummary, wallOrder } from "./Wall";
import type { FleetResponse, Session } from "./types";

const isLive = (s: Session) => !s.dismissed && (s.liveStatus === "waiting_input" || s.liveStatus === "working");

function trayTitle(waiting: number, working: number): string {
  if (waiting === 0 && working === 0) return "AB";
  return [waiting > 0 ? `⏳${waiting}` : "", working > 0 ? `⚙︎${working}` : ""].filter(Boolean).join(" ");
}

function Row({ s, opening, onOpen }: { s: Session; opening: boolean; onOpen: (s: Session) => void }) {
  const st = statusClass(s.liveStatus, s.dismissed);
  const running = runningSummary(s);
  return (
    <button className={`rrow st-${st}`} onClick={() => onOpen(s)} title="Abrir en su cliente">
      <span className="top">
        <i className={`statusdot ${st}`} />
        <span className="nm">{s.name}</span>
        <span className="ago mono">{opening ? "abriendo…" : ago(s.lastActivity)}</span>
      </span>
      {running !== "" && <span className="run mono">◆ {running}</span>}
      <span className="last">{lastAgentText(s)}</span>
    </button>
  );
}

// The always-on-top strip of the desktop shell. Collapsed it is a column of status
// dots; the shell widens it while the cursor is over it and reports that here.
// Browser-only preview of the notch modes, which otherwise need the desktop shell:
// ?rail&notch=bar | wings | panel
const preview = tauri === undefined ? new URLSearchParams(location.search).get("notch") : null;

export function Rail() {
  useTheme();
  const [data, setData] = useState<FleetResponse | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(tauri === undefined && (preview === null || preview === "panel"));
  const [opening, setOpening] = useState<string | null>(null);
  const [edge, setEdge] = useState<EdgeState>(
    preview === null ? { edge: "right", full: false, notchWidth: 0 } : { edge: "notch", full: preview !== "wings", notchWidth: 186 }
  );
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const reload = () => getFleet().then(setData, () => {});

  useEffect(() => {
    let stop = false;
    let timer: number;
    const tick = async () => {
      let next = 5000;
      try {
        const d = await getFleet();
        if (!stop) {
          setData(d);
          setError("");
        }
        next = d.refreshMs;
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

  useEffect(() => {
    if (tauri === undefined) return;
    document.documentElement.classList.add("shell");
    const sync = () => tauri!.core.invoke("rail_edge").then((s) => setEdge(s as EdgeState));
    sync();
    const offs = [
      tauri.event.listen("rail-expanded", (e) => setExpanded(e.payload === true)),
      tauri.event.listen("rail-edge", sync),
      tauri.event.listen("rail-full", sync),
      tauri.event.listen("rail-hover", (e) => setHover(e.payload === true)),
    ];
    return () => {
      offs.forEach((off) => off.then((f) => f()));
    };
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle("edge-left", edge.edge === "left");
    html.classList.toggle("edge-notch", edge.edge === "notch");
  }, [edge.edge]);

  // Esc folds the rail when the shortcut opened it with the keyboard.
  useEffect(() => {
    if (edge.edge === "notch" || !expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && tauri?.core.invoke("rail_collapse");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edge.edge, expanded]);

  // The shell moves the window while the button is held and snaps it to the nearest
  // edge of the monitor it is dropped on.
  const drag = (e: MouseEvent) => {
    if (e.button !== 0 || tauri === undefined) return;
    e.preventDefault();
    tauri.core.invoke("rail_drag");
  };

  const live = wallOrder((data?.sessions ?? []).filter(isLive));
  const waiting = live.filter((s) => s.liveStatus === "waiting_input");
  const working = live.filter((s) => s.liveStatus === "working");
  const quiet = (data?.sessions.length ?? 0) - live.length;

  useEffect(() => {
    tauri?.core.invoke("set_tray_title", { title: trayTitle(waiting.length, working.length) });
  }, [waiting.length, working.length]);

  // The shell sizes the window to the content, so the strip never covers more of the
  // screen edge than it needs.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || tauri === undefined) return;
    const report = () => tauri!.core.invoke("rail_height", { height: Math.ceil(el.offsetHeight) });
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  const open = async (s: Session) => {
    setOpening(s.id);
    try {
      await openSession(s.id, "");
    } finally {
      window.setTimeout(() => setOpening(null), 1500);
    }
  };

  if (edge.edge === "notch") {
    return <Notch data={data} error={error} expanded={expanded} edge={edge} hover={hover} reload={reload} />;
  }

  if (!expanded) {
    return (
      <div className="strip collapsed" ref={ref}>
        {error !== "" ? (
          <i className="statusdot ended" title={`sin backend — ${error}`} />
        ) : (
          <>
            <b className="n wait" title="Esperan tu respuesta">{waiting.length}</b>
            <b className="n work" title="Trabajando">{working.length}</b>
            {live.length > 0 && <span className="sep" />}
            {live.map((s) => (
              <i key={s.id} className={`statusdot ${s.liveStatus}`} title={s.name} />
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="strip" ref={ref}>
      <div className="rhead" onMouseDown={drag} title="Arrastrá para moverlo a otro borde o monitor">
        <img src="/logo.png" alt="" width="16" height="16" />
        <b>Agent Board</b>
        <span className="mono counts">
          <span className="wait">{waiting.length} esperan</span> · <span className="work">{working.length} trabajan</span>
        </span>
      </div>
      {error !== "" ? (
        <div className="rempty">
          Sin backend. Levantá el server con <span className="mono">npm run serve</span>.
        </div>
      ) : live.length === 0 ? (
        <div className="rempty">{data === null ? "escaneando…" : "Ningún agente activo."}</div>
      ) : (
        <>
          {waiting.length > 0 && <div className="label rsec">Esperan tu respuesta</div>}
          {waiting.map((s) => (
            <Row key={s.id} s={s} opening={opening === s.id} onOpen={open} />
          ))}
          {working.length > 0 && <div className="label rsec">Trabajando</div>}
          {working.map((s) => (
            <Row key={s.id} s={s} opening={opening === s.id} onOpen={open} />
          ))}
        </>
      )}
      <div className="rfoot mono">
        <span>{quiet} quietas</span>
        <span>{data === null ? "" : `hace ${ago(data.scannedAt)}`}</span>
      </div>
    </div>
  );
}
