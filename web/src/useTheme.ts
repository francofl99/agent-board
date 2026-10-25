import { useEffect, useState } from "react";
import { getThemes, saveTheme } from "./api";
import type { Theme } from "./types";

export const AUTO = "auto";
const DARK_DEFAULT = "grafito";
const LIGHT_DEFAULT = "papel";
// The rail and the notch never take focus, so a choice made in the web app reaches
// them on this poll rather than on a focus event.
const SYNC_MS = 15_000;

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

// Themes are token bags served by the backend (built-ins plus whatever JSON files
// live in ~/.agent-board/themes), applied as custom properties on the root element.
// The choice lives in ~/.agent-board/app.json so the browser and the desktop shell,
// which are different origins, share it.
export function useTheme() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themesDir, setThemesDir] = useState("");
  const [themeId, setThemeIdState] = useState(AUTO);
  const [systemDark, setSystemDark] = useState(() => darkQuery().matches);

  useEffect(() => {
    let stop = false;
    const load = () =>
      getThemes()
        .then((r) => {
          if (stop) return;
          setThemes(r.themes);
          setThemesDir(r.dir);
          setThemeIdState(r.selected || AUTO);
        })
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, SYNC_MS);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const q = darkQuery();
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    q.addEventListener("change", onChange);
    return () => q.removeEventListener("change", onChange);
  }, []);

  const resolvedId = themeId === AUTO ? (systemDark ? DARK_DEFAULT : LIGHT_DEFAULT) : themeId;

  useEffect(() => {
    const theme = themes.find((t) => t.id === resolvedId) ?? themes[0];
    if (theme === undefined) return;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.tokens)) root.style.setProperty(k, v);
    root.style.colorScheme = theme.scheme;
  }, [themes, resolvedId]);

  const setThemeId = (id: string) => {
    setThemeIdState(id);
    saveTheme(id).catch(() => undefined);
  };

  return { themes, themesDir, themeId, resolvedId, setThemeId };
}
