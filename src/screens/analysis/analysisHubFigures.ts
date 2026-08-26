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

import type { HubKpi } from "@/ux/infographic/HubHead";
import type { AnalysisStat } from "@/data/analysis/useAnalysisStats";

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
