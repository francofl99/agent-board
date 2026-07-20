# Agent Board

Sync your local AI coding-agent sessions — **Claude Code**, **Codex**, and (soon)
**OpenCode** — into a Notion database you can organize like a kanban board.

Agent providers keep every session as an append-only JSONL transcript on disk but
expose no API to list or monitor them. Agent Board reads those files (read-only),
derives a live status for each session, and upserts them into Notion. Your own
organization (the `Grupo` column, notes) lives in Notion and is **never overwritten**
by the sync.

## Features

- **Multi-provider**: Claude Code (`~/.claude/projects`) and Codex (`~/.codex/sessions`).
- **Derived status** per session, inferred from the last message turn + file freshness:
  - `working` — file written seconds ago, or mid-turn (tool running / user just sent).
  - `waiting_user` — the agent finished its turn; the ball is in your court.
  - `idle` — stale / abandoned mid-turn / no activity.
- **Deep links** — each row's `Link` opens the session in the provider's app
  (Claude: `claude://resume?session=<uuid>&folder=<cwd>`).
- **Zero-setup database** — created automatically on first run; you only provide a token.
- **Diff-based, rate-limit-friendly** — only changed rows are patched.
- **Filters** — sync a subset by provider, recency, or activity to stay within Notion's
  free block limit.

## Architecture

```
~/.claude/projects/**/*.jsonl          providers' transcripts (read-only source)
~/.codex/sessions/**/*.jsonl
        │  parser + status derivation
        ▼
   sync (diff-based upsert)  ──►  Notion database
```

## Setup (from zero — you only need a token)

1. Create an internal integration at <https://www.notion.so/my-integrations> and copy
   its token (`ntn_...` / `secret_...`).
2. In Notion, pick or create a page to hold the board and **share it with the
   integration**: page → `•••` → **Connections** → add your integration.
   *(Notion's API can't create a workspace or a top-level page from just a token, so one
   shared page is the minimum.)*
3. Give the tool your token — either `~/.agent-board/notion.json`
   (copy `server/notion.example.json`) or `export NOTION_TOKEN=ntn_...`.
4. Run the sync. **On first run the database is created automatically**, its
   `databaseId` is written back to your config, and the sync begins. Then add a Board
   view in Notion (grouped by `Status` or `Grupo`) for the kanban look.

```bash
cd server
npm install
npm run sync:once   # bootstraps the DB on first run, then backfills
npm run sync        # loop every intervalMs
```

### Where it creates / syncs

Resolved in order (config file, or the matching `NOTION_*` env var):

| Config | Env | Behavior |
|--------|-----|----------|
| `databaseId` | `NOTION_DATABASE_ID` | sync into that database |
| `parentPageId` | `NOTION_PARENT_PAGE_ID` | create the DB under that page, then sync |
| neither | — | create under the first page shared with the integration |

The `databaseId` is filled into the config automatically after the first run — delete
it to bootstrap a fresh database again.

### Config file

```jsonc
// ~/.agent-board/notion.json  (only "token" is required)
{
  "token": "ntn_...",
  "parentPageId": "optional_page_id_where_the_db_is_created",
  "intervalMs": 30000,
  "sinceDays": 14,
  "onlyActive": false,
  "providers": ["claude"]
}
```

## Database schema

The auto-created database uses these properties. The sync only writes the
provider-owned ones and **never** touches `Grupo` or the page body (notes).

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
| `Link` | URL | sync — deep link to open the session in the provider's app |

## Filters

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

## Board views in Notion

Add a **Board** view grouped by `Status` (live state) or by `Grupo` (your manual
kanban). Reordering, creating and deleting columns is native to Notion.

## Roadmap

- OpenCode provider (it exposes an HTTP server with SSE — richer than file tailing).
- Sharper `working` detection by correlating with running agent processes (pgrep + cwd).
- Deep links for Codex / OpenCode.
- Full-text search / richer card content (transcript excerpts).

## License

MIT — see [LICENSE](LICENSE).
