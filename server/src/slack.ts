import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const KEYCHAIN_SERVICE = "agent-board-slack";

// SLACK_USER_TOKEN from server/.env wins; otherwise the macOS Keychain, so the token can
// also live outside any file.
async function userToken(): Promise<string> {
  const fromEnv = process.env.SLACK_USER_TOKEN?.trim() ?? "";
  if (fromEnv !== "") return fromEnv;
  try {
    const { stdout } = await run("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]);
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function slackConfigured(): Promise<boolean> {
  return (await userToken()) !== "";
}

export interface SlackTarget {
  workspace: string;
  channel: string;
  threadTs: string;
}

// A permalink names the message to answer. Inside a thread it carries thread_ts; a channel
// message starts a thread under itself; in a DM the reply goes to the conversation, as you
// would answer it by hand.
export function targetOf(permalink: string): SlackTarget | null {
  let u: URL;
  try {
    u = new URL(permalink);
  } catch {
    return null;
  }
  const m = u.pathname.match(/^\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})$/i);
  if (m === null || !u.hostname.endsWith(".slack.com")) return null;
  const [, channel, sec, micro] = m;
  const inThread = u.searchParams.get("thread_ts") ?? "";
  const isDm = channel.startsWith("D");
  const threadTs = inThread !== "" ? inThread : isDm ? "" : `${sec}.${micro}`;
  return { workspace: u.hostname, channel, threadTs };
}

export interface Sent {
  at: string;
  text: string;
  permalink: string;
}

export async function sendReply(target: SlackTarget, text: string): Promise<Sent> {
  const token = await userToken();
  if (token === "") throw new Error("Falta el token de Slack (SLACK_USER_TOKEN o el Llavero)");
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      channel: target.channel,
      text,
      ...(target.threadTs !== "" ? { thread_ts: target.threadTs } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await r.json()) as { ok: boolean; error?: string; ts?: string };
  if (!body.ok || body.ts === undefined) throw new Error(`Slack: ${body.error ?? r.status}`);
  const id = body.ts.replace(".", "");
  const thread = target.threadTs !== "" ? `?thread_ts=${target.threadTs}&cid=${target.channel}` : "";
  return {
    at: new Date().toISOString(),
    text,
    permalink: `https://${target.workspace}/archives/${target.channel}/p${id}${thread}`,
  };
}
