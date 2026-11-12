import type { InboxSource } from "./types";

const common = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const SOURCE_NAME: Record<InboxSource, string> = {
  pr: "GitHub",
  jira: "Jira",
  slack: "Slack",
  mail: "Mail",
  alert: "Alerta",
};

export function SourceIcon({ source, size = 14 }: { source: InboxSource | "now" | "done"; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...common}>
      {source === "pr" && (
        <>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="18" cy="18" r="2.5" />
          <path d="M6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-4M13 3.5 10.5 6 13 8.5" />
        </>
      )}
      {source === "jira" && (
        <>
          <path d="M3 9.5v-2a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a2.5 2.5 0 0 0 0 5v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a2.5 2.5 0 0 0 0-5z" />
          <path d="M14 6.5v11" strokeDasharray="2 2.5" />
        </>
      )}
      {source === "slack" && <path d="M9.5 4 7.5 20M16.5 4l-2 16M4.5 9h16M3.5 15h16" strokeWidth={2.2} />}
      {source === "mail" && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
        </>
      )}
      {source === "alert" && <path d="M12 4 2.5 20h19zM12 10v4.5M12 17.5v.01" />}
      {source === "now" && <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />}
      {source === "done" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12.5 3 3 5-6" />
        </>
      )}
    </svg>
  );
}
