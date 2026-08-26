// The one chart on each /culture/funds source page.
//
// ⚠️ A CSS BAR LIST, NOT A CHART LIBRARY, and the choice is the same one
// `CultureConcentrationTile` and `HubHead`'s evidence aside already make:
// vendor-charts is ~115 KB br and lazy, and a list of bars is TEXT — so it
// prerenders, it translates, its labels are selectable, and it needs no measured
// container width (a chart in a grid item that guesses its width latches the
// guess and blows out on mobile — see the repo's no-fallback-width rule).
//
// ⚠️ ONE ARM PER RENDER. This takes a single arm's rows and nothing else: a
// component that accepted several would be a component that could draw two
// incomparable quantities on one axis, which is the reading /culture/funds
// exists to prevent. The four arms measure a grant, the same grant over a wider
// population, a published budget and a farm subsidy.
//
// ⚠️ THE CAPTION NAMES THE AXIS. „Най-големите" over bars is answerable three
// ways on the ИСУН arms alone (grant, contracted, paid), so every instance
// carries a `basis` the same way `HubKpi` and `HubEvidence` do.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { formatEurCompact, formatInt } from "@/lib/currency";

export interface BreakdownRow {
  /** Stable identity. ⚠️ Not the label: two bodies can share a name in this
   *  corpus, and React then reuses the wrong row. */
  id: string;
  label: string;
  eur: number;
  /** The row's own count — projects, participations, payments. Rendered beside
   *  the money so a long bar built from one large row cannot read as many. */
  count?: number;
}

export const CultureFundsBreakdown: FC<{
  heading: string;
  /** WHAT the bars measure. Required, for the reason in the header. */
  basis: string;
  rows: BreakdownRow[];
  /** The noun for `count`, already in the right plural for a numeral (the
   *  Bulgarian бройна форма: „47 проекта"). */
  countNoun?: string;
  /** The accent, from TILE_ACCENTS — the arm's own, so the bars here and the
   *  arm's card in the cross-arm strip read as one thing. */
  accent: string;
  /** One sentence under the bars, where the shape needs saying in words. */
  note?: string;
}> = ({ heading, basis, rows, countNoun, accent, note }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  // A blob that predates the breakdown, or an arm with nothing in it. Rendering
  // an empty frame would read as „this arm has no breakdown"; rendering nothing
  // is the honest absence.
  if (!rows.length) return null;

  // ⚠️ Guarded against a non-positive max: every euro column in this corpus is
  // nullable, so an all-zero arm would divide by zero and paint every bar at
  // NaN% — which CSS renders as full width, i.e. every row looking maximal.
  const max = Math.max(1, ...rows.map((r) => r.eur));

  return (
    // `data-og` is the og-capture anchor — the chart IS this page's card, and it
    // is the one block that is both distinctive per arm and self-explanatory in
    // a share preview (a heading, a declared axis, and named bars).
    <section
      data-og="culture-funds-breakdown"
      className="mt-6 rounded-xl border bg-card p-4"
    >
      <h2 className="text-base font-semibold">{heading}</h2>
      <p className="mt-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {basis}
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate" title={r.label}>
                {r.label}
              </span>
              <span className="shrink-0 tabular-nums font-medium">
                {formatEurCompact(r.eur, lang)}
                {r.count != null && countNoun ? (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    · {formatInt(r.count, lang)} {countNoun}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-muted">
              <div
                className="h-full rounded-sm"
                style={{
                  // Percentage width, so the bar needs no measured container —
                  // and `max` is clamped above, so this can never be NaN.
                  width: `${Math.max(0, (r.eur / max) * 100)}%`,
                  backgroundColor: accent,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      {note ? (
        <p className="mt-3 text-sm text-muted-foreground">{note}</p>
      ) : null}
    </section>
  );
};
