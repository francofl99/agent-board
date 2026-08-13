import {
  archiveRow,
  createPrDatabase,
  ensurePrSchema,
  fetchExistingPrs,
  findAccessiblePage,
  loadConfig,
  persistPrDatabaseId,
  persistReviewDatabaseId,
  PR_DB_META,
  upsertPr,
} from "./notion.js";
import type { NotionConfig } from "./notion.js";
import { PR_FETCHERS } from "./prs.js";
import type { PrRole } from "./prs.js";
import { pathToFileURL } from "node:url";

const THROTTLE_MS = 350; // ~3 writes/sec, under Notion's rate limit
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Each role has its own database id in the config, persisted under its own key.
const DB_KEY: Record<PrRole, { get: (c: NotionConfig) => string; persist: (id: string) => void }> = {
  author: { get: (c) => c.prDatabaseId, persist: persistPrDatabaseId },
  reviewer: { get: (c) => c.reviewDatabaseId, persist: persistReviewDatabaseId },
};

const ROLES: PrRole[] = ["author", "reviewer"];

function setDbId(cfg: NotionConfig, role: PrRole, id: string): void {
  if (role === "author") cfg.prDatabaseId = id;
  else cfg.reviewDatabaseId = id;
}

// Create the PR databases on first run for whichever role has no id configured.
export async function ensurePrDatabase(cfg: NotionConfig): Promise<void> {
  const missing = ROLES.filter((role) => DB_KEY[role].get(cfg) === "");
  if (missing.length === 0) return;
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
    console.log(`Sin database id ni parentPageId → uso la primera página accesible: ${parent}`);
  }
  for (const role of missing) {
    const id = await createPrDatabase(cfg, parent, role);
    DB_KEY[role].persist(id);
    setDbId(cfg, role, id);
    const clean = id.replace(/-/g, "");
    console.log(
      `Base "${PR_DB_META[role].title}" creada → https://notion.so/${clean} (guardada en config)`
    );
  }
}

async function syncRole(cfg: NotionConfig, role: PrRole): Promise<string> {
  const databaseId = DB_KEY[role].get(cfg);
  const prs = await PR_FETCHERS[role]();
  await ensurePrSchema(cfg, databaseId, role);
  const existing = await fetchExistingPrs(cfg, databaseId);
  const liveUrls = new Set(prs.map((p) => p.url));
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let archived = 0;

  for (const pr of prs) {
    const outcome = await upsertPr(cfg, databaseId, pr, existing.get(pr.url));
    if (outcome === "created") created++;
    else if (outcome === "updated") updated++;
    else skipped++;
    if (outcome !== "skipped") await sleep(THROTTLE_MS);
  }

  // Trash rows that dropped out of the query: merged/closed PRs, and — for the reviewer
  // database — review requests GitHub cleared because the review was submitted.
  for (const [url, row] of existing) {
    if (liveUrls.has(url)) continue;
    await archiveRow(cfg, row.pageId);
    archived++;
    await sleep(THROTTLE_MS);
  }

  return (
    `${PR_DB_META[role].title}: ${created} creadas, ${updated} actualizadas, ` +
    `${skipped} sin cambios, ${archived} cerradas (${prs.length} abiertas)`
  );
}

export async function syncPrsOnce(cfg: NotionConfig): Promise<void> {
  const lines: string[] = [];
  for (const role of ROLES) lines.push(await syncRole(cfg, role));
  const ts = new Date().toISOString();
  console.log(`[${ts}] sync:prs · ${lines.join(" · ")}`);
}

async function main() {
  const cfg = loadConfig();
  const once = process.argv.includes("--once");
  await ensurePrDatabase(cfg);
  console.log(
    `PR sync → mine ${cfg.prDatabaseId} · review ${cfg.reviewDatabaseId} · ` +
      `intervalo ${cfg.intervalMs}ms${once ? " (once)" : ""}`
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
