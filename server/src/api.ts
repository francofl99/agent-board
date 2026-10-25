import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppConfig, saveAppConfig } from "./config.js";
import { scanFleet } from "./fleet.js";
import { defaultTarget, openSession, optionsFor, revealFile, type OpenTarget } from "./open.js";
import { readTranscript } from "./timeline.js";
import { addGroup, knownGroups, saveUserData } from "./store.js";
import { loadThemes, THEMES_DIR } from "./themes.js";
import { prStatus } from "./prs.js";
import type { ScanResult } from "./fleet.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "..", "web", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

// The Fleet poll and a detail request that follows it would otherwise scan the same
// transcripts twice within milliseconds.
let last: { at: number; result: ScanResult } | null = null;
const SCAN_TTL_MS = 1000;

async function scan(): Promise<ScanResult> {
  if (last !== null && Date.now() - last.at < SCAN_TTL_MS) return last.result;
  const result = await scanFleet(await loadAppConfig());
  last = { at: Date.now(), result };
  return result;
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

async function serveStatic(url: string, res: http.ServerResponse): Promise<void> {
  const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
  const file = path.join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR)) {
    res.writeHead(403).end();
    return;
  }
  const st = await fs.stat(file).catch(() => null);
  if (st === null || !st.isFile()) {
    const index = path.join(WEB_DIR, "index.html");
    if (await fs.stat(index).catch(() => null)) {
      res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
      createReadStream(index).pipe(res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("UI not built — run `npm run build` in web/, or use the Vite dev server.");
    return;
  }
  // The entry document must never come from cache, or a rebuilt UI keeps serving the
  // previous bundle; the hashed assets it points at are safe to cache.
  const cache = rel === "index.html" ? "no-store" : "public, max-age=31536000, immutable";
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "cache-control": cache,
  });
  createReadStream(file).pipe(res);
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  res.setHeader("access-control-allow-origin", "*"); // the Vite dev server is another origin
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (!p.startsWith("/api/")) {
    await serveStatic(p, res);
    return;
  }

  if (p === "/api/fleet" && req.method === "GET") {
    const [result, groups, cfg] = await Promise.all([scan(), knownGroups(), loadAppConfig()]);
    json(res, 200, { ...result, groups, refreshMs: cfg.refreshMs });
    return;
  }

  if (p === "/api/groups" && req.method === "POST") {
    const body = await readBody(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") {
      json(res, 400, { error: "name required" });
      return;
    }
    json(res, 200, { groups: await addGroup(name) });
    return;
  }

  if (p === "/api/themes" && req.method === "GET") {
    const [themes, cfg] = await Promise.all([loadThemes(), loadAppConfig()]);
    json(res, 200, { themes, dir: THEMES_DIR, selected: cfg.theme });
    return;
  }

  if (p === "/api/settings") {
    if (req.method === "GET") {
      json(res, 200, await loadAppConfig());
      return;
    }
    if (req.method === "PATCH") {
      json(res, 200, await saveAppConfig(await readBody(req)));
      return;
    }
  }

  const m = p.match(/^\/api\/sessions\/([^/]+)(\/[a-z]+)?$/);
  if (m !== null) {
    const id = decodeURIComponent(m[1]);
    const action = m[2] ?? "";
    const { sessions } = await scan();
    const s = sessions.find((x) => x.id === id);
    if (s === undefined) {
      json(res, 404, { error: "session not found" });
      return;
    }

    if (action === "" && req.method === "GET") {
      const t = await readTranscript(s.filePath, s.provider);
      json(res, 200, {
        session: s,
        timeline: t.events,
        totalEvents: t.totalEvents,
        files: t.files,
        prs: t.prs,
        openOptions: optionsFor(s.provider, s.id),
        defaultTarget: defaultTarget(s.provider, s.client),
      });
      return;
    }

    if (action === "/user" && req.method === "PATCH") {
      const body = await readBody(req);
      const saved = await saveUserData(id, {
        ...(typeof body.group === "string" ? { group: body.group } : {}),
        ...(typeof body.notes === "string" ? { notes: body.notes } : {}),
        // Stamped against the session's last activity, so a reply reopens it.
        ...(typeof body.dismissed === "boolean"
          ? { dismissedAt: body.dismissed ? s.lastActivity : "" }
          : {}),
      });
      last = null; // the next scan must re-read what the user just wrote
      json(res, 200, saved);
      return;
    }

    if (action === "/open" && req.method === "POST") {
      const body = await readBody(req);
      const target: OpenTarget = body.target ?? defaultTarget(s.provider, s.client);
      try {
        const ran = await openSession(target, s.id, s.projectPath ?? "");
        json(res, 200, { ok: true, ran });
      } catch (e) {
        json(res, 500, { ok: false, error: (e as Error).message });
      }
      return;
    }

    // Most recent last in the transcript; the panel only has room for a few.
    if (action === "/prs" && req.method === "GET") {
      const urls = [...new Set(s.pullRequests)].slice(-3).reverse();
      const statuses = await Promise.all(urls.map(prStatus));
      json(res, 200, { prs: statuses.filter((x) => x !== null) });
      return;
    }

    if (action === "/reveal" && req.method === "POST") {
      await revealFile(s.filePath);
      json(res, 200, { ok: true });
      return;
    }
  }

  json(res, 404, { error: "no route" });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    json(res, 500, { error: (e as Error).message });
  });
});

const cfg = await loadAppConfig();
// Loopback only: the board reads every local transcript, it must not be reachable
// from the network.
server.listen(cfg.port, "127.0.0.1", () => {
  console.log(`Agent Board → http://127.0.0.1:${cfg.port}`);
});
