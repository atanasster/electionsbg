// PassThroughHero (a.k.a. the "iceberg" hero) — a reusable part-to-whole bar for
// the PASS-THROUGH / inversion sector packs, where the entity controls far more
// money than it procures (social, regional, environment). It places a whole
// envelope (e.g. the €15bn social-protection function) as one bar, splits it into
// labelled segments (one highlighted as "this view's slice"), and — optionally —
// blows up a tiny procurement sliver so the reader sees how little of the money is
// competed procurement. OG-screenshottable (CSS flex bars, `data-og`), fixed
// colour-by-segment. Home for the social view; RegionalPack / environment reuse it.
//
// Design rules (dataviz house): one bar, fixed segment order/colours, a legend that
// stays readable at any width (in-bar text clips), and a plain-language caption.

import { FC, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { LucideIcon } from "lucide-react";

export interface PassThroughSegment {
  /** Legend label. */
  label: string;
  /** Segment € (share of the whole computed from these). */
  eur: number;
  /** Tailwind bg-* class for the bar + legend swatch. */
  colorClass: string;
  /** When set, the segment's legend row links here (e.g. → /pensions). */
  to?: string;
  /** Highlight this as the view's own slice (bolder legend). */
  highlight?: boolean;
}

export interface PassThroughHeroProps {
  id?: string;
  dataOg?: string;
  icon?: LucideIcon;
  title: string;
  /** The whole-envelope headline (e.g. "€15,09 млрд. · социална защита, 2024"). */
  wholeLabel: string;
  wholeEur: number;
  /** Locale for number formatting ("bg" | "en"). */
  lang: string;
  segments: PassThroughSegment[];
  /** Optional "iceberg" sliver blown up below the bar (e.g. procurement vs a slice). */
  sliver?: {
    label: string;
    eur: number;
    /** The denominator the sliver is a share OF (e.g. the highlighted segment €). */
    ofEur: number;
    /** Plain-language caption; `share` token is replaced with the computed %. */
    caption: (share: string) => ReactNode;
  };
  /** Source footnote line. */
  footnote: ReactNode;
}

const pctLabel = (share: number, lang: string): string =>
  share <= 0
    ? "—"
    : share < 0.005
      ? lang === "bg"
        ? "под 0,5%"
        : "under 0.5%"
      : `~${(share * 100).toLocaleString(lang, { maximumFractionDigits: share < 0.1 ? 1 : 0 })}%`; // prettier-ignore

export const PassThroughHero: FC<PassThroughHeroProps> = ({
  id,
  dataOg,
  icon: Icon,
  title,
  wholeLabel,
  wholeEur,
  lang,
  segments,
  sliver,
  footnote,
}) => {
  const total = segments.reduce((s, x) => s + Math.max(0, x.eur), 0) || 1;
  const sliverShare =
    sliver && sliver.ofEur > 0 ? sliver.eur / sliver.ofEur : 0;

  return (
    <Card id={id}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4" />}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent data-og={dataOg} className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">
            {formatEurCompact(wholeEur, lang)}
          </span>
          <span className="text-xs text-muted-foreground">{wholeLabel}</span>
        </div>

        {/* Part-to-whole bar — fixed segment order/colours. */}
        <div
          className="flex h-7 overflow-hidden rounded-md border"
          role="img"
          aria-label={segments
            .map((s) => `${s.label} ${formatEurCompact(s.eur, lang)}`)
            .join(", ")}
        >
          {segments.map((s, i) => {
            const w = (Math.max(0, s.eur) / total) * 100;
            if (w <= 0) return null;
            return (
              <div
                key={i}
                className={s.colorClass}
                style={{ width: `${w}%` }}
                title={`${s.label}: ${formatEurCompact(s.eur, lang)}`}
              />
            );
          })}
        </div>

        {/* Legend — readable at any width. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {segments.map((s, i) => {
            const share = pctLabel(Math.max(0, s.eur) / total, lang);
            const body = (
              <>
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-sm ${s.colorClass}`}
                />
                <span
                  className={s.highlight ? "font-medium text-foreground" : ""}
                >
                  {s.label}
                </span>{" "}
                <span className="tabular-nums">
                  {formatEurCompact(s.eur, lang)} ({share})
                </span>
              </>
            );
            return s.to ? (
              <Link
                key={i}
                to={s.to}
                className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
              >
                {body}
              </Link>
            ) : (
              <span key={i} className="inline-flex items-center gap-1.5">
                {body}
              </span>
            );
          })}
        </div>

        {/* The iceberg sliver — procurement blown up against its slice. */}
        {sliver && (
          <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-sm leading-snug">
            {sliver.caption(pctLabel(sliverShare, lang))}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/80">{footnote}</p>
      </CardContent>
    </Card>
  );
};
