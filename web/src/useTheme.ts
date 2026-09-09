import { useEffect, useState } from "react";
import { getThemes } from "./api";
import { usePersisted } from "./persist";
import type { Theme } from "./types";

// Themes are token bags served by the backend (built-ins plus whatever JSON files
// live in ~/.agent-board/themes), applied as custom properties on the root element.
export function useTheme() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themesDir, setThemesDir] = useState("");
  const [themeId, setThemeId] = usePersisted("theme", "grafito");

  useEffect(() => {
    getThemes()
      .then((r) => {
        setThemes(r.themes);
        setThemesDir(r.dir);
      })
      .catch(() => setThemes([]));
  }, []);

  useEffect(() => {
    const theme = themes.find((t) => t.id === themeId) ?? themes[0];
    if (theme === undefined) return;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.tokens)) root.style.setProperty(k, v);
  }, [themes, themeId]);

  return { themes, themesDir, themeId, setThemeId };
}
