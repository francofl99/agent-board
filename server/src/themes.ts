import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./config.js";

// A theme is just a bag of CSS custom properties plus the metadata the picker needs.
// Nothing in the app reads a colour directly, so a theme file can restyle everything.
export interface Theme {
  id: string;
  name: string;
  desc: string;
  fonts: string;
  source: "built-in" | "file";
  scheme: "dark" | "light";
  tokens: Record<string, string>;
}

export const THEMES_DIR = path.join(CONFIG_DIR, "themes");

const ARCHIVO = '"Archivo", system-ui, sans-serif';
const AZERET = '"Azeret Mono", ui-monospace, monospace';
const INSTRUMENT = '"Instrument Sans", system-ui, sans-serif';
const GEIST = '"Geist Mono", ui-monospace, monospace';

const BUILT_IN: Theme[] = [
  {
    id: "grafito",
    name: "Grafito",
    desc: "Neutro frío, acento ámbar reservado para lo que pide acción.",
    fonts: "Archivo / Azeret Mono",
    source: "built-in",
    scheme: "dark",
    tokens: {
      "--sans": ARCHIVO,
      "--mono": AZERET,
      "--page": "oklch(0.135 0.006 260)",
      "--bg": "oklch(0.196 0.008 260)",
      "--bg2": "oklch(0.224 0.009 260)",
      "--bg3": "oklch(0.268 0.010 260)",
      "--line": "oklch(0.320 0.010 260)",
      "--line2": "oklch(0.400 0.012 260)",
      "--txt": "oklch(0.965 0.004 260)",
      "--dim": "oklch(0.790 0.008 260)",
      "--dim2": "oklch(0.685 0.008 260)",
      "--acc": "oklch(0.840 0.140 70)",
      "--acc-ink": "oklch(0.20 0.05 70)",
      "--acc-soft": "oklch(0.33 0.060 70)",
      "--wait": "oklch(0.860 0.145 70)",
      "--wait-ink": "oklch(0.860 0.145 70)",
      "--wait-row": "oklch(0.285 0.055 70)",
      "--wait-line": "oklch(0.46 0.10 70)",
      "--ok": "oklch(0.810 0.135 155)",
      "--ok-ink": "oklch(0.810 0.135 155)",
      "--ok-row": "oklch(0.248 0.038 155)",
      "--ok-line": "oklch(0.410 0.075 155)",
      "--idle": "oklch(0.660 0.008 260)",
      "--ended": "oklch(0.520 0.008 260)",
      "--claude": "oklch(0.815 0.120 40)",
      "--claude-bg": "oklch(0.330 0.055 40)",
      "--codex": "oklch(0.845 0.090 205)",
      "--codex-bg": "oklch(0.320 0.045 205)",
      "--sel": "oklch(0.295 0.012 260)",
    },
  },
  {
    id: "carbon",
    name: "Carbón",
    desc: "Negro cálido, acento violeta; el ámbar queda sólo para alertas.",
    fonts: "Instrument Sans / Geist Mono",
    source: "built-in",
    scheme: "dark",
    tokens: {
      "--sans": INSTRUMENT,
      "--mono": GEIST,
      "--page": "oklch(0.128 0.004 60)",
      "--bg": "oklch(0.185 0.005 60)",
      "--bg2": "oklch(0.218 0.006 60)",
      "--bg3": "oklch(0.262 0.007 60)",
      "--line": "oklch(0.315 0.006 60)",
      "--line2": "oklch(0.392 0.008 60)",
      "--txt": "oklch(0.968 0.004 85)",
      "--dim": "oklch(0.795 0.006 70)",
      "--dim2": "oklch(0.690 0.006 70)",
      "--acc": "oklch(0.770 0.150 300)",
      "--acc-ink": "oklch(0.16 0.04 300)",
      "--acc-soft": "oklch(0.315 0.070 300)",
      "--wait": "oklch(0.860 0.145 55)",
      "--wait-ink": "oklch(0.860 0.145 55)",
      "--wait-row": "oklch(0.275 0.055 55)",
      "--wait-line": "oklch(0.46 0.10 55)",
      "--ok": "oklch(0.815 0.125 160)",
      "--ok-ink": "oklch(0.815 0.125 160)",
      "--ok-row": "oklch(0.238 0.034 160)",
      "--ok-line": "oklch(0.405 0.070 160)",
      "--idle": "oklch(0.660 0.006 70)",
      "--ended": "oklch(0.520 0.006 70)",
      "--claude": "oklch(0.820 0.115 35)",
      "--claude-bg": "oklch(0.325 0.055 35)",
      "--codex": "oklch(0.850 0.080 195)",
      "--codex-bg": "oklch(0.315 0.042 195)",
      "--sel": "oklch(0.288 0.008 60)",
    },
  },
  {
    id: "hielo",
    name: "Hielo",
    desc: "Azul-gris desaturado, contraste medio. El más calmo de todos.",
    fonts: "Instrument Sans / Geist Mono",
    source: "built-in",
    scheme: "dark",
    tokens: {
      "--sans": INSTRUMENT,
      "--mono": GEIST,
      "--page": "oklch(0.170 0.014 235)",
      "--bg": "oklch(0.218 0.016 235)",
      "--bg2": "oklch(0.248 0.018 235)",
      "--bg3": "oklch(0.292 0.020 235)",
      "--line": "oklch(0.340 0.022 235)",
      "--line2": "oklch(0.420 0.026 235)",
      "--txt": "oklch(0.960 0.008 235)",
      "--dim": "oklch(0.805 0.014 235)",
      "--dim2": "oklch(0.712 0.016 235)",
      "--acc": "oklch(0.800 0.085 225)",
      "--acc-ink": "oklch(0.18 0.03 230)",
      "--acc-soft": "oklch(0.335 0.045 228)",
      "--wait": "oklch(0.855 0.130 70)",
      "--wait-ink": "oklch(0.855 0.130 70)",
      "--wait-row": "oklch(0.295 0.055 70)",
      "--wait-line": "oklch(0.460 0.095 70)",
      "--ok": "oklch(0.800 0.090 165)",
      "--ok-ink": "oklch(0.800 0.090 165)",
      "--ok-row": "oklch(0.268 0.030 165)",
      "--ok-line": "oklch(0.425 0.060 165)",
      "--idle": "oklch(0.680 0.014 235)",
      "--ended": "oklch(0.545 0.014 235)",
      "--claude": "oklch(0.820 0.100 40)",
      "--claude-bg": "oklch(0.325 0.048 40)",
      "--codex": "oklch(0.840 0.070 200)",
      "--codex-bg": "oklch(0.320 0.038 200)",
      "--sel": "oklch(0.305 0.020 235)",
    },
  },
  {
    id: "papel",
    name: "Papel",
    desc: "Claro, casi blanco. Se destaca sobre apps oscuras; el ámbar pasa a texto oscuro.",
    fonts: "Archivo / Azeret Mono",
    source: "built-in",
    scheme: "light",
    tokens: {
      "--sans": ARCHIVO,
      "--mono": AZERET,
      "--page": "oklch(0.995 0.002 90)",
      "--bg": "oklch(0.988 0.003 90)",
      "--bg2": "oklch(0.972 0.004 90)",
      "--bg3": "oklch(0.945 0.005 260)",
      "--line": "oklch(0.910 0.004 260)",
      "--line2": "oklch(0.850 0.006 260)",
      "--txt": "oklch(0.200 0.010 260)",
      "--dim": "oklch(0.400 0.010 260)",
      "--dim2": "oklch(0.550 0.010 260)",
      "--acc": "oklch(0.220 0.010 260)",
      "--acc-ink": "oklch(0.990 0 0)",
      "--acc-soft": "oklch(0.930 0.004 260)",
      "--wait": "oklch(0.760 0.170 65)",
      "--wait-ink": "oklch(0.520 0.150 58)",
      "--wait-row": "oklch(0.970 0.040 85)",
      "--wait-line": "oklch(0.860 0.090 78)",
      "--ok": "oklch(0.620 0.160 155)",
      "--ok-ink": "oklch(0.450 0.120 155)",
      "--ok-row": "oklch(0.970 0.025 155)",
      "--ok-line": "oklch(0.870 0.060 155)",
      "--idle": "oklch(0.620 0.010 260)",
      "--ended": "oklch(0.720 0.008 260)",
      "--claude": "oklch(0.500 0.140 40)",
      "--claude-bg": "oklch(0.930 0.040 40)",
      "--codex": "oklch(0.480 0.090 215)",
      "--codex-bg": "oklch(0.930 0.030 205)",
      "--sel": "oklch(0.930 0.020 70)",
    },
  },
];

// Only "--*" keys are kept: a theme file must not be able to inject anything but
// custom properties into the page's style attribute.
function sanitize(tokens: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (tokens === null || typeof tokens !== "object") return out;
  for (const [k, v] of Object.entries(tokens as Record<string, unknown>)) {
    if (k.startsWith("--") && typeof v === "string" && !v.includes(";")) out[k] = v;
  }
  return out;
}

export async function loadThemes(): Promise<Theme[]> {
  const files = await fs.readdir(THEMES_DIR).catch(() => [] as string[]);
  const extra: Theme[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const raw = await fs.readFile(path.join(THEMES_DIR, f), "utf8").catch(() => "");
    try {
      const o = JSON.parse(raw);
      const id = typeof o.id === "string" ? o.id : path.basename(f, ".json");
      extra.push({
        id,
        name: typeof o.name === "string" ? o.name : id,
        desc: typeof o.desc === "string" ? o.desc : "",
        fonts: typeof o.fonts === "string" ? o.fonts : "",
        source: "file",
        scheme: o.scheme === "light" ? "light" : "dark",
        // A file theme starts from Grafito, so a partial file only overrides what it names.
        tokens: { ...BUILT_IN[0].tokens, ...sanitize(o.tokens) },
      });
    } catch {
      continue;
    }
  }
  return [...BUILT_IN, ...extra];
}
