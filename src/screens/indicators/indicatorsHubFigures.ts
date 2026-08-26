// The /indicators head's KPI band, as a pure function over the macro payload.
//
// Out of the component for the reason `budgetHubFigures.ts`, `fundsHubFigures.ts`,
// `consumptionHubFigures.ts`, `subsidiesHubFigures.ts`, `declarationsHubFigures.ts`,
// `cultureHubFigures.ts` and `sectorsHubFigures.ts` are: a band built inline is unreachable
// from `hubHead.gates.test.ts`, whose band/tile clause compares band values against tile
// metrics as rendered strings.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ FOUR PERCENTAGES, FOUR DIFFERENT DENOMINATORS, AND TWO DIFFERENT QUARTERS.
//
// „2,7% · 5,8% · 3,0% · 28,5%" in one row reads as one scale. It is not: GDP growth is % on
// the same quarter a year earlier, inflation % on the previous year, unemployment % of the
// ACTIVE POPULATION and debt % of GDP. The payload already carries that distinction per
// indicator (`unitLabelBg` / `unitLabelEn`), so each cell's basis is READ FROM IT rather
// than written here — a hand-typed unit is a unit that goes stale when Eurostat re-bases a
// series, which is the frozen-string defect this repo condemns everywhere.
//
// And the PERIODS differ: the quarterly series do not all publish together, so on the
// committed payload growth and inflation are 2026-Q2 while unemployment and debt are
// 2026-Q1. A band that showed one date for all four would be wrong about two of them, so
// each cell names its own.
//
// ⚠️ THE SNAPSHOT IS THE SELECTED ELECTION'S, NOT THE CABINET ANCHOR'S. `useElectionAsOf`'s
// header is explicit and was written after the two were coupled once: the anchor is
// ADDITIVE, it drives the per-tile term-span footer, and letting it move the headline made
// the period label disagree with the election the reader picked. The band takes the same
// `asOf` the tiles do, so head and grid cannot show one indicator as of two dates.
// ═══════════════════════════════════════════════════════════════════════════════════════

import type { HubEvidence, HubKpi } from "@/ux/infographic/HubHead";
import type { MacroIndicatorKey } from "@/data/macro/useMacro";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** The four the band promotes, in order. The rest of `LANDING_KPI_ORDER` stays in the grid.
 *
 *  ⚠️ THE DOMAINS ARE MIXED ON PURPOSE — three economy, one fiscal. A band of four economy
 *  indicators would front one of the four hub tiles and say nothing about the other three;
 *  these are the four a reader arrives asking about, which is what a hub head is for. */
export const BAND_INDICATORS: MacroIndicatorKey[] = [
  "gdpGrowth",
  "inflation",
  "unemployment",
  "govDebt",
];

/** Which grid tile each band cell displaces — here the indicator IS the tile, so the set is
 *  simply the keys that rendered. Derived, never a constant: a cell is withheld when its
 *  series has no point at or before the selected election, and a constant list would then
 *  blank the grid tile too and drop the indicator off the page entirely. */
export const promotedIndicators = (kpis: IndicatorKpi[]): Set<string> =>
  new Set(kpis.flatMap((k) => (k.indicatorKey ? [k.indicatorKey] : [])));

/** A band cell that remembers which indicator it came from.
 *
 *  A local extension rather than a field on the shared `HubKpi`, for the reason
 *  `sectorsHubFigures.ts` states: this is one hub's bookkeeping, and widening the type six
 *  other bands use would put an always-undefined field on all of them. `HubKpi` is satisfied
 *  structurally. */
export interface IndicatorKpi extends HubKpi {
  indicatorKey?: MacroIndicatorKey;
}

/** One indicator's latest point at or before the snapshot, as the caller resolved it. */
export interface IndicatorPoint {
  value: number;
  /** Already formatted for display — the registry owns the format per indicator. */
  display: string;
  /** „2026 Q2" / „2026 Q2 г." — already localised by the caller's own formatter, which is
   *  the SAME one the grid tiles use. Two formatters is two spellings of one date. */
  periodLabel: string;
  /** The RAW „2026-Q2", kept beside the formatted label so a consumer can compare periods
   *  without re-parsing prose. The peers payload's distribution carries the same string, and
   *  ranking a Q2 value in a Q1 field is a claim nobody made. */
  period: string | undefined;
  /** „% от БВП" — from the payload's own metadata, never written here. */
  unitLabel: string;
  title: string;
  /** The domain page that can name the series behind the number. */
  to: string;
}

/** The head's four figures.
 *
 *  ⚠️ EVERY CELL'S BASIS IS ITS OWN UNIT PLUS ITS OWN PERIOD, and both come from the
 *  payload. That pairing is the whole point: four bare percentages invite comparison, and
 *  three of these four are not comparable with each other at all.
 *
 *  ⚠️ A CELL IS WITHHELD, NEVER ZEROED, when the series has no point at or before the
 *  selected election. The early elections in the selector predate several of these series,
 *  and „0%" would be a claim that the economy did not grow rather than that nobody measured
 *  it yet. */
export const indicatorsHubKpis = (
  points: Partial<Record<MacroIndicatorKey, IndicatorPoint>>,
): IndicatorKpi[] =>
  BAND_INDICATORS.flatMap((key) => {
    const p = points[key];
    if (!p) return [];
    return [
      {
        value: p.display,
        label: p.title,
        // UNIT · PERIOD. The separator is only there because both halves are.
        basis: `${p.unitLabel} · ${p.periodLabel}`,
        to: p.to,
        indicatorKey: key,
      },
    ];
  });

/** The sentence under the band that says the four are not one scale.
 *
 *  ⚠️ NOT A RESTATEMENT OF THE BASIS LINES. Each basis says what ITS figure measures; only
 *  this says that reading them against each other is a category error.
 *
 *  ⚠️⚠️ IT COUNTS AND NAMES NOTHING, and the first cut did both. It said „четирите числа" and
 *  described unemployment by its basis — but `unemployment` starts 2009-Q1 while the other
 *  three start 2005-Q1, so on `?elections=2005_06_25` (which IS in the header selector) the
 *  band renders THREE cells and the note described an indicator that is nowhere on the page.
 *  `sectorsHubFigures.ts` documents this same defect on this same election date; the `< 2`
 *  threshold below was copied from it and the reasoning behind it was not. The sentence now
 *  describes the KIND of thing these figures are, which is true of any subset of them.
 *
 *  Returns undefined below two cells, where there is nothing to compare. */
export const indicatorsKpiNote = (
  kpis: IndicatorKpi[],
  t: T,
): string | undefined =>
  kpis.length < 2 ? undefined : t("indicators_kpi_note");

/** One indicator's place among the EU peers, as the caller resolved it. */
export interface PeerRank {
  indicatorKey: MacroIndicatorKey;
  title: string;
  /** 1 = BEST, already normalised for direction by the payload — rank 1 on unemployment is
   *  the LOWEST and rank 1 on growth the HIGHEST. Never render it as „highest". */
  rank: number;
  /** ⚠️ NOT ALWAYS 27. Measured 2026-08-26: growth ranks in a field of 22 because five
   *  member states had not reported that quarter. „7th" without it is a different claim
   *  from „7 of 22". */
  total: number;
  to: string;
}

/** The head's evidence rail: where Bulgaria stands among the EU on the band's own four.
 *
 *  ⚠️⚠️ IT ANSWERS THE BAND RATHER THAN DECOMPOSING IT. „5,8% инфлация" is not interpretable
 *  on its own — the reader's actual question is whether that is bad — and the answer is 26th
 *  of 27. Same four indicators, same snapshot; the aside is the comparison the band cannot
 *  make about itself.
 *
 *  ⚠️ EVERY ROW CARRIES ITS FIELD SIZE, because the fields differ: 22 for growth, 27 for the
 *  rest. A bare „7th" beside a bare „1st" invites a comparison of two different-sized
 *  fields.
 *
 *  ⚠️ ORDERED BY PERCENTILE, not by rank, for the same reason — 7 of 22 is a worse standing
 *  than 3 of 27 and a rank sort would put it first. The basis says so.
 *
 *  ⚠️⚠️ IT IS USUALLY ABSENT, AND THAT IS THE DESIGN RATHER THAN A BUG. The payload carries
 *  only `latestDistribution` — one fixed period per indicator — while the band walks back to
 *  whichever election the reader picked. So the periods agree only on the LATEST election:
 *  measured 2026-08-26, the rail renders on 1 of the 13 in the selector and is empty on the
 *  other 12. Ranking a 2009 figure in a 2026 field is a claim nobody made, and the corpus
 *  has no historical distribution to rank it in — so the honest options were „absent" or
 *  „wrong", and this is absent. A fetch-vintage skew between the two payloads produces the
 *  same drop, but it is the RARE cause, not the main one.
 *
 *  ⚠️ REFUSED WHEN EMPTY rather than rendered blank: „no ranks" under a „where Bulgaria
 *  stands" heading reads as „nowhere". */
export const indicatorsHubEvidence = (
  ranks: PeerRank[],
  t: T,
): HubEvidence | undefined => {
  if (!ranks.length) return undefined;
  const ordered = [...ranks].sort(
    (a, b) =>
      a.rank / a.total - b.rank / b.total ||
      (a.indicatorKey < b.indicatorKey ? -1 : 1),
  );
  return {
    heading: t("indicators_evidence_heading"),
    // ⚠️ THE COUNT IS INTERPOLATED, because the rail is 1–4 rows and not always four. It
    // said „същите ЧЕТИРИ показателя" — the exact counting defect `indicatorsKpiNote`'s
    // docblock records being caught on the note, which then survived here. A row is dropped
    // whenever its peer period disagrees with its figure's, and that is the COMMON case
    // rather than the rare one (see below).
    basis: t("indicators_evidence_basis", { count: ordered.length }),
    rows: ordered.map((r) => ({
      id: r.indicatorKey,
      label: r.title,
      value: t("indicators_evidence_rank", { rank: r.rank, total: r.total }),
      to: r.to,
    })),
    action: {
      to: "/indicators/compare",
      label: t("indicators_evidence_action"),
    },
  };
};
