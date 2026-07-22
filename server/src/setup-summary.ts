// Interactive setup for the optional AI summarizer. Writes the `summary` block into
// ~/.agent-board/notion.json. Run with: npm run setup:summary  (or -- --disable)
import os from "node:os";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import * as readline from "node:readline/promises";

const CONFIG_PATH = path.join(os.homedir(), ".agent-board", "notion.json");

// Providers exposing an OpenAI-compatible API. Add more here as they're supported.
const PROVIDERS: Record<string, { label: string; defaultBase: string; chatPath: string; modelsPath: string }> = {
  lmstudio: {
    label: "LM Studio",
    defaultBase: "http://localhost:1234",
    chatPath: "/v1/chat/completions",
    modelsPath: "/v1/models",
  },
};

function loadRaw(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function save(cfg: Record<string, unknown>): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

async function fetchModels(url: string): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data?.data ?? []).map((m: any) => m.id).filter((id: unknown): id is string => typeof id === "string");
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const cfg = loadRaw();

  if (process.argv.includes("--disable")) {
    delete cfg.summary;
    save(cfg);
    console.log("Resumen deshabilitado (bloque summary removido).");
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const keys = Object.keys(PROVIDERS);
    console.log("Proveedores disponibles:");
    keys.forEach((k, i) => console.log(`  ${i + 1}) ${PROVIDERS[k].label}`));
    const pick = await rl.question(`Elegí proveedor [1-${keys.length}] (1): `);
    const provider = PROVIDERS[keys[(Number(pick) || 1) - 1] ?? keys[0]];

    const base = (await rl.question(`URL base (${provider.defaultBase}): `)).trim() || provider.defaultBase;
    const chatUrl = base.replace(/\/+$/, "") + provider.chatPath;

    console.log(`Buscando modelos en ${base}${provider.modelsPath} …`);
    const models = await fetchModels(base.replace(/\/+$/, "") + provider.modelsPath);
    let model: string;
    if (models.length > 0) {
      models.forEach((m, i) => console.log(`  ${i + 1}) ${m}`));
      const mp = await rl.question(`Elegí modelo [1-${models.length}] (1): `);
      model = models[(Number(mp) || 1) - 1] ?? models[0];
    } else {
      console.log("No pude listar modelos (endpoint no responde). Ingresá el id a mano.");
      model = (await rl.question("Model id: ")).trim();
    }

    const apiKey = (await rl.question("API key (enter = ninguna): ")).trim();

    cfg.summary = { url: chatUrl, model, apiKey, timeoutMs: 20000 };
    save(cfg);
    console.log(`\nGuardado en ${CONFIG_PATH}:`);
    console.log(`  url:   ${chatUrl}`);
    console.log(`  model: ${model}`);
    console.log("Relanzá el sync para aplicar (npm run sync).");
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
