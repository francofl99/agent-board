import { useEffect, useState } from "react";
import { getSettings } from "./api";
import { AUTO } from "./useTheme";
import type { FleetResponse, Settings as AppSettings, Theme } from "./types";

const SHORTCUTS: [string, string][] = [
  ["Mover la selección", "↑ / ↓"],
  ["Desplegar la sesión", "Espacio"],
  ["Dar por cerrada", "x"],
  ["Buscar", "/"],
  ["Limpiar la búsqueda / volver", "Esc"],
  ["Mostrar el panel del notch", "⌘⇧A"],
];

interface Props {
  themes: Theme[];
  themesDir: string;
  themeId: string;
  onPickTheme: (id: string) => void;
  fleet: FleetResponse | null;
}

export function Settings({ themes, themesDir, themeId, onPickTheme, fleet }: Props) {
  const dark = themes.find((t) => t.id === "grafito");
  const light = themes.find((t) => t.id === "papel");
  const [cfg, setCfg] = useState<AppSettings | null>(null);

  useEffect(() => {
    getSettings().then(setCfg).catch(() => setCfg(null));
  }, []);

  const found = new Map((fleet?.paths ?? []).map((p) => [p.path, p.found]));
  const paths: [string, string][] = cfg === null
    ? []
    : [
        ["Claude", cfg.claudeProjectsDir],
        ["Claude live", cfg.claudeSessionsDir],
        ["Codex", cfg.codexDir],
        ["Codex índice", cfg.codexIndexFile],
      ];

  return (
    <div className="settings">
      <div className="inner">
        <div>
          <h2>Tema</h2>
          <div className="sub">
            Cambia toda la paleta y la tipografía de la web, el riel y el notch. No afecta los datos.
          </div>
          <div className="themegrid">
            {dark !== undefined && light !== undefined && (
              <button className={`themecard${themeId === AUTO ? " on" : ""}`} onClick={() => onPickTheme(AUTO)}>
                <span className="swatch" style={{ border: `1px solid ${dark.tokens["--line2"]}` }}>
                  <span style={{ background: dark.tokens["--page"] }} />
                  <span style={{ background: dark.tokens["--acc"] }} />
                  <span style={{ background: light.tokens["--page"] }} />
                  <span style={{ background: light.tokens["--acc"] }} />
                </span>
                <span className="nm">
                  <i />
                  Automático
                </span>
                <span className="desc">
                  Sigue la apariencia de macOS: {dark.name} con el modo oscuro, {light.name} con el claro.
                </span>
                <span className="fonts">{dark.fonts}</span>
              </button>
            )}
            {themes.map((t) => (
              <button
                key={t.id}
                className={`themecard${t.id === themeId ? " on" : ""}`}
                onClick={() => onPickTheme(t.id)}
              >
                <span className="swatch" style={{ border: `1px solid ${t.tokens["--page"]}` }}>
                  <span style={{ background: t.tokens["--page"] }} />
                  <span style={{ background: t.tokens["--bg"] }} />
                  <span style={{ background: t.tokens["--line2"] }} />
                  <span style={{ background: t.tokens["--txt"] }} />
                  <span style={{ background: t.tokens["--acc"] }} />
                </span>
                <span className="nm">
                  <i />
                  {t.name}
                </span>
                <span className="desc">{t.desc}</span>
                <span className="fonts">{t.fonts}</span>
              </button>
            ))}
          </div>
          <div className="note">
            <span style={{ flex: 1 }}>Los temas son archivos de tokens. Agregá uno nuevo y aparece acá.</span>
            <span className="path">{themesDir}</span>
          </div>
        </div>

        <div>
          <h2>Rutas de descubrimiento</h2>
          <div className="sub">Sólo lectura. Agent Board nunca escribe en estos directorios.</div>
          <div className="rows">
            {paths.map(([label, p]) => (
              <div className="r2" key={p}>
                <span>{label}</span>
                <span className="p" title={p}>{p}</span>
                <span className="n">{found.has(p) ? `${found.get(p)} archivos` : ""}</span>
              </div>
            ))}
          </div>
          <div className="note">
            <span style={{ flex: 1 }}>Se editan en el config del backend.</span>
            <span className="path">~/.agent-board/app.json</span>
          </div>
        </div>

        <div>
          <h2>Refresco</h2>
          <div className="sub">
            Escaneo cada {((cfg?.refreshMs ?? 5000) / 1000).toFixed(0)}s · el Fleet muestra lo vivo y lo
            tocado en las últimas {cfg?.fleetWindowHours ?? 24}h.
          </div>
        </div>

        <div>
          <h2>Atajos</h2>
          <div className="shortcuts">
            {SHORTCUTS.map(([label, key]) => (
              <div key={key}>
                <span style={{ flex: 1 }}>{label}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 18 }}>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--dim)" }}>
            Integraciones <span className="optional">Opcional</span>
          </h2>
          <div className="sub">
            Agent Board funciona 100% offline. El export a Notion es la única excepción: vive en{" "}
            <span className="mono">server/</span> y se corre a mano con{" "}
            <span className="mono">npm run sync</span>. Nada sale de tu máquina hasta que lo ejecutás.
          </div>
        </div>
      </div>
    </div>
  );
}
