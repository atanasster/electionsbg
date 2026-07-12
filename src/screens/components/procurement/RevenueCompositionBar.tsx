// Shared "откъде идват парите" composition hero for the revenue packs (НАП,
// Митници). A collector's mirror of the spender packs' budget-bridge bar: the
// headline collected number, a stacked composition bar (validated categorical
// ramp, 2px surface gaps as the separator — never a border), and a reconciling
// legend (swatch · label · € · %). The hero figure uses PROPORTIONAL figures
// (not tabular-nums) per the dataviz mark specs; tabular-nums stays in the
// aligned legend column.

import { FC } from "react";
import { formatEurCompact } from "@/lib/currency";

export interface CompositionSegment {
  key: string;
  label: string;
  eur: number;
  /** CSS colour (hex from the validated ramp, or a CSS var for the residual). */
  color: string;
}

const pct = (v: number, lang: string) =>
  (v * 100).toLocaleString(lang, { maximumFractionDigits: 1 }) + "%";

export const RevenueCompositionBar: FC<{
  headlineEur: number;
  headlineLabel: string;
  segments: CompositionSegment[];
  lang: string;
}> = ({ headlineEur, headlineLabel, segments, lang }) => {
  const eur = (v: number) => formatEurCompact(v, lang);
  const total = segments.reduce((a, s) => a + s.eur, 0) || 1;
  const shown = segments.filter((s) => s.eur > 0);

  return (
    <div className="space-y-4">
      {/* Headline — proportional figures (no tabular-nums on a display number) */}
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-bold">{eur(headlineEur)}</span>
        <span className="text-sm text-muted-foreground">{headlineLabel}</span>
      </div>

      {/* Composition bar — flex-grow gives each segment its share; the 2px gap
          in the surface colour separates fills (no border ink). */}
      <div>
        <div className="flex h-6 w-full gap-0.5 overflow-hidden rounded-md">
          {shown.map((s) => (
            <div
              key={s.key}
              className="h-full first:rounded-l-md last:rounded-r-md"
              style={{
                flexGrow: s.eur,
                flexBasis: 0,
                backgroundColor: s.color,
              }}
              title={`${s.label}: ${eur(s.eur)}`}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {shown.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-medium tabular-nums">{eur(s.eur)}</span>
              <span className="text-muted-foreground/70 tabular-nums">
                {pct(s.eur / total, lang)}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
