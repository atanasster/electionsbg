// Shared building blocks for the /indicators/* domain pages — split out so
// each sub-screen file stays focused on its section layout.

import { FC } from "react";

export type ChartSource = { href: string; label: string };

export const ChartSources: FC<{
  sources: ChartSource[];
  prefix: string;
}> = ({ sources, prefix }) => (
  <p className="text-[11px] text-muted-foreground mb-3">
    {prefix}{" "}
    {sources.map((s, i) => (
      <span key={s.href}>
        {i > 0 ? " · " : null}
        <a
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {s.label}
        </a>
      </span>
    ))}
  </p>
);
