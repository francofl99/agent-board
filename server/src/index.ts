import express from "express";
import chokidar from "chokidar";
import { CODEX_DIR, PROJECTS_DIR, scanAllSessions } from "./parser.js";
import {
  createColumn,
  defaultState,
  deleteColumn,
  getAllStates,
  getColumns,
  initStore,
  renameColumn,
  reorderColumns,
  upsertState,
} from "./store.js";
import type { Session } from "./types.js";

const PORT = Number(process.env.PORT ?? 4317);

async function buildSessions(): Promise<Session[]> {
  const raw = await scanAllSessions();
  const states = getAllStates();
  return raw.map((r) => ({
    ...r,
    state: states.get(r.id) ?? defaultState(r.id),
  }));
}

// --- SSE fan-out ---
const clients = new Set<express.Response>();
function broadcast(event: string): void {
  for (const res of clients) res.write(`event: ${event}\ndata: {}\n\n`);
}

async function main() {
  await initStore();

  const app = express();
  app.use(express.json());

  app.get("/api/sessions", async (_req, res) => {
    res.json(await buildSessions());
  });

  app.patch("/api/sessions/:id/state", (req, res) => {
    const { column, notes, archived, lastReadAt } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (column !== undefined) patch.column = column;
    if (notes !== undefined) patch.notes = notes;
    if (archived !== undefined) patch.archived = archived;
    if (lastReadAt !== undefined) patch.lastReadAt = lastReadAt;
    const state = upsertState(req.params.id, patch);
    broadcast("state");
    res.json(state);
  });

  app.get("/api/columns", (_req, res) => {
    res.json(getColumns());
  });

  app.post("/api/columns", (req, res) => {
    const label = String(req.body?.label ?? "").trim();
    if (label === "") return res.status(400).json({ error: "label required" });
    const col = createColumn(label);
    broadcast("columns");
    res.json(col);
  });

  app.patch("/api/columns/:id", (req, res) => {
    const label = String(req.body?.label ?? "").trim();
    if (label === "") return res.status(400).json({ error: "label required" });
    renameColumn(req.params.id, label);
    broadcast("columns");
    res.json({ ok: true });
  });

  app.delete("/api/columns/:id", (req, res) => {
    deleteColumn(req.params.id);
    broadcast("columns");
    res.json({ ok: true });
  });

  app.put("/api/columns/order", (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) return res.status(400).json({ error: "ids array required" });
    reorderColumns(ids.map(String));
    broadcast("columns");
    res.json({ ok: true });
  });

  app.get("/api/events", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    res.write(`event: hello\ndata: {}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  });

  // Watch JSONL files; debounce bursts, then tell clients to refetch.
  let timer: NodeJS.Timeout | null = null;
  chokidar
    .watch([PROJECTS_DIR, CODEX_DIR], { ignoreInitial: true, depth: 5 })
    .on("all", (_e, p) => {
      if (!p.endsWith(".jsonl")) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => broadcast("sessions"), 400);
    });

  app.listen(PORT, () => {
    console.log(`agent-board server → http://localhost:${PORT}`);
    console.log(`watching ${PROJECTS_DIR}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
