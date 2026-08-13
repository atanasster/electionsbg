// The map's layers and their palettes, split from the component so the one
// thing that can silently lie — the colour a município gets — is testable.
//
// THREE rules, and each corrects a way a choropleth of this data misleads:
//
//   1. **The default layer normalises by the município's own spending, not by
//      population.** Per resident is the wrong denominator for a fiscal-capacity
//      question: a €20m commitment against €10m of annual spending is a
//      different fact from the same €20m against €200m, and dividing by PEOPLE
//      makes a small município mid-project look reckless purely because its
//      denominator is small. чл. 130а т. 3 already normalises the right way and
//      comes with a legal threshold. Per resident stays available and is never
//      the default; its caption names the confound.
//   2. **Palettes break at the LEGAL threshold, not at min–max.** A sequential
//      ramp over a ratio with a statutory line hides the line: the darkest
//      município is whoever is highest, and „who is over" — the only question
//      the statute asks — becomes invisible. Below the line is one ramp, above
//      it another.
//   3. **The breaks are FIXED, not rescaled per year.** A per-year quantile
//      palette makes every year look identical, because the country always
//      spans the same colours end to end. That destroys the one thing a
//      multi-year map is for.
//
// A fourth rule lives in the component because it is about rendering: a
// município that did not file is `absent`, not zero, and gets a distinct
// no-data fill named in the legend with a count. Colouring it 0 would paint a
// non-filer the healthiest shade in the country.

import type { MunicipalFiscalRankingRow } from "@/data/budget/useMunicipalFiscalRanking";

export type LayerId =
  | "commitmentsPct"
  | "criteria"
  | "recovery"
  | "arrearsPct"
  | "collection"
  | "perCapita";

export const DEFAULT_LAYER: LayerId = "commitmentsPct";

export interface Layer {
  id: LayerId;
  labelKey: string;
  legendKey: string;
  /** Value for one município, or null when it cannot supply this layer. */
  value: (r: MunicipalFiscalRankingRow) => number | null;
  /** How the palette is anchored. `threshold` breaks at a legal line;
   *  `diverging` around the cohort's own centre; `quantile` has no anchor and
   *  is therefore only ever an opt-in layer. */
  scale:
    | {
        kind: "threshold";
        at: number;
        /** true = ABOVE the line is the concern */ overIsWorse: boolean;
      }
    | { kind: "ordinal"; max: number; at: number }
    | { kind: "binary" }
    | { kind: "diverging"; higherIsBetter: boolean }
    | { kind: "quantile" };
  format: (v: number, locale: string) => string;
  /** Only set on layers whose reading needs a warning beside the legend. */
  caveatKey?: string;
}

const pct = (v: number, locale: string) =>
  `${v.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;

export const LAYERS: Layer[] = [
  {
    // чл. 130а ал. 1 т. 3. The default, because it is the only layer that
    // controls for fiscal capacity and the only one with a statutory line.
    id: "commitmentsPct",
    labelKey: "mf_map_layer_commitments_pct",
    legendKey: "mf_map_legend_commitments_pct",
    value: (r) => r.commitments_pct,
    scale: { kind: "threshold", at: 50, overIsWorse: true },
    format: pct,
  },
  {
    // Bounded, ordinal and official — the most map-friendly field in the
    // dataset. The break is at 3 because that is where the statute puts it.
    id: "criteria",
    labelKey: "mf_map_layer_criteria",
    legendKey: "mf_map_legend_criteria",
    // NULL when nothing could be evaluated — NOT 0. An off-Q4 row, or a Q4 row
    // whose inputs МФ froze, has an empty `criteria_evaluable`, and „0 met" is
    // the palest teal on this palette: the healthiest fill in the country,
    // handed to a município we know nothing about. The table on the same page
    // renders „—" for exactly these rows, and the two must not disagree.
    value: (r) =>
      (r.criteria_evaluable?.length ?? 0) === 0
        ? null
        : (r.criteria_met?.length ?? 0),
    // SEVEN, per МФ's own enumeration — see CRITERIA_TOTAL in the loader. The
    // break stays at 3 because the statute's threshold is „three or more"
    // regardless of the total.
    scale: { kind: "ordinal", max: 7, at: 3 },
    format: (v) => `${v}`,
    caveatKey: "mf_map_caveat_criteria",
  },
  {
    // An administrative status the município declared, NOT our derivation.
    id: "recovery",
    labelKey: "mf_map_layer_recovery",
    legendKey: "mf_map_legend_recovery",
    value: (r) =>
      r.in_recovery_procedure == null ? null : r.in_recovery_procedure ? 1 : 0,
    scale: { kind: "binary" },
    format: (v) => (v ? "1" : "0"),
  },
  {
    // чл. 130а ал. 1 т. 4.
    id: "arrearsPct",
    labelKey: "mf_map_layer_arrears_pct",
    legendKey: "mf_map_legend_arrears_pct",
    value: (r) => r.arrears_pct,
    scale: { kind: "threshold", at: 5, overIsWorse: true },
    format: pct,
  },
  {
    // чл. 130а ал. 1 т. 6 — tax-administration quality, wholly independent of
    // project timing, so it tells a different story from every layer above.
    // Diverging around the cohort's own mean, because the statute's own test is
    // „below the national average" rather than a fixed number.
    id: "collection",
    labelKey: "mf_map_layer_collection",
    legendKey: "mf_map_legend_collection",
    value: (r) => r.collection_avg_pct,
    scale: { kind: "diverging", higherIsBetter: true },
    format: pct,
  },
  {
    // Opt-in, never default (rule 1). The caveat is not optional decoration —
    // it is the whole reason this layer is not the default.
    id: "perCapita",
    labelKey: "mf_map_layer_per_capita",
    legendKey: "mf_map_legend_per_capita",
    value: (r) => r.commitments_per_capita_eur,
    scale: { kind: "quantile" },
    format: (v, locale) =>
      `€${v.toLocaleString(locale, { maximumFractionDigits: 0 })}`,
    caveatKey: "mf_map_caveat_per_capita",
  },
];

export const layerById = (id: LayerId): Layer =>
  // NOT `LAYERS[0]` — a positional fallback agrees with DEFAULT_LAYER only
  // while `commitmentsPct` happens to be first, so reordering the toolbar
  // would silently change what an unknown `?layer` resolves to.
  LAYERS.find((l) => l.id === id) ??
  LAYERS.find((l) => l.id === DEFAULT_LAYER)!;

/** Positive = concern, negative = comfort, both in [-1, 1]. `null` means the
 *  município cannot be coloured on this layer at all.
 *
 *  A SIGNED intensity rather than a 0..1 ramp position, so the component cannot
 *  accidentally render „just under the legal line" and „just over it" as
 *  neighbouring shades of one colour — the break has to survive into the fill. */
export const intensity = (
  layer: Layer,
  v: number | null,
  cohort: { max: number; mean: number; spread: number },
): number | null => {
  if (v == null) return null;
  const s = layer.scale;
  switch (s.kind) {
    case "threshold": {
      // Fixed anchor: the legal line maps to 0 and the palette saturates at
      // TWICE the line. Fixed rather than cohort-relative so 2019 and 2024 are
      // the same colours for the same numbers.
      const t = (v - s.at) / s.at;
      const signed = Math.max(-1, Math.min(1, t));
      return s.overIsWorse ? signed : -signed;
    }
    case "ordinal": {
      // 0..max, breaking at `at`. Below the break the reader wants „how far
      // from it", above it „how far past".
      const t = (v - s.at) / Math.max(s.at, s.max - s.at);
      return Math.max(-1, Math.min(1, t));
    }
    case "binary":
      return v ? 1 : -1;
    case "diverging": {
      // Around the cohort's own centre, because the statute's test IS relative
      // („below the national average"). Spread-normalised so a tight cohort
      // still uses the full palette.
      const t = cohort.spread === 0 ? 0 : (v - cohort.mean) / cohort.spread;
      const clamped = Math.max(-1, Math.min(1, t));
      // `|| 0` normalises -0 to 0. Harmless for the fill (-0 >= 0 is true, so
      // it takes the same branch), but a signed zero leaking out of a helper
      // whose whole contract is „which side of the line" is the kind of thing a
      // caller compares with Object.is and gets wrong.
      return (s.higherIsBetter ? -clamped : clamped) || 0;
    }
    case "quantile": {
      // No anchor exists, so this is the one layer whose colours ARE
      // cohort-relative — and the reason it may never be the default.
      //
      // LOG, for the reason `FundsMuniMapTile` gives about the same metric: the
      // tail is ~14x the median, so a linear ramp is one flat colour plus one
      // red município. Measured on the committed corpus: the median is 7.1% of
      // the max and 91% of municipalities sit below 20% of it, i.e. inside the
      // first fifth of a linear scale.
      if (cohort.max <= 0) return 0;
      const l =
        Math.log10(Math.max(v, 1)) / Math.log10(Math.max(cohort.max, 10));
      // Mapped onto the FULL signed range, not [0, 1]. `fillFor` treats i >= 0
      // as the concern ramp, so a [0, 1] layer paints the entire country amber
      // to red — including the least-committed município in Bulgaria. With no
      // anchor to divide at, the honest reading is „where in the national
      // spread", which needs the whole palette: the log put the median at 0.70
      // of the ramp, i.e. already firmly red.
      return Math.max(-1, Math.min(1, 2 * l - 1));
    }
  }
};

/** Max, mean and spread over the values it is HANDED. It does no filtering of
 *  its own — the caller passes only the values a layer could actually supply,
 *  which is what keeps a município that reported nothing from dragging the
 *  diverging layer's centre toward a number nobody published. */
export const cohortStats = (
  values: number[],
): { max: number; mean: number; spread: number } => {
  if (values.length === 0) return { max: 0, mean: 0, spread: 0 };
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { max, mean, spread: Math.sqrt(variance) || 1 };
};

/** Signed intensity → a fill. Two ramps meeting at the break, so „over the
 *  line" is a different HUE and not merely a darker shade of the same one. */
export const fillFor = (i: number | null): string => {
  // The no-data fill. CATEGORICALLY different, not a neighbouring shade: at
  // 88% lightness it was rgb(224,224,224) against rgb(200,228,228) for „best in
  // the country", which on a small polygon with a hairline border is the same
  // reader-level outcome as colouring a non-filer zero — reached from the other
  // direction. A dark neutral sits outside both ramps' lightness range, so it
  // cannot be mistaken for a value however light the comfort end goes.
  if (i == null) return "hsl(0, 0%, 55%)";
  if (i >= 0) {
    // amber → red, the concern side
    const l = 62 - 26 * Math.min(i, 1);
    const h = 40 - 40 * Math.min(i, 1);
    return `hsl(${h}, 78%, ${l}%)`;
  }
  // teal, the comfort side — a different hue family so the break is visible
  // even to a reader who cannot separate the two ramps by lightness.
  const l = 62 + 22 * Math.min(-i, 1);
  return `hsl(180, 34%, ${l}%)`;
};
