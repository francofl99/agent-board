import { scanAllSessions } from "./parser.js";
import {
  archiveRow,
  createDatabase,
  createRow,
  fetchExisting,
  findAccessiblePage,
  loadConfig,
  PAGE_ICON,
  persistDatabaseId,
  reconcile,
  shouldSync,
  updateRow,
} from "./notion.js";
import type { NotionConfig } from "./notion.js";
import { summarize } from "./summarizer.js";
import type { RawSession } from "./types.js";

// Generate a summary only when the feature is on and the agent just added a message.
async function maybeSummarize(
  cfg: NotionConfig,
  s: RawSession,
  storedMessages: number | undefined
): Promise<string | undefined> {
  if (cfg.summary === null) return undefined;
  if (s.lastMessageRole !== "assistant") return undefined;
  if (s.messageCount === storedMessages) return undefined; // no new message → keep existing
  const text = await summarize(cfg.summary, s.recentMessages);
  return text === null ? undefined : `📝 ${text}`;
}

const THROTTLE_MS = 350; // ~3 writes/sec, under Notion's rate limit

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runOnce(cfg: NotionConfig): Promise<void> {
  const all = await scanAllSessions();
  const sessions = all.filter((s) => shouldSync(s, cfg));
  const keptIds = new Set(sessions.map((s) => s.id));
  const existing = await fetchExisting(cfg);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let archived = 0;

  for (const s of sessions) {
    const row = existing.get(s.id);
    if (!row) {
      const summary = await maybeSummarize(cfg, s, undefined);
      await createRow(cfg, s, summary ?? "");
      created++;
      await sleep(THROTTLE_MS);
    } else {
      const newSummary = await maybeSummarize(cfg, s, row.owned.messages);
      const { changed, owned } = reconcile(row.owned, s, newSummary);
      if (changed) {
        await updateRow(cfg, row.pageId, owned, PAGE_ICON[s.provider]);
        updated++;
        await sleep(THROTTLE_MS);
      } else {
        skipped++;
      }
    }
  }

  // Trash rows that no longer pass the filter, freeing workspace blocks.
  for (const [sid, row] of existing) {
    if (keptIds.has(sid)) continue;
    await archiveRow(cfg, row.pageId);
    archived++;
    await sleep(THROTTLE_MS);
  }

  const ts = new Date().toISOString();
  console.log(
    `[${ts}] sync: ${created} creadas, ${updated} actualizadas, ` +
      `${skipped} sin cambios, ${archived} archivadas (${sessions.length}/${all.length} en filtro)`
  );
}

// --providers claude,codex  or  --providers=claude
function providersFromArgv(): NotionConfig["providers"] | undefined {
  const i = process.argv.findIndex((a) => a === "--providers" || a.startsWith("--providers="));
  if (i === -1) return undefined;
  const arg = process.argv[i];
  const val = arg.includes("=") ? arg.split("=")[1] : process.argv[i + 1];
  if (!val) return undefined;
  const list = val
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p === "claude" || p === "codex" || p === "opencode");
  return list.length > 0 ? (list as NotionConfig["providers"]) : undefined;
}

// Create the database on first run when no databaseId is configured.
async function ensureDatabase(cfg: NotionConfig): Promise<void> {
  if (cfg.databaseId !== "") return;
  let parent = cfg.parentPageId;
  if (parent === "") {
    const found = await findAccessiblePage(cfg);
    if (!found) {
      throw new Error(
        "No database and no accessible page. Share one page with the integration " +
          "(Notion → ••• → Connections), then run again. Optionally set parentPageId in config."
      );
    }
    parent = found;
    console.log(`Sin databaseId ni parentPageId → uso la primera página accesible: ${parent}`);
  }
  const id = await createDatabase(cfg, parent);
  persistDatabaseId(id);
  cfg.databaseId = id;
  const clean = id.replace(/-/g, "");
  console.log(`Base creada → https://notion.so/${clean} (guardada en config)`);
  console.log("Vistas recomendadas (crealas en Notion — la API REST no crea vistas):");
  console.log("  • Estado: Board agrupado por Status");
  console.log("  • Usage: Table agrupada por Modelo, orden Tokens desc");
  console.log("  • Usage chart: Bar, sum(Tokens) por Modelo");
  console.log("  Ver README → 'Recommended views'.");
}

async function main() {
  const cfg = loadConfig();
  const cliProviders = providersFromArgv();
  if (cliProviders !== undefined) cfg.providers = cliProviders;
  const once = process.argv.includes("--once");
  await ensureDatabase(cfg);
  const provLabel = cfg.providers ? cfg.providers.join(",") : "todos";
  const sumLabel = cfg.summary ? `on (${cfg.summary.model || "?"})` : "off";
  console.log(
    `Notion sync → db ${cfg.databaseId} · proveedores ${provLabel} · ` +
      `resumen ${sumLabel} · intervalo ${cfg.intervalMs}ms${once ? " (once)" : ""}`
  );

  for (;;) {
    try {
      await runOnce(cfg);
    } catch (e) {
      console.error("sync error:", (e as Error).message);
    }
    if (once) break;
    await sleep(cfg.intervalMs);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
