import {
  createPrDatabase,
  fetchExistingPrs,
  findAccessiblePage,
  loadConfig,
  persistPrDatabaseId,
  upsertPr,
  archiveRow,
} from "./notion.js";
import type { NotionConfig } from "./notion.js";
import { fetchMyOpenPrs } from "./prs.js";
import { pathToFileURL } from "node:url";

const THROTTLE_MS = 350; // ~3 writes/sec, under Notion's rate limit
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Create the "My PRs" database on first run when no prDatabaseId is configured.
export async function ensurePrDatabase(cfg: NotionConfig): Promise<void> {
  if (cfg.prDatabaseId !== "") return;
  let parent = cfg.parentPageId;
  if (parent === "") {
    const found = await findAccessiblePage(cfg);
    if (!found) {
      throw new Error(
        "No PR database and no accessible page. Share one page with the integration, " +
          "then run again. Optionally set parentPageId in config."
      );
    }
    parent = found;
    console.log(`Sin prDatabaseId ni parentPageId → uso la primera página accesible: ${parent}`);
  }
  const id = await createPrDatabase(cfg, parent);
  persistPrDatabaseId(id);
  cfg.prDatabaseId = id;
  const clean = id.replace(/-/g, "");
  console.log(`Base "My PRs" creada → https://notion.so/${clean} (guardada en config)`);
}

export async function syncPrsOnce(cfg: NotionConfig): Promise<void> {
  const prs = await fetchMyOpenPrs();
  const existing = await fetchExistingPrs(cfg);
  const liveUrls = new Set(prs.map((p) => p.url));
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let archived = 0;

  for (const pr of prs) {
    const outcome = await upsertPr(cfg, pr, existing.get(pr.url));
    if (outcome === "created") created++;
    else if (outcome === "updated") updated++;
    else skipped++;
    if (outcome !== "skipped") await sleep(THROTTLE_MS);
  }

  // Trash rows for PRs that are no longer open (merged/closed).
  for (const [url, row] of existing) {
    if (liveUrls.has(url)) continue;
    await archiveRow(cfg, row.pageId);
    archived++;
    await sleep(THROTTLE_MS);
  }

  const ts = new Date().toISOString();
  console.log(
    `[${ts}] sync:prs: ${created} creadas, ${updated} actualizadas, ` +
      `${skipped} sin cambios, ${archived} cerradas (${prs.length} abiertas)`
  );
}

async function main() {
  const cfg = loadConfig();
  const once = process.argv.includes("--once");
  await ensurePrDatabase(cfg);
  console.log(
    `PR sync → db ${cfg.prDatabaseId} · intervalo ${cfg.intervalMs}ms${once ? " (once)" : ""}`
  );

  for (;;) {
    try {
      await syncPrsOnce(cfg);
    } catch (e) {
      console.error("sync:prs error:", (e as Error).message);
    }
    if (once) break;
    await sleep(cfg.intervalMs);
  }
}

// Run the loop only when invoked directly — not when sync.ts imports the helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
