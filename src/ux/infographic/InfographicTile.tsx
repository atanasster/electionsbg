// InfographicTile — the reusable dashboard-hub tile. Two layouts from one
// component: a COMPACT ROW on phones (small scene thumbnail on the left + text on
// the right, so a long list stays scannable) that flips to a full banner-on-top
// CARD from `sm` up. The flex-direction switch (row → col) is what turns the left
// thumbnail into a top banner and the right divider into a bottom one.
//
// Presentation only — it fetches nothing and knows nothing about sectors. Feed it
// a destination, some strings, a TILE_ACCENTS token and a decorative `scene`
// component. Text/badge/CTA colours are derived from the accent by mixing toward
// the theme foreground, so they stay legible as the theme flips.

import { FC } from "react";
import { Link } from "react-router-dom";

export interface InfographicTileProps {
  /** Destination route. */
  to: string;
  /** Primary label (already localized). */
  title: string;
  /** Optional short badge, e.g. an agency acronym (not localized — an acronym). */
  badge?: string;
  /** Optional one-line descriptor (already localized); truncates on mobile. */
  desc?: string;
  /** Accent hex from TILE_ACCENTS — sets `--sector` for the tile + its scene. */
  accent: string;
  /** Decorative scene component (renders inside a SceneFrame, aria-hidden). */
  scene: FC;
  /** Optional CTA shown only on the card layout (sm+), e.g. "виж сектора". */
  cta?: string;
}

export const InfographicTile: FC<InfographicTileProps> = ({
  to,
  title,
  badge,
  desc,
  accent,
  scene: Scene,
  cta,
}) => (
  <Link
    to={to}
    style={{ ["--sector" as string]: accent }}
    className="group relative flex flex-row overflow-hidden rounded-xl border border-border bg-card transition-all duration-150 hover:border-[color-mix(in_srgb,var(--sector)_55%,hsl(var(--border)))] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:flex-col sm:rounded-2xl sm:hover:-translate-y-0.5 motion-reduce:sm:hover:translate-y-0"
  >
    <div
      className="flex w-24 shrink-0 items-center border-r border-border sm:w-full sm:border-b sm:border-r-0"
      style={{
        background:
          "linear-gradient(160deg, color-mix(in srgb, var(--sector) 14%, hsl(var(--card))), hsl(var(--card)))",
      }}
    >
      <Scene />
    </div>
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2.5 sm:justify-start sm:gap-1.5 sm:p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-base font-semibold tracking-tight sm:text-lg">
          {title}
        </span>
        {badge ? (
          <span
            className="shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-bold tracking-wide"
            style={{
              color:
                "color-mix(in srgb, var(--sector) 72%, hsl(var(--foreground)))",
              background: "color-mix(in srgb, var(--sector) 16%, transparent)",
              borderColor: "color-mix(in srgb, var(--sector) 30%, transparent)",
            }}
          >
            {badge}
          </span>
        ) : null}
      </div>
      {desc ? (
        <span className="truncate text-xs text-muted-foreground sm:whitespace-normal sm:text-sm">
          {desc}
        </span>
      ) : null}
      {cta ? (
        <span
          className="mt-auto hidden items-center gap-1.5 pt-1.5 text-xs font-semibold sm:inline-flex"
          style={{
            color:
              "color-mix(in srgb, var(--sector) 70%, hsl(var(--foreground)))",
          }}
        >
          {cta}
          <span className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none">
            →
          </span>
        </span>
      ) : null}
    </div>
  </Link>
);
