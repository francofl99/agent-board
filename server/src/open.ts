import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Client, Provider } from "./types.js";

const run = promisify(execFile);

export type OpenTarget = "claude-cli" | "claude-desktop" | "codex-cli" | "codex-desktop";

export interface OpenOption {
  target: OpenTarget;
  label: string;
  hint: string; // the actual command/URL, shown in the menu so nothing is magic
}

export function optionsFor(provider: Provider, sessionId: string): OpenOption[] {
  if (provider === "codex") {
    return [
      { target: "codex-cli", label: "Codex CLI", hint: `codex resume ${sessionId}` },
      { target: "codex-desktop", label: "Codex Desktop", hint: `codex://threads/${sessionId}` },
    ];
  }
  return [
    { target: "claude-cli", label: "Claude CLI", hint: `claude --resume ${sessionId}` },
    { target: "claude-desktop", label: "Claude Desktop", hint: "claude://resume" },
  ];
}

export function defaultTarget(provider: Provider, client: Client): OpenTarget {
  const desktop = client === "desktop";
  if (provider === "codex") return desktop ? "codex-desktop" : "codex-cli";
  return desktop ? "claude-desktop" : "claude-cli";
}

function appleScriptString(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

// A CLI session resumes in a real terminal: there is no URL scheme for it, and
// spawning the agent headless would defeat the point (the work happens in the CLI).
async function openTerminal(cwd: string, command: string): Promise<void> {
  const shell = `cd ${JSON.stringify(cwd || process.env.HOME || "~")} && ${command}`;
  const script = `tell application "Terminal"\nactivate\ndo script ${appleScriptString(shell)}\nend tell`;
  await run("osascript", ["-e", script]);
}

export async function openSession(
  target: OpenTarget,
  sessionId: string,
  cwd: string
): Promise<string> {
  switch (target) {
    case "claude-cli":
      await openTerminal(cwd, `claude --resume ${sessionId}`);
      return `claude --resume ${sessionId}`;
    case "claude-desktop": {
      const url = `claude://resume?session=${encodeURIComponent(sessionId)}&folder=${encodeURIComponent(cwd)}`;
      await run("open", [url]);
      return url;
    }
    case "codex-cli":
      await openTerminal(cwd, `codex resume ${sessionId}`);
      return `codex resume ${sessionId}`;
    case "codex-desktop": {
      const url = `codex://threads/${sessionId}`;
      await run("open", [url]);
      return url;
    }
  }
}

export async function revealFile(filePath: string): Promise<void> {
  await run("open", ["-R", filePath]);
}
