import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type PrRole = "author" | "reviewer";

export interface OpenPr {
  number: number;
  title: string;
  repo: string; // owner/name
  url: string;
  isDraft: boolean;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  role: PrRole; // authored by you, or awaiting your review
  baseRef: string; // branch this PR merges into ("" when unknown)
  stack: string; // stack label, "" when the PR stands alone (see labelStacks)
  merge: string; // what blocks the merge, one of MERGE_LABELS
  checks: string; // which checks are red or still running
}

// All PR data comes from the existing `gh` CLI login, so there is no extra credential
// to store. Throws (never returns partial data) if gh is missing or not authenticated.
async function gh(args: string[], label: string): Promise<string> {
  try {
    const { stdout } = await run("gh", args, { maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    throw new Error(
      `${label} failed — is gh installed and authenticated? (gh auth status). ${(e as Error).message}`
    );
  }
}

// GraphQL rather than `gh search prs`, which returns neither branch names (needed for
// stack detection) nor merge/check state. One request per role.
const PR_QUERY = `query($q: String!, $limit: Int!) {
  search(query: $q, type: ISSUE, first: $limit) {
    nodes { ... on PullRequest {
      number title url isDraft createdAt updatedAt headRefName baseRefName
      mergeable mergeStateStatus reviewDecision
      repository { nameWithOwner defaultBranchRef { name } }
      commits(last: 1) { nodes { commit { statusCheckRollup {
        contexts(last: 40) { nodes {
          ... on CheckRun { name conclusion status }
          ... on StatusContext { context state }
        } }
      } } } }
    } }
  }
}`;

// GitHub's own merge-readiness verdict, most actionable first. `mergeStateStatus` already
// accounts for branch protection, so BLOCKED means a *required* gate is unmet — we only
// look at checks and reviews to say which one.
export const MERGE_LABELS = {
  draft: "📝 Draft",
  conflicts: "⚠️ Conflictos",
  behind: "↩️ Falta actualizar base",
  checksFailing: "❌ Checks requeridos fallando",
  changesRequested: "🔴 Cambios pedidos",
  checksRunning: "🟡 Checks corriendo",
  reviewRequired: "👤 Falta review",
  blocked: "🚫 Bloqueado",
  unstable: "⚠️ Checks no requeridos fallando",
  ready: "✅ Listo",
} as const;

const OK_CHECK_STATES = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
const FAILED_CHECK_STATES = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"]);

export interface CheckState {
  name: string;
  state: string;
}

// A CheckRun reports status + conclusion, a StatusContext a single state; normalize both
// and keep the worst state per name (a matrix job repeats its name once per leg).
function normalizeChecks(nodes: any[]): CheckState[] {
  const worst = new Map<string, string>();
  for (const c of nodes) {
    if (c === null || c === undefined) continue;
    const name = String(c.name ?? c.context ?? "");
    if (name === "") continue;
    const state =
      c.context !== undefined
        ? String(c.state ?? "")
        : c.status !== "COMPLETED"
          ? "PENDING"
          : String(c.conclusion ?? "");
    const prev = worst.get(name);
    const rank = (s: string) => (FAILED_CHECK_STATES.has(s) ? 2 : OK_CHECK_STATES.has(s) ? 0 : 1);
    if (prev === undefined || rank(state) > rank(prev)) worst.set(name, state);
  }
  return [...worst].map(([name, state]) => ({ name, state }));
}

const MAX_CHECK_NAMES = 2;

function checksSummary(checks: CheckState[]): string {
  if (checks.length === 0) return "";
  const failing = checks.filter((c) => FAILED_CHECK_STATES.has(c.state));
  const pending = checks.filter((c) => !FAILED_CHECK_STATES.has(c.state) && !OK_CHECK_STATES.has(c.state));
  const problems = [...failing, ...pending];
  if (problems.length === 0) return `✅ ${checks.length}/${checks.length}`;
  const shown = problems.slice(0, MAX_CHECK_NAMES).map((c) => c.name);
  const rest = problems.length - shown.length;
  const icon = failing.length > 0 ? "❌" : "🟡";
  const more = rest > 0 ? ` +${rest}` : "";
  return `${icon} ${shown.join(", ")}${more} (${checks.length - problems.length}/${checks.length} ok)`;
}

type MergeKind = keyof typeof MERGE_LABELS;

function mergeKind(raw: any, checks: CheckState[]): MergeKind | "" {
  const failing = checks.some((c) => FAILED_CHECK_STATES.has(c.state));
  const running = checks.some((c) => !FAILED_CHECK_STATES.has(c.state) && !OK_CHECK_STATES.has(c.state));
  const decision = String(raw.reviewDecision ?? "");
  switch (String(raw.mergeStateStatus ?? "")) {
    case "DRAFT":
      return "draft";
    case "DIRTY":
      return "conflicts";
    case "BEHIND":
      return "behind";
    case "UNSTABLE":
      return "unstable";
    case "BLOCKED":
      if (failing) return "checksFailing";
      if (decision === "CHANGES_REQUESTED") return "changesRequested";
      if (running) return "checksRunning";
      if (decision === "REVIEW_REQUIRED" || decision === "") return "reviewRequired";
      return "blocked";
    case "CLEAN":
    case "HAS_HOOKS":
      return "ready";
    default:
      // UNKNOWN: GitHub is still computing mergeability, or we lack permission to see it.
      return String(raw.mergeable ?? "") === "CONFLICTING" ? "conflicts" : "";
  }
}

function mergeLabel(raw: any, checks: CheckState[]): string {
  const kind = mergeKind(raw, checks);
  return kind === "" ? "" : MERGE_LABELS[kind];
}

interface StackNode {
  pr: OpenPr;
  head: string;
  base: string;
  isDefaultBase: boolean;
}

// A PR is stacked when it targets another open PR's head branch instead of the repo's
// default branch. Walk those parent links to label each PR with its position in the
// chain and the root PR that anchors it, so the table can be sorted into stacks.
function labelStacks(nodes: StackNode[]): void {
  const byHead = new Map<string, StackNode>();
  for (const n of nodes) byHead.set(`${n.pr.repo} ${n.head}`, n);
  const parentOf = (n: StackNode): StackNode | undefined =>
    n.isDefaultBase ? undefined : byHead.get(`${n.pr.repo} ${n.base}`);

  for (const n of nodes) {
    const chain: StackNode[] = [];
    for (let cur = parentOf(n); cur !== undefined; cur = parentOf(cur)) {
      if (chain.includes(cur)) break; // defensive: a base cycle would hang the walk
      chain.push(cur);
    }
    const depth = chain.length;
    const root = depth > 0 ? chain[depth - 1] : n;
    // Total = how deep the chain runs below this PR, plus the part above it.
    let below = 0;
    for (const other of nodes) {
      let steps = 0;
      for (let cur = parentOf(other); cur !== undefined; cur = parentOf(cur)) {
        steps++;
        if (cur === n) {
          below = Math.max(below, steps);
          break;
        }
      }
    }
    const total = depth + 1 + below;
    if (total > 1) {
      n.pr.stack = `🥞 ${depth + 1}/${total} · #${root.pr.number}`;
    } else if (!n.isDefaultBase) {
      // Stacked on a branch whose PR is closed/merged: no chain to number.
      n.pr.stack = `🥞 sobre ${n.base}`;
    }
  }
}

const SEARCH_QUERY: Record<PrRole, string> = {
  author: "is:pr is:open author:@me",
  // `review-requested:@me` only matches while the request is still PENDING: GitHub clears
  // it as soon as you submit a review, so PRs you already reviewed drop out on their own
  // (and come back if someone re-requests). Requests routed through a team you belong to
  // are NOT matched — that needs team-review-requested:org/team.
  reviewer: "is:pr is:open review-requested:@me",
};

async function fetchPrs(role: PrRole, limit: number): Promise<OpenPr[]> {
  const stdout = await gh(
    ["api", "graphql", "-f", `query=${PR_QUERY}`, "-f", `q=${SEARCH_QUERY[role]}`, "-F", `limit=${limit}`],
    `gh api graphql (${role} PRs)`
  );
  const nodes: StackNode[] = (JSON.parse(stdout)?.data?.search?.nodes ?? [])
    .filter((r: any) => r?.number !== undefined)
    .map((r: any) => {
      const base = String(r.baseRefName ?? "");
      const rollup = r.commits?.nodes?.[0]?.commit?.statusCheckRollup;
      const checks = normalizeChecks(rollup?.contexts?.nodes ?? []);
      return {
        head: String(r.headRefName ?? ""),
        base,
        isDefaultBase: base === String(r.repository?.defaultBranchRef?.name ?? ""),
        pr: {
          number: r.number,
          title: String(r.title ?? ""),
          repo: String(r.repository?.nameWithOwner ?? ""),
          url: String(r.url ?? ""),
          isDraft: Boolean(r.isDraft),
          createdAt: String(r.createdAt ?? ""),
          updatedAt: String(r.updatedAt ?? ""),
          role,
          baseRef: base,
          stack: "",
          merge: mergeLabel(r, checks),
          checks: checksSummary(checks),
        },
      };
    });
  // Only your own PRs form stacks you can reason about: the reviewer list is a slice of
  // other people's branches, so a chain across it would be arbitrary.
  if (role === "author") labelStacks(nodes);
  return nodes.map((n) => n.pr);
}

export const PR_FETCHERS: Record<PrRole, (limit?: number) => Promise<OpenPr[]>> = {
  author: (limit = 100) => fetchPrs("author", limit),
  reviewer: (limit = 100) => fetchPrs("reviewer", limit),
};

export interface PrStatus {
  url: string;
  number: number;
  repo: string;
  title: string;
  state: string; // OPEN, MERGED or CLOSED
  merge: MergeKind | ""; // only for open PRs
  checks: (CheckState & { result: "ok" | "failed" | "pending" })[];
}

const STATUS_QUERY = `query($url: URI!) {
  resource(url: $url) { ... on PullRequest {
    number title url state isDraft mergeable mergeStateStatus reviewDecision
    repository { nameWithOwner }
    commits(last: 1) { nodes { commit { statusCheckRollup {
      contexts(last: 40) { nodes {
        ... on CheckRun { name conclusion status }
        ... on StatusContext { context state }
      } }
    } } } }
  } }
}`;

const STATUS_TTL_MS = 60_000;
const statusCache = new Map<string, { at: number; status: Promise<PrStatus | null> }>();

async function fetchStatus(url: string): Promise<PrStatus | null> {
  const stdout = await gh(["api", "graphql", "-f", `query=${STATUS_QUERY}`, "-f", `url=${url}`], "gh api graphql (PR status)");
  const r = JSON.parse(stdout)?.data?.resource;
  if (r?.number === undefined) return null;
  const checks = normalizeChecks(r.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []);
  const state = String(r.state ?? "");
  return {
    url: String(r.url ?? url),
    number: r.number,
    repo: String(r.repository?.nameWithOwner ?? ""),
    title: String(r.title ?? ""),
    state,
    merge: state === "OPEN" ? mergeKind(r, checks) : "",
    checks: checks.map((c) => ({
      ...c,
      result: FAILED_CHECK_STATES.has(c.state) ? "failed" : OK_CHECK_STATES.has(c.state) ? "ok" : "pending",
    })),
  };
}

// The notch panel asks on every poll while a session is selected; GitHub only needs
// asking once a minute. A failed lookup (gh missing, no access) caches as null too.
export function prStatus(url: string): Promise<PrStatus | null> {
  const hit = statusCache.get(url);
  if (hit !== undefined && Date.now() - hit.at < STATUS_TTL_MS) return hit.status;
  const status = fetchStatus(url).catch(() => null);
  statusCache.set(url, { at: Date.now(), status });
  return status;
}
