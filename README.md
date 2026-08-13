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
- **Routines excluded** — scheduled-task runs (Claude Code routines) are skipped
  entirely: only interactive sessions become cards, so automations don't clutter the board.

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
  "prDatabaseId": "auto-filled after first `sync:prs` run",
  "reviewDatabaseId": "auto-filled after first `sync:prs` run",
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
| `Último mensaje` | Text | sync — preview of the last message with content |
| `Dirección` | Select (`Enviado`, `Recibido`) | sync — was the last message sent (user) or received (agent) |
| `PRs` | Text | sync — clickable `repo#123` links for every GitHub PR found in the transcript |
| `Modelo` | Text | sync — last model used in the session |
| `Tokens` | Number | sync — output tokens generated across the session |

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

## AI session summaries (optional)

Point the sync at any **OpenAI-compatible** chat endpoint (Ollama, LM Studio,
llama.cpp, vLLM, or a hosted API) and it posts a 1–2 sentence summary as a **comment**
on each session's page (shown in full, unlike a truncated card property). Disabled
unless a URL is set — with no config the sync behaves exactly as before.

A summary is generated only when the **agent finishes its turn** (status
`waiting_user`) and only once per turn — never mid-turn between tool calls. Notion
comments are append-only (the API can't edit or delete them), so each session
accumulates one entry per completed turn. If the endpoint is down or times out, that
session is skipped — the sync never aborts.

Requires the integration to have the **"Insert comments"** capability enabled (Notion →
your integration → Capabilities). Without it, comment posts are silently skipped.

Quickest setup — an interactive command that picks the provider, sets the URL, lists
the endpoint's models and writes the config for you:

```bash
npm run setup:summary          # configure
npm run setup:summary -- --disable   # turn it off
```

Or edit `~/.agent-board/notion.json` by hand:

```jsonc
"summary": {
  "url": "http://localhost:11434/v1/chat/completions",  // e.g. Ollama
  "model": "llama3.1",
  "apiKey": "",          // optional (for hosted endpoints)
  "timeoutMs": 20000
}
```

Env equivalents: `SUMMARY_API_URL`, `SUMMARY_MODEL`, `SUMMARY_API_KEY`,
`SUMMARY_TIMEOUT_MS`.

## GitHub PRs (yours to land, and yours to review)

A separate sync keeps **two databases**, one per role, so "mine to land" and "waiting on
my review" never share a table:

| Database | Config key | Query |
|----------|-----------|-------|
| **My PRs** | `prDatabaseId` | GraphQL search `is:pr is:open author:@me` (branch names → stack detection) |
| **PRs to review** | `reviewDatabaseId` | `gh search prs --review-requested @me --state open` — review requested **from you and still pending** |

It reuses your existing **`gh` CLI** login (`gh auth status`), so there is no extra
credential to store — nothing like an API token saved on disk.

```bash
npm run sync:prs:once   # bootstraps both DBs on first run, then upserts
npm run sync:prs        # loop every intervalMs
```

- **Already-reviewed PRs disappear on their own**: GitHub clears the review request the
  moment you submit a review, so the PR leaves `review-requested:@me` and its row is
  trashed on the next sync (it comes back if someone re-requests you).
  *Caveat:* requests routed through a **team** you belong to aren't matched by this
  qualifier — that needs `team-review-requested:org/team`.
- Both ids are written back to your config after the first run (delete one to bootstrap a
  fresh DB). Created under `parentPageId` — **set it**, otherwise the fallback is the
  first page the search returns, which may be a row of the sessions database that later
  gets trashed.
- Rows are keyed by PR URL: reopened diffs update in place; merged/closed PRs drop out
  of `--state open` and their rows are moved to Notion's trash automatically.
- **Manual `Estado` override**: the sync only owns `Open`/`Draft`. If you set a row's
  `Estado` to any other option (add it in Notion first, e.g. `Revisando`, `Bloqueado`),
  the sync preserves it and never forces it back to `Open`/`Draft`. The row still drops
  out (is trashed) once the PR is no longer open on GitHub.
- If the database was moved in Notion, re-share it with the integration
  (`•••` → **Connections**) — a moved DB loses inherited access and the sync 404s.

| Property | Type | Notes |
|----------|------|-------|
| `Name` | Title | PR title |
| `Repo` | Text | `owner/name` |
| `PR` | Number | PR number |
| `Estado` | Select (`Open`, `Draft`) | draft PRs flagged separately |
| `Stack` | Text | **My PRs only** — position in a PR stack (see below) |
| `Base` | Text | **My PRs only** — branch the PR merges into |
| `Visto` | Checkbox | **PRs to review only** — you tick it, the sync unticks it (see below) |
| `Creado` / `Actualizado` | Date | from GitHub |
| `Link` | URL | opens the PR on GitHub |

Row icons: 🔀 your PR, 📝 your draft, 👀 awaiting your review, ✅ reviewed and quiet.

### `Stack`: which PRs are chained on top of each other

A PR is **stacked** when it targets another open PR's head branch instead of the repo's
default branch. The sync walks those base→head links and labels every PR in the chain:

```
🥞 1/3 · #30622     ← the root, based on master
🥞 2/3 · #30622     ← based on #30622's branch
🥞 3/3 · #30622     ← based on #30623's branch
```

The label carries the root PR number, so sorting the table by `Stack` keeps a stack's
parts together and in order. Standalone PRs get an empty `Stack`. A PR based on a branch
whose PR is already merged/closed can't be numbered, and reads `🥞 sobre <branch>`.

`gh search prs --json` can't return branch names, so your own PRs are fetched with a
GraphQL search instead (`gh api graphql`) — same gh credential, one request. That query is
also less lossy than the search command, so expect a few more rows than before.

### `Visto`: read once, and know when it changes again

Tick `Visto` after reading a PR. The sync leaves it ticked while nothing happens, and
**unticks it the moment GitHub reports newer activity** than the `Actualizado` already on
the row — a new commit, review or comment puts the PR back in your queue. No extra
column: the previous `Actualizado` value *is* the watermark.

That makes two filters worth saving on the review database:

| View | Filter | Answers |
|------|--------|---------|
| **Por revisar** | `Visto` is unchecked | what's actually waiting on me |
| **Ya lo vi** | `Visto` is checked | reviewed, quiet, waiting on someone else |

Because the sync only ever unticks a box you ticked, marking one by hand is safe: the row
is rewritten (and its icon flips to ✅) on the next cycle, never reverted on its own.

Caveat: GitHub bumps `updated_at` on *any* activity, including your own comment — so
commenting on a PR you just marked will untick it again.

Requires `gh` installed and authenticated. Env overrides for the ids:
`NOTION_PR_DATABASE_ID`, `NOTION_REVIEW_DATABASE_ID`.

## Recommended views

The Notion REST API can't create views, so the sync only creates the database (with
one default table view). Add these by hand — one-time, ~1 min — for the full setup:

| View | Type | Config |
|------|------|--------|
| **Estado** | Board | group by `Status`; sort by `Last activity` desc |
| **Gestión** | Board | group by `Grupo` (your manual kanban) |
| **Usage** | Table | group by `Modelo`; sort by `Tokens` desc; show `Provider`, `Tokens`, `Messages`, `PRs`. Set the `Tokens` column footer to **Sum** for per-model totals |
| **Usage · tokens** | Chart (bar) | X = `Provider` (or `Status`), Y = **Sum** of `Tokens` |

Notes:
- **Charts must group by a `select` property** (`Provider`, `Status`), not a free-text
  one — grouping a chart by `Modelo` (text) renders "something is wrong with your chart
  data". For per-**model** totals use the **Usage** table's `Tokens` Sum footer.
- The REST API has no endpoint to create views (any auth method), so this stays a
  one-time manual step. If you use Claude with the Notion connector, it can create
  these views for you programmatically.

## Roadmap

- OpenCode provider (it exposes an HTTP server with SSE — richer than file tailing).
- Sharper `working` detection by correlating with running agent processes (pgrep + cwd).
- Deep links for Codex / OpenCode.
- Full-text search / richer card content (transcript excerpts).

## License

MIT — see [LICENSE](LICENSE).
