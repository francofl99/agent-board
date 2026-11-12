import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppConfig, saveAppConfig } from "./config.js";
import { scanFleet } from "./fleet.js";
import { defaultTarget, openSession, optionsFor, revealFile, type OpenTarget } from "./open.js";
import { findItem, inboxView, recordSent, saveDecision, type InboxStatus } from "./inbox.js";
import { addNote, loadNotes } from "./notes.js";
import { sendReply, slackConfigured, targetOf } from "./slack.js";
import { readTranscript } from "./timeline.js";
import { addGroup, knownGroups, saveUserData } from "./store.js";
import { loadThemes, THEMES_DIR } from "./themes.js";
import type { ScanResult } from "./fleet.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "..", "web", "dist");
// Optional server/.env (SLACK_USER_TOKEN); variables already set win.
try {
  process.loadEnvFile(path.join(HERE, "..", ".env"));
} catch {
  // No .env: the Keychain or nothing.
}

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

// A browser always names the page behind a cross-site POST, so a request with no Origin
// comes from a local process (personal-console's proxy), which could read the token anyway.
function fromBoard(req: http.IncomingMessage, port: number): boolean {
  const local = [`127.0.0.1:${port}`, `localhost:${port}`];
  const pages = [...local, "127.0.0.1:4320", "localhost:4320"].map((h) => `http://${h}`);
  const origins = new Set([...pages, "tauri://localhost"]);
  const origin = req.headers.origin;
  return local.includes(req.headers.host ?? "") && (origin === undefined || origins.has(origin));
}

let cfgPort = 4319;

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

  if (p === "/api/notes") {
    if (req.method === "GET") {
      json(res, 200, await loadNotes());
      return;
    }
    if (req.method === "POST") {
      const note = await addNote(await readBody(req));
      if (note === null) json(res, 400, { error: "text or url required" });
      else json(res, 201, note);
      return;
    }
  }

  if (p === "/api/inbox" && req.method === "GET") {
    json(res, 200, await inboxView());
    return;
  }

  if (p === "/api/slack" && req.method === "GET") {
    json(res, 200, { configured: await slackConfigured() });
    return;
  }

  const send = p.match(/^\/api\/inbox\/(.+)\/send$/);
  if (send !== null && req.method === "POST") {
    // Sends as you, so unlike the rest of the API it refuses any page but the board's own:
    // CORS alone would let another site open in the browser post here.
    if (!fromBoard(req, cfgPort)) {
      json(res, 403, { error: "only the board or a local process can send" });
      return;
    }
    const item = await findItem(decodeURIComponent(send[1]));
    const target = item === undefined ? null : targetOf(item.url);
    const body = await readBody(req);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (item === undefined || target === null || text === "") {
      json(res, 400, { error: "item without a Slack permalink, or empty text" });
      return;
    }
    try {
      const sent = await sendReply(target, text);
      await recordSent(item, sent);
      json(res, 200, sent);
    } catch (e) {
      json(res, 502, { error: (e as Error).message });
    }
    return;
  }

  const inbox = p.match(/^\/api\/inbox\/(.+)$/);
  if (inbox !== null && req.method === "PATCH") {
    const body = await readBody(req);
    const statuses: InboxStatus[] = ["pending", "done", "dismissed", "snoozed"];
    const saved = await saveDecision(decodeURIComponent(inbox[1]), {
      ...(statuses.includes(body.status) ? { status: body.status as InboxStatus } : {}),
      ...(typeof body.approve === "boolean" ? { approve: body.approve } : {}),
      ...(typeof body.text === "string" ? { text: body.text } : {}),
    });
    if (saved === null) json(res, 404, { error: "item not found" });
    else json(res, 200, saved);
    return;
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
cfgPort = cfg.port;
// Loopback only: the board reads every local transcript, it must not be reachable
// from the network.
server.listen(cfg.port, "127.0.0.1", () => {
  console.log(`Agent Board → http://127.0.0.1:${cfg.port}`);
});
