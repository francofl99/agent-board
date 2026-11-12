import { useEffect, useRef, useState } from "react";
import { addNote } from "./api";
import { SOURCE_NAME, SourceIcon } from "./SourceIcon";
import type { InboxSource } from "./types";

type When = "next" | "tomorrow" | "2h";
const WHEN: [When, string][] = [
  ["next", "próxima corrida"],
  ["tomorrow", "mañana 9:00"],
  ["2h", "en 2 h"],
];

// Mirrors the server's detection, only to label the link before saving.
function detect(url: string): { source: InboxSource; ref: string } | null {
  let m = url.match(/^https?:\/\/[\w-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p\d+/i);
  if (m) return { source: "slack", ref: "hilo" };
  m = url.match(/^https?:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/i);
  if (m) return { source: "pr", ref: `${m[1]}#${m[2]}` };
  m = url.match(/^https?:\/\/[\w-]+\.atlassian\.net\/browse\/([A-Z][A-Z0-9]+-\d+)/);
  if (m) return { source: "jira", ref: m[1] };
  if (/^https?:\/\/mail\.google\.com\//i.test(url)) return { source: "mail", ref: "Gmail" };
  return null;
}

function remindAt(when: When): string {
  if (when === "next") return "";
  const t = new Date();
  if (when === "2h") t.setHours(t.getHours() + 2);
  else {
    t.setDate(t.getDate() + 1);
    t.setHours(9, 0, 0, 0);
  }
  return t.toISOString();
}

const tauri = () => (window as any).__TAURI__;
const close = () => tauri()?.core.invoke("note_close");

// The ⌘⇧A capture box. The desktop shell shows it over any app and hands it what is on the
// clipboard, so a copied Slack, GitHub, Jira or Gmail link comes attached already.
export function NoteCapture() {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [fromClipboard, setFromClipboard] = useState(false);
  const [when, setWhen] = useState<When>("next");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("note-host");
    const reset = (clip: string) => {
      const link = clip.trim();
      const known = detect(link) !== null;
      setText("");
      setUrl(known ? link : "");
      setFromClipboard(known);
      setWhen("next");
      setState("idle");
      setTimeout(() => input.current?.focus(), 0);
    };
    const un = tauri()?.event.listen("note-open", (e: { payload: string }) => reset(e.payload));
    reset("");
    return () => {
      un?.then((f: () => void) => f());
    };
  }, []);

  const save = async () => {
    if (text.trim() === "" && url === "") return;
    setState("saving");
    try {
      await addNote({ text, url, remindAt: remindAt(when) });
      setState("saved");
      setTimeout(close, 450);
    } catch {
      setState("error");
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "Enter") save();
    else if (e.key === "Tab") {
      e.preventDefault();
      const i = WHEN.findIndex(([w]) => w === when);
      setWhen(WHEN[(i + (e.shiftKey ? WHEN.length - 1 : 1)) % WHEN.length][0]);
    } else if (e.key === "Backspace" && text === "" && url !== "") {
      setUrl("");
      setFromClipboard(false);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").trim();
    if (detect(pasted) !== null) {
      e.preventDefault();
      setUrl(pasted);
      setFromClipboard(false);
    }
  };

  const link = detect(url);
  return (
    <div className="ncap" onKeyDown={onKey}>
      <div className="note-top">
        <svg className="note-pin" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 17v5M9 10.8V4h6v6.8l3 3.2H6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <label className="note-field">
          <span className="sr">Nota</span>
          <input
            ref={input}
            value={text}
            placeholder={link ? "¿Qué querés recordar de esto?" : "Anotá algo para la próxima corrida…"}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            disabled={state === "saving" || state === "saved"}
          />
        </label>
      </div>
      <div className="note-meta">
        {link ? (
          <span className={`ipill ${link.source}`}>
            <SourceIcon source={link.source} size={13} />
            {SOURCE_NAME[link.source]} · {link.ref}
            <button
              aria-label="Quitar link"
              onClick={() => {
                setUrl("");
                setFromClipboard(false);
                input.current?.focus();
              }}
            >
              ×
            </button>
          </span>
        ) : (
          <span className="note-hint">sin proveedor · pegá un link de Slack, GitHub, Jira o Gmail</span>
        )}
        {fromClipboard && <span className="note-hint">del portapapeles</span>}
        <span className="grow" />
        <div className="note-when" role="group" aria-label="Cuándo recordarlo">
          {WHEN.map(([w, label]) => (
            <button key={w} aria-pressed={when === w} tabIndex={-1} onClick={() => setWhen(w)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="note-foot">
        {state === "saved" ? (
          <span className="ok">Anotado ✓</span>
        ) : state === "error" ? (
          <span className="err">No se pudo guardar: ¿está corriendo agent-board?</span>
        ) : (
          <>
            <span>
              <b>↵</b> anotar
            </span>
            <span>
              <b>Tab</b> cuándo
            </span>
            {link && (
              <span>
                <b>⌫</b> quitar link
              </span>
            )}
            <span>
              <b>Esc</b> cerrar
            </span>
          </>
        )}
        <span className="grow" />
        <span className="mono">⌘⇧A</span>
      </div>
    </div>
  );
}
