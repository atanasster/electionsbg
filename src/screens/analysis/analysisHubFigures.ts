// The KPI band shared by /parliamentary/analysis and /parliamentary/reports, as a pure
// function over `analysis_stats.json`.
//
// Out of the components for the reason the sibling `*HubFigures.ts` modules are: a band
// built inline is unreachable from `hubHead.gates.test.ts`, whose band/tile clause compares
// band values against tile metrics as rendered strings. ONE module for both hubs because
// they read one payload through one pair of helpers, and their `risk` cell is literally the
// same figure — two copies would be two ways to caption it.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ TWO OF THESE FIGURES ARE FLAGS, NOT FINDINGS, AND A BAND IS WHERE THAT IS LOST.
//
// „6" beside „4" beside „18,0%" reads as four comparable measurements of one thing. They are
// not, and two of them are statements about ELECTORAL INTEGRITY, which is the most expensive
// place in this repo to be casually wrong:
//
//   · `risk` is 6 sections of 12,705 in the COMPOSITE risk score's critical band — seven
//     weighted signals across TWO families (procedural: recount churn, СУЕМГ mismatch,
//     invalid ballots, additional voters; distribution: concentration, peer outlier, swing).
//     It is a list of places worth looking at, not a list of places where something
//     happened. Only `risk` carries a denominator, so beside a bare „4" it silently invites
//     the reading that both are counts of the same kind.
//
//     ⚠️⚠️ NEVER CAPTION IT „процедурни" / „procedural". That word names the party-blind
//     SUB-score in this repo, and `risk_score.ts` warns in capitals that the composite
//     cannot answer a question the distribution family already measures — so calling the
//     composite procedural publishes a narrower, party-blind reading than the corpus or the
//     destination page supports. The first cut of this basis did exactly that, and this
//     comment illustrated „procedural" with „a turnout jump", which is `swing`/`peerOutlier`
//     — i.e. the comment meant to encode the rule demonstrated the confusion it encodes.
//     `analysisHubFigures.test.ts` now refuses EITHER family name in the string.
//   · `benford` is 4 parties whose digit distribution departs from the Benford curve — and
//     the destination page's own caveat is titled „Това не е доказателство за фалшификация",
//     because section vote counts span too narrow a range to satisfy the test's premise and
//     MANY CLEAN DATASETS FAIL IT. A band cell that says „4 партии" without that is a
//     stronger claim than the page it links to makes, about named parties.
//
// So every basis here carries the denominator AND what the number is not, and
// `analysisKpiNote` says the set is not a scale. This is the one hub where the caption is
// more load-bearing than the figure.
// ═══════════════════════════════════════════════════════════════════════════════════════

import type { HubEvidence, HubKpi } from "@/ux/infographic/HubHead";
import type { AnalysisStat } from "@/data/analysis/useAnalysisStats";
// ⚠️ DERIVED, not restated: a fifth screening band would otherwise land in the spread object,
// be typed away, and never reach the rail. (A typo IN `EVIDENCE_BANDS` is already caught —
// `counts[band]` would not index — so only this direction was open.)
import type { RiskBand } from "@/data/riskScore/useRiskScore";

type T = (key: string, opts?: Record<string, unknown>) => string;

export type AnalysisStats = Record<string, AnalysisStat> | undefined;

/** A band cell that remembers which stat it came from, so the tile carrying that same stat
 *  can be demoted. A local extension rather than a field on the shared `HubKpi`, for the
 *  reason `sectorsHubFigures.ts` states. */
export interface AnalysisKpi extends HubKpi {
  statId?: string;
}

/** The tiles whose metric this band is carrying, derived from the cells that rendered.
 *
 *  ⚠️ DERIVED, never a constant: a cell is withheld when the selected election's payload has
 *  no such stat — the early cycles carry fewer analyses — and a constant list would blank the
 *  tile too, dropping the figure off the page entirely. */
export const promotedStats = (kpis: AnalysisKpi[]): Set<string> =>
  new Set(kpis.flatMap((k) => (k.statId ? [k.statId] : [])));

/** One promoted stat: which payload key, and the i18n key for its basis.
 *
 *  ⚠️ NO `to` HERE — each screen supplies it from ITS OWN registry. The two hubs point the
 *  same `risk` stat at different pages (`/risk-analysis` on analysis, `/risk-score` on
 *  reports), so a destination baked in here would be right for one hub and wrong for the
 *  other, and would drift the day either registry moved a tile. */
export interface BandStat {
  statId: string;
  /** ⚠️ ITS OWN KEY, not the tile's `captionKey`. The tile's caption is a one-word label
   *  („партии с отклонение") sitting under a number the reader has already seen in context;
   *  a band basis has to survive being screenshotted alone, so it states the denominator and
   *  the limit. Sharing the key would force one string to do both jobs and it would end up
   *  doing the weaker one. */
  basisKey: string;
}

/** /parliamentary/analysis — the four with a meaning a caption can carry.
 *
 *  ⚠️ `polls` AND `demographics` ARE DELIBERATELY OUT. Both are `kind: "score"` — 1.76 and
 *  1.43, bare numbers whose unit lives only in their caption („най-добра грешка", „най-голямо
 *  разделение"). In a tile the scene and the title carry that; in a band they would be two
 *  unlabelled decimals beside a percentage and a count. They stay on their tiles, where they
 *  read. */
export const ANALYSIS_BAND: BandStat[] = [
  { statId: "risk", basisKey: "analysis_kpi_risk_basis" },
  { statId: "benford", basisKey: "analysis_kpi_benford_basis" },
  { statId: "wasted", basisKey: "analysis_kpi_wasted_basis" },
  { statId: "persistence", basisKey: "analysis_kpi_persistence_basis" },
];

/** /parliamentary/reports — the two its own registry carries a `statId` for.
 *
 *  A TWO-cell band, and that is the honest size: the reports hub fronts anomaly REPORTS, and
 *  only these two have a headline number at all. Padding it with a figure from the analysis
 *  payload that no report on this page is about would be a band describing a different page. */
export const REPORTS_BAND: BandStat[] = [
  { statId: "risk", basisKey: "analysis_kpi_risk_basis" },
  { statId: "turnout", basisKey: "analysis_kpi_turnout_basis" },
];

/** The head's figures for one hub.
 *
 *  ⚠️ THE VALUE IS FORMATTED BY THE CALLER'S OWN HELPER — `formatAnalysisMetric`, the same
 *  one the tiles use. Two formatters would be two spellings of one number on one page.
 *
 *  ⚠️ A CELL IS WITHHELD, NEVER ZEROED, when the payload has no such stat. The earlier
 *  cycles carry fewer analyses, and „0 критични секции" is a claim that every section was
 *  clean rather than that nobody ran the check. */
export interface AnalysisKpiArgs {
  band: BandStat[];
  stats: AnalysisStats;
  format: (s: AnalysisStat | undefined) => string | undefined;
  /** Thousands-grouped, for the denominators the basis lines interpolate.
   *
   *  ⚠️ i18next INTERPOLATES A RAW NUMBER VERBATIM, so `{{total}}` rendered „от 12705" — the
   *  headline beside it is grouped by `formatAnalysisMetric`, which put two number formats
   *  in one cell. The caller passes its own locale's formatter. */
  formatInt: (n: number) => string;
  labelOf: (statId: string) => string;
  /** From the hub's OWN registry — see `BandStat`. A stat with no tile on this hub has no
   *  destination and its cell is withheld: §3.1 rule 4 asks that a KPI link to a page that
   *  can name its rows, and a hub that does not front the analysis cannot. */
  hrefOf: (statId: string) => string | undefined;
  t: T;
}

/** ⚠️ AN OPTIONS OBJECT, NOT SEVEN POSITIONALS, AND THE REASON IS TYPE-SAFETY RATHER THAN
 *  TASTE. `labelOf: (id) => string` and `hrefOf: (id) => string | undefined` are adjacent
 *  and structurally compatible in ONE direction — `string` is assignable to
 *  `string | undefined` — so passing `labelOf` where `hrefOf` belongs TYPE-CHECKS, and the
 *  band then labels every cell with a URL. Both call sites are ten-line argument lists where
 *  a transposition is invisible in review. Named fields cannot be transposed. */
export const analysisHubKpis = ({
  band,
  stats,
  format,
  formatInt,
  labelOf,
  hrefOf,
  t,
}: AnalysisKpiArgs): AnalysisKpi[] =>
  band.flatMap((b) => {
    const stat = stats?.[b.statId];
    const value = format(stat);
    const to = hrefOf(b.statId);
    if (!stat || !value || !to) return [];
    return [
      {
        value,
        label: labelOf(b.statId),
        // `total` rides in wherever the basis names one — `risk` names „от 12 705", and the
        // denominator is the whole point of it. (Do NOT quote the tile's own caption here:
        // `analysis_stat_risk_caption` is a different key with a deliberately different job,
        // per `BandStat.basisKey` above, and a comment quoting it drifts on the first edit.)
        basis: t(b.basisKey, {
          total: stat.total != null ? formatInt(stat.total) : "",
        }),
        to,
        statId: b.statId,
      },
    ];
  });

/** The sentence under the band.
 *
 *  ⚠️ IT SAYS „NOT A SCALE" AND „NOT A VERDICT", and the second half is the one that matters.
 *  Each basis says what ITS figure measures and does not; only this says that reading the row
 *  across is a category error, and that a flag on this page is an invitation to look rather
 *  than a conclusion.
 *
 *  ⚠️ IT COUNTS NOTHING. A cell is withheld whenever the selected election's payload lacks
 *  that stat, so the band is 0–4 cells on /analysis and 0–2 on /reports; a sentence naming
 *  „четирите" would describe a row that is not there. That defect has now been caught twice
 *  in this series — on /governance/sectors and on /indicators — and this is the third hub to
 *  inherit the lesson rather than the bug. Withheld below two cells, where there is nothing
 *  to read across. */
export const analysisKpiNote = (
  kpis: AnalysisKpi[],
  t: T,
): string | undefined => (kpis.length < 2 ? undefined : t("analysis_kpi_note"));

/** Thousands-grouped, ALWAYS — the one integer formatter this module's two hubs share.
 *
 *  ⚠️⚠️ `n.toLocaleString("bg")` DOES NOT GROUP A FOUR-DIGIT NUMBER, and this module prints
 *  four- and five-digit counts in one column. Bulgarian CLDR uses `minimumGroupingDigits: 2`,
 *  so the rail rendered „297 · **1629** · 10 773" — one row ungrouped between two grouped
 *  ones, which at a glance reads as a magnitude difference rather than a formatting one. EN
 *  groups from four digits by default, so the defect is invisible in the language the tests
 *  and the reviewer read.
 *
 *  ⚠️ ITS REACH IS THE RAIL AND THE BAND'S INTERPOLATED DENOMINATOR, AND NO FURTHER. The
 *  band's own VALUE and the tiles' captions still go through the locale default, inside
 *  `formatAnalysisMetric` / `analysisMetricCaption` — so a four-digit `total` would render
 *  „от 9999" on a tile beside „от 9 999" in the band. Unreachable on today's corpus
 *  (`totalSections` is 11,902–12,705 across all 13 folders and `counts.critical` is 2–9), and
 *  closing it means routing those two through here, which touches every analysis tile. Stated
 *  rather than implied: an earlier revision of this comment claimed the wider reach. */
export const groupedInt = (lang: string): ((n: number) => string) => {
  // ⚠️ `true`, NOT THE DEFAULT — and not the string "always" either. ECMA-402's
  // GetStringOrBooleanOption normalizes `true` TO "always", so the two are the same option
  // and only `true` type-checks under this repo's lib without a cast. What produces „1629"
  // is OMITTING the field: the default resolves to "auto", which defers to the locale's
  // `minimumGroupingDigits`. Verified on Node 22: `{useGrouping: true}` resolves to "always"
  // and formats 1629 as „1 629" in bg, while the default resolves to "auto" and does not.
  // (An earlier revision cast the string in and claimed `true` meant "use the locale's rule";
  // that was wrong on both halves.) `analysisHubFigures.test.ts` pins the bg four-digit case.
  const nf = new Intl.NumberFormat(lang, { useGrouping: true });
  return (n) => nf.format(n);
};

/** The band counts off `risk_score_summary.json`, as the caller resolved them. */
export type RiskBandCounts = Record<RiskBand, number> & {
  totalSections: number;
};

/** ⚠️ THE THREE BANDS THE HEAD DOES NOT ALREADY SHOW, most severe first — `critical` is
 *  DELIBERATELY ABSENT. §3.1's rule for a rail is that a row is a figure no tile and no KPI
 *  shows, and the critical count IS the band's first cell on both hubs; printing it again
 *  eight centimetres lower is the band/tile clash one column over. The basis points at it in
 *  words instead of repeating the number. */
export const EVIDENCE_BANDS = [
  "high",
  "elevated",
  "low",
] as const satisfies readonly RiskBand[];

/** The head's evidence rail: how the other 12,699 sections fall out.
 *
 *  ⚠️⚠️ IT ANSWERS THE BAND'S FIRST CELL RATHER THAN DECOMPOSING IT, which is the same job
 *  `/indicators`' peer rail does. „6 секции" is not interpretable on its own — the reader's
 *  actual question is whether six is a lot — and the answer is that 10,773 of 12,705 carry no
 *  significant signal at all. That is the deflationary direction, and on a page whose two
 *  loudest figures are electoral-integrity FLAGS the deflationary direction is the one a head
 *  owes the reader.
 *
 *  ⚠️ IT IS THE SAME RAIL ON BOTH HUBS, and that is correct rather than lazy: it is one
 *  distribution of one corpus, and `risk` is one figure both hubs front. What differs is the
 *  DESTINATION — /risk-analysis against /risk-score — so `hrefOf` comes from the hub, exactly
 *  as `BandStat` explains for the band.
 *
 *  ⚠️ RULE 4 IS SATISFIED WEAKLY AND ON PURPOSE. There is no per-band URL, so all three rows
 *  and the action share one destination. That page is a TABLE carrying a band badge on every
 *  row (`RiskScoreScreen`'s `band` column), so it can name the sections behind „297 висок" —
 *  it just cannot be deep-linked to them. Do not invent a `?band=` the screen does not read.
 *
 *  ⚠️ REFUSED WHEN THE SUMMARY IS ABSENT rather than rendered as zeros: „0 секции с повишен
 *  риск" is a claim that the corpus was screened and came back clean, which is the exact
 *  inversion of „nobody ran the screen". */
export const analysisHubEvidence = (
  counts: RiskBandCounts | undefined,
  formatInt: (n: number) => string,
  labelOf: (band: (typeof EVIDENCE_BANDS)[number]) => string,
  to: string | undefined,
  t: T,
): HubEvidence | undefined => {
  if (!counts || !counts.totalSections) return undefined;
  return {
    heading: t("analysis_evidence_heading"),
    // ⚠️ THE TOTAL IS INTERPOLATED AND THE CRITICAL COUNT IS NOT. The denominator is what
    // makes the three rows readable; the critical count is the cell directly above and is
    // named in words („критичната лента е числото горе") so the page states it once.
    basis: t("analysis_evidence_basis", {
      total: formatInt(counts.totalSections),
    }),
    rows: EVIDENCE_BANDS.map((band) => ({
      id: band,
      label: labelOf(band),
      value: formatInt(counts[band]),
      to,
    })),
    action: to ? { to, label: t("analysis_evidence_action") } : undefined,
  };
};
