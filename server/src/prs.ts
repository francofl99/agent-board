import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface OpenPr {
  number: number;
  title: string;
  repo: string; // owner/name
  url: string;
  isDraft: boolean;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// `gh search prs --author @me --state open` lists the current user's open PRs across
// every repo the authenticated gh account can see — reusing the existing gh login, so
// there is no extra credential to store. Returns [] if gh is missing or not logged in.
export async function fetchMyOpenPrs(limit = 100): Promise<OpenPr[]> {
  const fields = "number,title,repository,url,isDraft,createdAt,updatedAt";
  try {
    const { stdout } = await run(
      "gh",
      ["search", "prs", "--author", "@me", "--state", "open", "--json", fields, "--limit", String(limit)],
      { maxBuffer: 10 * 1024 * 1024 }
    );
    const rows = JSON.parse(stdout) as any[];
    return rows.map((r) => ({
      number: r.number,
      title: String(r.title ?? ""),
      repo: String(r.repository?.nameWithOwner ?? r.repository?.name ?? ""),
      url: String(r.url ?? ""),
      isDraft: Boolean(r.isDraft),
      createdAt: String(r.createdAt ?? ""),
      updatedAt: String(r.updatedAt ?? ""),
    }));
  } catch (e) {
    throw new Error(
      `gh search prs failed — is gh installed and authenticated? (gh auth status). ${(e as Error).message}`
    );
  }
}
