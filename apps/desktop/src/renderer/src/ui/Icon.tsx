import type { ReactNode } from "react";

export type IconName =
  | "plus"
  | "search"
  | "spark"
  | "monitor"
  | "wallet"
  | "settings"
  | "paperclip"
  | "arrow-up"
  | "refresh"
  | "file"
  | "trash"
  | "user";

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    search: <path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />,
    spark: (
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm6 12 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" />
    ),
    monitor: <path d="M4 5h16v11H4V5Zm5 15h6m-3-4v4" />,
    wallet: (
      <path d="M4 6.5h14a2 2 0 0 1 2 2V18H6a2 2 0 0 1-2-2V6.5Zm0 0A2.5 2.5 0 0 1 6.5 4H17v2.5M16 11h4v4h-4a2 2 0 1 1 0-4Z" />
    ),
    settings: (
      <path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm0-5 1 2.2 2.4.6 2-1.3 1.6 1.6-1.3 2 .6 2.4 2.2 1v2l-2.2 1-.6 2.4 1.3 2-1.6 1.6-2-1.3-2.4.6-1 2.2h-2l-1-2.2-2.4-.6-2 1.3L5 19.4l1.3-2-.6-2.4-2.2-1v-2l2.2-1 .6-2.4-1.3-2L6.6 5l2 1.3 2.4-.6 1-2.2h2Z" />
    ),
    paperclip: <path d="m8.5 12.5 5.8-5.8a3 3 0 0 1 4.2 4.2l-7.2 7.2a5 5 0 0 1-7.1-7.1l7-7" />,
    "arrow-up": <path d="m6 11 6-6 6 6M12 5v14" />,
    refresh: <path d="M20 6v5h-5M4 18v-5h5m10-2a7 7 0 0 0-12-4L4 11m16 2-3 4a7 7 0 0 1-12-4" />,
    file: <path d="M7 3h7l4 4v14H7V3Zm7 0v5h5M10 13h5m-5 4h5" />,
    trash: <path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />,
    user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths[name]}
      </g>
    </svg>
  );
}
