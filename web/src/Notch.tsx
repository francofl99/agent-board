import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ago } from "./format";
import { groupByStatus } from "./sessions";
import { tauri, type EdgeState } from "./shell";
import type { FleetResponse, Session } from "./types";

// A fixed-width chip plus its gap: the step of the carousel.
const CHIP = 168;
const STEP = CHIP + 6;
const PAGE_MS = 3500;
const FRESH_MS = 5000;


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
  edge: EdgeState;
  hover: boolean;
}

export function Notch({ data, error, edge, hover }: Props) {
  // Longest wait first: it sits next to the notch and the rest fan outwards.
  const { waiting, working } = groupByStatus(data?.sessions ?? []);
  const fresh = useFresh(waiting.map((s) => s.id));

  // The shell shows the window once the page reports in.
  useEffect(() => {
    tauri?.core.invoke("rail_height", { height: 32 });
  }, []);

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
