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
}

const FIELDS = "number,title,repository,url,isDraft,createdAt,updatedAt";

// All PR data comes from the existing `gh` CLI login, so there is no extra credential
// to store. Throws (never returns partial data) if gh is missing or not authenticated.
async function searchPrs(filter: string[], role: PrRole, limit: number): Promise<OpenPr[]> {
  const args = ["search", "prs", ...filter, "--state", "open", "--json", FIELDS, "--limit", String(limit)];
  try {
    const { stdout } = await run("gh", args, { maxBuffer: 10 * 1024 * 1024 });
    const rows = JSON.parse(stdout) as any[];
    return rows.map((r) => ({
      number: r.number,
      title: String(r.title ?? ""),
      repo: String(r.repository?.nameWithOwner ?? r.repository?.name ?? ""),
      url: String(r.url ?? ""),
      isDraft: Boolean(r.isDraft),
      createdAt: String(r.createdAt ?? ""),
      updatedAt: String(r.updatedAt ?? ""),
      role,
    }));
  } catch (e) {
    throw new Error(
      `gh search prs ${filter.join(" ")} failed — is gh installed and authenticated? ` +
        `(gh auth status). ${(e as Error).message}`
    );
  }
}

export function fetchMyOpenPrs(limit = 100): Promise<OpenPr[]> {
  return searchPrs(["--author", "@me"], "author", limit);
}

// `--review-requested @me` returns only PRs where the review request on you is still
// PENDING: GitHub clears the request as soon as you submit a review, so PRs you already
// reviewed drop out on their own (and reappear if someone re-requests).
// Caveat: requests routed through a team you belong to are not matched by this qualifier
// (that needs team-review-requested:org/team).
export function fetchPrsAwaitingMyReview(limit = 100): Promise<OpenPr[]> {
  return searchPrs(["--review-requested", "@me"], "reviewer", limit);
}

export const PR_FETCHERS: Record<PrRole, (limit?: number) => Promise<OpenPr[]>> = {
  author: fetchMyOpenPrs,
  reviewer: fetchPrsAwaitingMyReview,
};
