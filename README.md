# Agent Board

A local dashboard for the AI coding-agent sessions on your machine — **Claude Code**,
**Codex**, and (soon) **OpenCode** — as movable kanban cards.

Agent providers keep every session as an append-only JSONL transcript on disk but
expose no API to list or monitor them. Agent Board reads those files (read-only),
derives a live status for each session, and lets you organize them — either in a
built-in localhost board or by syncing them into a Notion database.

Your own organization (kanban column, notes, read/unread) lives in a separate store
and **never touches the provider's files**.

## Features

- **Multi-provider**: Claude Code (`~/.claude/projects`) and Codex (`~/.codex/sessions`).
- **Derived status** per session, inferred from the last message turn + file freshness:
  - `working` — file written seconds ago, or mid-turn (tool running / user just sent).
  - `waiting_user` — the agent finished its turn; the ball is in your court.
  - `idle` — stale / abandoned mid-turn / no activity.
- **Live updates** via filesystem watch + SSE (localhost board refreshes itself).
- **Two surfaces**:
  - **Localhost board** — Vue kanban with drag & drop, filters (provider / project /
    status), notes, unread markers, manageable columns.
  - **Notion sync** — push sessions into a Notion database and manage them there
    (board views, mobile, collaboration).

## Architecture

```
~/.claude/projects/**/*.jsonl          providers' transcripts (read-only source)
~/.codex/sessions/**/*.jsonl
        │  chokidar watch + parser + status derivation
        ▼
   server (Express)
    ├── REST + SSE  ──►  web (Vue 3 + Vite)      → localhost board
    ├── SQLite (~/.agent-board/state.db)          → your columns / notes / unread
    └── notion sync (diff-based upsert)  ──►  Notion database
```

## Quick start (localhost board)

Two terminals:

```bash
# backend  → http://localhost:4317
cd server && npm install && npm run dev

# frontend → http://localhost:5173  (proxies /api to the backend)
cd web && npm install && npm run dev
```

Open http://localhost:5173.

## Notion sync (optional)

Use a Notion database as the management surface.

### 1. Create the database

Create a Notion database with these properties (types matter):

| Property | Type | Written by |
|----------|------|-----------|
| `Name` | Title | sync |
| `Session ID` | Text | sync (unique key) |
| `Provider` | Select (`Claude`, `Codex`, `OpenCode`) | sync |
| `Status` | Select (`Trabajando`, `Esperando respuesta`, `Inactiva`) | sync |
| `Grupo` | Select (your kanban buckets) | **you** |
| `Project` | Text | sync |
| `Path` | Text | sync |
| `Branch` | Text | sync |
| `Messages` | Number | sync |
| `Last activity` | Date | sync |
| `Active` | Checkbox | sync |
| `Link` | Text | sync |

The sync only writes provider-owned properties and **never** touches `Grupo` or the
page body (notes), so those stay yours.

### 2. Connect an integration

1. Create an internal integration at <https://www.notion.so/my-integrations> and copy
   its token (`ntn_...` / `secret_...`).
2. Open the database → `•••` → **Connections** → add your integration.

### 3. Configure

Copy `server/notion.example.json` to `~/.agent-board/notion.json` and fill it in
(or use the `NOTION_TOKEN` / `NOTION_DATABASE_ID` environment variables):

```json
{
  "token": "ntn_...",
  "databaseId": "your_notion_database_id",
  "intervalMs": 30000,
  "sinceDays": 14,
  "onlyActive": false,
  "providers": ["claude"]
}
```

### 4. Run

```bash
cd server
npm run sync:once   # one pass (backfill / test)
npm run sync        # loop every intervalMs
```

Steady state is diff-based: only rows whose data changed get a `PATCH`, so it stays
well under Notion's rate limit.

### Filters

Notion's free plan caps total blocks; syncing everything can fill it. Filter what
gets synced (config file, env var, or CLI flag). Rows that stop matching are moved to
Notion's trash, freeing blocks.

| Config key | Env | CLI | Effect |
|-----------|-----|-----|--------|
| `providers` | `SYNC_PROVIDERS` | `--providers claude,codex` | only these providers |
| `sinceDays` | `SYNC_SINCE_DAYS` | — | only sessions touched within N days |
| `onlyActive` | `SYNC_ONLY_ACTIVE` | — | only currently-active sessions |

```bash
npm run sync:once -- --providers claude       # CLI override wins over config/env
SYNC_PROVIDERS=claude,codex npm run sync
```

### Board views in Notion

Add a **Board** view grouped by `Status` (live state) or by `Grupo` (your manual
kanban). Reordering, creating and deleting columns is native to Notion.

## Configuration reference

| Setting | Where | Default |
|---------|-------|---------|
| Backend port | `PORT` env | `4317` |
| Notion token | `NOTION_TOKEN` env / `notion.json` | — |
| Database id | `NOTION_DATABASE_ID` env / `notion.json` | — |
| Sync interval | `SYNC_INTERVAL_MS` env / `notion.json` | `30000` |
| Providers / Since / Active | see Filters table | all / no limit / false |

App state (columns, notes, unread) and the Notion token live under
`~/.agent-board/` — outside the repo.

## Roadmap

- OpenCode provider (it exposes an HTTP server with SSE — richer than file tailing).
- Sharper `working` detection by correlating with running agent processes (pgrep + cwd).
- Package the localhost board as a desktop app (Tauri / Electron).
- Full-text search over transcripts.

## License

MIT — see [LICENSE](LICENSE).
