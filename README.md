# Agent Board

A local, read-only dashboard over every AI coding-agent session on your machine —
**Claude Code**, **Codex**, and (soon) **OpenCode**. It is an index, not a chat
client: nothing is ever sent to an agent from here, and the primary action on a
session is opening it in the client it lives in. Syncing to Notion is still
available as an optional export.

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
- **Two axes, not one** — provider (Claude / Codex) and client (CLI / desktop) are
  tracked and badged separately.
- **Cost per session** — tokens in/out plus cache reads and writes, priced per model.
- **Zero-setup Notion database** — created automatically on first run; you only provide a token.
- **Diff-based, rate-limit-friendly** — only changed rows are patched.
- **Filters** — sync a subset by provider, recency, or activity to stay within Notion's
  free block limit.
- **Routines excluded** — scheduled-task runs (Claude Code routines) are skipped
  entirely: only interactive sessions become cards, so automations don't clutter the board.

## Architecture

```
~/.claude/projects/**/*.jsonl          providers' transcripts (read-only source)
~/.claude/sessions/<pid>.json          live process registry (pid, name, entrypoint)
~/.codex/sessions/**/*.jsonl
~/.codex/session_index.jsonl
        │  parser + status derivation + pricing
        ▼
   local API (127.0.0.1:4319)  ──►  web UI and desktop notch (one session list)
        │
        └── sync (diff-based upsert)  ──►  Notion database   [optional export]
```

`~/.agent-board/` holds everything the app writes: `app.json` (discovery paths,
refresh interval, port), `user-data.json` (your group + notes per session — a
refresh never touches these), and `pricing.json` (per-model rate overrides).

## The app

```bash
npm run install:all
npm run build     # builds the UI into web/dist
npm start         # http://127.0.0.1:4319
```

Development (API + Vite with HMR on 4320):

```bash
npm run dev
```

The server binds to loopback only — it reads every local transcript, so it must not
be reachable from the network. There is no login, no cloud, no telemetry.

### The list

One view, the same in the browser and in the panel the desktop notch drops. The bar on
top counts who waits on you (with the longest wait) and who is working, and holds the
search, the scan indicator and Ajustes. Below, only the live sessions, in two groups:

- **Te esperan** — sessions that finished their turn, longest wait first, each with the
  first line of what the agent last said.
- **Trabajando** — sessions mid-turn, with their running sub-agents or last move.

Idle, ended and closed sessions stay out of the list.

Each row shows the provider, the name, that hint, project · branch and how long ago.
`Espacio` (or a click) unfolds it: the last few things the agent said or ran, with the
model and estimated cost beside them.

| Key | Does |
|---|---|
| `↑` `↓` | move the selection |
| `Espacio` | unfold / fold the selected session |
| `x` | close the session: it leaves the list until it moves again |
| `/` | search by name, project, branch or model |
| `Esc` | clear the search; in the notch panel, fold it away |

### Themes

Every colour and both font families come from CSS custom properties, so a theme is a
bag of tokens. Four ship built in — **Grafito** (neutral, amber accent), **Carbón**
(warm black, violet accent, amber left to alerts), **Hielo** (desaturated blue-grey)
and **Papel** (light) — plus **Automático**, which follows the macOS appearance:
Grafito in dark mode, Papel in light. `Ajustes` picks between them, and the choice lives
in `~/.agent-board/app.json` so the browser and the desktop shell share it.

Drop a JSON file in `~/.agent-board/themes/` and it shows up in the picker next to the
built-ins. It starts from Grafito, so a file only needs the tokens it changes:

```json
{
  "id": "musgo",
  "name": "Musgo",
  "desc": "Acento verde sobre la base neutra.",
  "fonts": "Archivo / Azeret Mono",
  "tokens": {
    "--acc": "oklch(0.820 0.140 150)",
    "--acc-ink": "oklch(0.18 0.05 150)",
    "--acc-soft": "oklch(0.32 0.060 150)"
  }
}
```

Only `--*` keys are read from a theme file — a theme can restyle the app, not inject
anything else into it.

### Closing a session you're done with

A session can sit in `waiting_input` forever because you already moved on. `x` — or
`Dar por cerrada` in the unfolded row — marks it closed: it leaves the list and stops
counting as waiting on you.

The flag is a timestamp of the session's last activity, not a boolean, so it clears
itself: the moment that transcript grows again the session comes back on its own as
`working`, then `waiting_input` when the agent finishes its turn. Nothing to remember
to undo.

### Status

Each provider is read on its own terms.

**Claude** publishes a pid registry per session (`~/.claude/sessions/<pid>.json`), so
liveness is exact, and the status comes from the last message turn: a closed assistant
turn means it is waiting on you, a pending user message or an in-flight tool call means
it is working.

**Codex** publishes no registry, so a thread is live while its host is up — the desktop
app-server process for a desktop thread, a terminal `codex` process in that directory
for a CLI one. Its status comes from the turn events it records itself (`task_started`
vs `task_complete`), and a thread the app still marks unread counts as waiting on you:
the answer arrived and you never opened it. Names come from the curated `thread_name`
in `~/.codex/session_index.jsonl`, not from the first prompt; the workspace root falls
back to the app's own hint when a rollout carries no `cwd`; and Codex automations
(`thread_source: "automation"`) are dropped, same as Claude routines.

A session with no live process is `ended`, whatever its last turn looked like.

### Cost

Cost is estimated from the transcript's own token counters, cache reads and writes
included (agent transcripts are mostly cache, so ignoring them under-reports by an
order of magnitude). Unknown models cost `—` rather than a made-up number. Override
rates in `~/.agent-board/pricing.json`.

### Desktop rail (macOS)

A strip pinned to the right edge of the screen that stays on top of whatever you are
using, full-screen apps included. Collapsed it shows how many sessions wait on you,
how many are working, and one dot per live session; hover it and it widens into the
list — waiting first, with what each one asked or is running. The menu bar shows the
same counters (`⏳2 ⚙︎3`) and a menu to move or hide the rail, or quit.

Docked into the **notch** instead, it uses the black strip a full-screen app leaves
around the camera: waiting sessions as chips on the left, working ones on the right,
rotating as a carousel when they don't fit. On a regular desktop it shows nothing.
Hovering the notch or `⌘⇧A` from any app drops the list as a 960px panel.

It is a [Tauri](https://tauri.app) shell around the `?rail` view of the web UI, so it
needs the API running (`npm start`) and Rust installed:

```bash
cd desktop
npm install
npm run build   # → src-tauri/target/release/bundle/macos/Agent Board Rail.app
```

macOS has no API to reserve screen space the way the Dock does, so the rail floats
over the window behind it; it stays 44px wide until hovered. `http://127.0.0.1:4319/?rail`
renders the same view in a browser.

## Notion export (optional)

### Setup (from zero — you only need a token)

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
| **PRs to review** | `reviewDatabaseId` | GraphQL search `is:pr is:open review-requested:@me` — review requested **from you and still pending** |

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
| `Merge` | Select | what blocks the merge right now (see below) |
| `Checks` | Text | which checks are red or still running |
| `Stack` | Text | **My PRs only** — position in a PR stack (see below) |
| `Base` | Text | branch the PR merges into |
| `Visto` | Checkbox | **PRs to review only** — you tick it, the sync unticks it (see below) |
| `Creado` / `Actualizado` | Date | from GitHub |
| `Link` | URL | opens the PR on GitHub |

Row icons: 🔀 your PR, 📝 your draft, 👀 awaiting your review, ✅ reviewed and quiet.

### `Merge` / `Checks`: what's actually blocking the merge

`Merge` is GitHub's own merge-readiness verdict (`mergeStateStatus`), which already
accounts for branch protection — so `BLOCKED` means a **required** gate is unmet, and the
sync only inspects checks and reviews to name which one:

| `Merge` | Meaning |
|---------|---------|
| `✅ Listo` | mergeable, nothing pending |
| `👤 Falta review` | required review missing |
| `🔴 Cambios pedidos` | a reviewer requested changes |
| `🟡 Checks corriendo` | required checks still running |
| `❌ Checks requeridos fallando` | a required check is red |
| `⚠️ Checks no requeridos fallando` | red checks, but none of them blocks the merge |
| `⚠️ Conflictos` | needs a rebase/merge |
| `↩️ Falta actualizar base` | branch protection wants it up to date with the base |
| `📝 Draft` | still a draft |

`Checks` names what's wrong: `❌ build, Jenkins/Continuos-integration +2 (1/6 ok)`, or
`✅ 6/6` when everything passed. A check that reruns per matrix leg reports the same name
several times, so only its worst state is kept.

GitHub computes mergeability **on demand** and answers `UNKNOWN` until it's done — a push
to the base branch invalidates every open PR in that repo at once, so whole batches can
come back unknown. The sync treats an empty verdict as "no answer this round" and keeps
the last real one instead of blanking the column.

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
