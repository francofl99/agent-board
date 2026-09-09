import type { Provider } from "./types";

// Drawn rather than imported: two marks that read at 12px and tell the providers
// apart at a glance — Claude's radial burst, Codex's six-lobed knot.
const CLAUDE_RAYS = [0, 45, 90, 135, 180, 225, 270, 315];

export function ProviderIcon({ provider, size = 12 }: { provider: Provider; size?: number }) {
  if (provider === "codex") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        {[0, 60, 120].map((a) => (
          <ellipse
            key={a}
            cx="12"
            cy="12"
            rx="4.1"
            ry="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            transform={`rotate(${a} 12 12)`}
          />
        ))}
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {CLAUDE_RAYS.map((a, i) => (
        <line
          key={a}
          x1="12"
          y1="12"
          x2="12"
          y2={i % 2 === 0 ? 1.5 : 4}
          stroke="currentColor"
          strokeWidth={i % 2 === 0 ? 3 : 2.4}
          strokeLinecap="round"
          transform={`rotate(${a} 12 12)`}
        />
      ))}
    </svg>
  );
}

export const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};
