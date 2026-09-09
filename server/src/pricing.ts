import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./config.js";

// USD per 1M tokens. Cache reads/writes are billed apart from fresh input, so a
// session's cost is meaningless without them: agent transcripts are mostly cache.
export interface Rate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// Longest matching prefix wins, so "claude-opus-4-8" beats "claude-opus".
const BUILT_IN: Record<string, Rate> = {
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-4": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // OpenAI rates are the coarse ones: override them in ~/.agent-board/pricing.json
  // if your plan differs.
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "o4": { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },
};

let overrides: Record<string, Rate> | null = null;

export async function loadPricing(): Promise<Record<string, Rate>> {
  if (overrides !== null) return { ...BUILT_IN, ...overrides };
  const raw = await fs.readFile(path.join(CONFIG_DIR, "pricing.json"), "utf8").catch(() => "");
  try {
    overrides = raw === "" ? {} : (JSON.parse(raw) as Record<string, Rate>);
  } catch {
    overrides = {};
  }
  return { ...BUILT_IN, ...overrides };
}

export function rateFor(model: string, table: Record<string, Rate>): Rate | null {
  let best: Rate | null = null;
  let bestLen = 0;
  for (const [prefix, rate] of Object.entries(table)) {
    if (model.startsWith(prefix) && prefix.length > bestLen) {
      best = rate;
      bestLen = prefix.length;
    }
  }
  return best;
}

export interface Usage {
  model: string;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

// Returns 0 for unknown models rather than guessing: an invented number in a cost
// view is worse than a visible zero.
export function costUsd(u: Usage, table: Record<string, Rate>): number {
  const r = rateFor(u.model, table);
  if (r === null) return 0;
  return (
    (u.tokensIn * r.input +
      u.tokensOut * r.output +
      u.cacheReadTokens * r.cacheRead +
      u.cacheWriteTokens * r.cacheWrite) /
    1_000_000
  );
}
