// The /governance/sectors head's KPI band, as a pure function over the sector-stats payload.
//
// Out of the component for the reason `budgetHubFigures.ts`, `fundsHubFigures.ts`,
// `consumptionHubFigures.ts`, `subsidiesHubFigures.ts`, `declarationsHubFigures.ts` and
// `cultureHubFigures.ts` are: a band built inline is unreachable from
// `hubHead.gates.test.ts`, whose band/tile clause compares band values against tile metrics
// as rendered strings.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ NINETEEN SECTORS ON FOUR BASES, AND ONLY ONE GROUP MAY BE SUMMED.
//
// `useSectorStats`' header is explicit that the headline's MEANING varies by sector —
// `budget` (a ПРБ's приет expenditure), `payout` (transfer outlay), `procurement` (tender €
// in the selected scope) and `headcount` (filled positions). A band is where a reader adds
// things, so the rule this module enforces is:
//
//   • `procurement` IS summed. Its four rosters (АПИ, ВиК, МТС, energy) are DISJOINT —
//     measured 2026-08-26, 72 EIKs and 0 overlaps — and all four read the SAME selected
//     scope, so the total is one basis over one window and the pill moves it.
//   • NOTHING ELSE IS. The other bases mix YEARS inside themselves, not just across:
//     `budget` is 2026 for nine sectors and a 2025 уточнен план for НАП and Митници;
//     `payout` is 2024 for НОИ and 2025 for НЗОК and ДФЗ. „€17.4bn изплатено" over those
//     three is a number describing no year at all. So each of those cells carries ONE
//     sector's figure with ONE year — the largest, named — and nothing is added.
//
// `sectorsKpiNote` says the four bases do not combine. It is the page's central claim and
// the reason the tiles are ordered by cluster rather than by size.
// ═══════════════════════════════════════════════════════════════════════════════════════

import type { HubEvidence, HubKpi } from "@/ux/infographic/HubHead";
import type { SectorStat } from "@/data/procurement/useSectorStats";
import { formatEurCompact } from "@/lib/currency";

type T = (key: string, opts?: Record<string, unknown>) => string;

export type SectorStats = Record<string, SectorStat> | undefined;

/** A band cell that remembers which sector it took its figure from.
 *
 *  ⚠️ A LOCAL EXTENSION, not a field on the shared `HubKpi`. Three of the four cells here
 *  name whichever sector is largest on their basis, so the tile they displace is only
 *  knowable at render — but that is this hub's problem, and widening the type every other
 *  hub uses to carry it would put an always-undefined field on six bands. `HubKpi` is
 *  satisfied structurally, so these pass to `HubHead` unchanged. */
export interface SectorKpi extends HubKpi {
  /** Set on the three single-sector cells; absent on the procurement total, which is a sum
   *  over four sectors and therefore displaces no one tile. */
  sectorId?: string;
}

/** Which tile a band cell displaces, keyed by that cell's DESTINATION.
 *
 *  ⚠️ KEYED ON WHAT THE BAND EMITTED, never a compile-time list. Three of the four cells
 *  name whichever sector happens to be largest on their basis, so the displaced tile is not
 *  knowable until the payload is read — and every cell is withheld when its basis has no
 *  publishable sector. A constant list would blank a tile whose cell never rendered. */
export const promotedTiles = (
  kpis: SectorKpi[],
  evidence?: HubEvidence,
): Set<string> =>
  new Set([
    ...kpis.flatMap((k) => (k.sectorId ? [k.sectorId] : [])),
    // ⚠️ THE ASIDE'S ROWS COUNT TOO. §3.1's rule is that a rail row is a figure no tile and
    // no KPI shows — and this rail's four rows are the four procurement tiles' own metrics,
    // verbatim: same label, same €, same destination. The band cell above them is their SUM,
    // so none of the four is promoted by a KPI; without this they were printed twice on one
    // page, once in the head and once in the grid.
    ...(evidence?.rows ?? []).flatMap((r) => (r.id ? [r.id] : [])),
  ]);

/** The bases whose cells name a single sector, in band order. Exported for gates. */
export const SINGLE_SECTOR_BASES = ["budget", "payout", "headcount"] as const;

/** The four sectors whose headline is tender € in the selected scope.
 *
 *  ⚠️ DERIVED FROM THE PAYLOAD, never written down. The roster lives in the generator
 *  (`SECTOR_EIKS`), and a hard-coded list here would keep summing four sectors after a fifth
 *  joined — silently under-reporting the one figure on this band that IS a total. */
const procurementIds = (stats: SectorStats): string[] =>
  Object.entries(stats ?? {})
    .filter(([, s]) => s.basis === "procurement" && !s.unavailable && s.value)
    .map(([id]) => id);

/** The largest publishable sector on one basis, or null. */
const largestOn = (
  stats: SectorStats,
  basis: SectorStat["basis"],
): { id: string; stat: SectorStat } | null => {
  const rows = Object.entries(stats ?? {})
    .filter(([, s]) => s.basis === basis && !s.unavailable && s.value)
    // Ties broken by id so the band is deterministic — two sectors on one basis can carry
    // the same rounded figure, and a band that reorders between renders is a band whose
    // gate cannot pin it.
    .sort(([aId, a], [bId, b]) => b.value - a.value || (aId < bId ? -1 : 1));
  return rows.length ? { id: rows[0][0], stat: rows[0][1] } : null;
};

/** The head's four figures.
 *
 *  ⚠️ ONLY THE FIRST IS A SUM — see this file's header. The other three each carry one
 *  sector's own number with its own year, because their bases mix years internally and a
 *  cross-year total describes nothing.
 *
 *  ⚠️ A CELL IS WITHHELD, NEVER ZEROED, when its basis has no publishable sector. On a
 *  `y:<year>` scope a sector's series may not reach that year (`unavailable`), and the
 *  payload legitimately predates a basis. „€0 изплатено" would be a claim; an absent cell
 *  is not. */
export const sectorsHubKpis = (
  stats: SectorStats,
  lang: string,
  period: string | undefined,
  t: T,
  titleOf: (sectorId: string) => string,
  hrefOf: (sectorId: string) => string | undefined,
  /** Where the cross-sector procurement TOTAL links. Its own parameter rather than a
   *  sentinel id through `hrefOf`: the total belongs to no sector, and the sentinel form
   *  needed a `?? "/procurement"` fallback that silently reintroduced the scope-dropping
   *  bare path the cell exists to avoid. */
  procurementHref: string,
): SectorKpi[] => {
  if (!stats) return [];
  const out: SectorKpi[] = [];

  const procIds = procurementIds(stats);
  if (procIds.length) {
    const total = procIds.reduce((a, id) => a + stats[id].value, 0);
    out.push({
      value: formatEurCompact(total, lang),
      label: t("sectors_kpi_procurement"),
      // The COUNT rides in the basis so „€29,6 млрд." is never read as the whole state's
      // procurement — it is four sectors of nineteen, over the window the pill names.
      // ⚠️ THE PERIOD IS OPTIONAL AND THE SEPARATOR GOES WITH IT. `scopeProcurementPeriod`
      // returns undefined on the all-corpus scope BY DESIGN, and a template with the middot
      // baked in then renders „4 сектора … · " with a dangling separator — on the very
      // scope this page's own control offers and the one the share card is shot at.
      basis: period
        ? t("sectors_kpi_procurement_basis_period", {
            count: procIds.length,
            period,
          })
        : t("sectors_kpi_procurement_basis", { count: procIds.length }),
      // ⚠️ SCOPED, and the caller owns that. This figure is the ONLY one on the band that
      // moves with the pill — measured, €672.6m on the selected parliament against €29.6bn
      // all-time — so a bare pathname sends the reader to a page answering for a different
      // window than the number they clicked.
      to: procurementHref,
    });
  }

  for (const basis of SINGLE_SECTOR_BASES) {
    const top = largestOn(stats, basis);
    if (!top) continue;
    const title = titleOf(top.id);
    out.push({
      value:
        basis === "headcount"
          ? Math.round(top.stat.value).toLocaleString(lang)
          : formatEurCompact(top.stat.value, lang),
      // The SECTOR is the label, because the figure is that sector's and no one else's.
      label: title,
      basis: t(`sectors_kpi_${basis}_basis`, {
        year: top.stat.year ?? "",
      }).trim(),
      to: hrefOf(top.id),
      sectorId: top.id,
    });
  }
  return out;
};

/** The sentence under the band that says the four bases do not combine.
 *
 *  ⚠️ NOT A RESTATEMENT OF THE BASIS LINES. Each basis says what ITS cell measures; only
 *  this says they measure incommensurable things, which is the page's central claim and the
 *  reason its tiles are ordered by cluster rather than by size.
 *
 *  ⚠️ IT COUNTS THE SECTORS' BASES, NOT THE BAND'S CELLS, and the first cut got that wrong.
 *  It said „четирите числа" — but a cell is withheld whenever its basis has no publishable
 *  sector, and over the committed payload the band is short on 8 of 30 scope keys (cell
 *  counts {1:4, 2:4, 3:4, 4:18}). On `ns:2005_06_25` it named „поръчките" while that cell
 *  was absent entirely, all four rosters being €0 before the corpus starts. The sentence now
 *  describes the four bases the SECTORS sit on, which is true at every scope and of every
 *  band length. Returns undefined below two cells, where there is nothing to combine. */
export const sectorsKpiNote = (kpis: SectorKpi[], t: T): string | undefined =>
  kpis.length < 2 ? undefined : t("sectors_kpi_note");

/** The head's evidence rail: the tender-driven sectors, ranked.
 *
 *  ⚠️⚠️ IT IS THE DECOMPOSITION OF THE BAND'S FIRST CELL, and that is the whole reason it
 *  is these four and not „the biggest sectors". The band sums `procurement` because those
 *  rosters are disjoint and share a window; the rail shows what that sum is made of, so the
 *  two halves of the head are one claim at two grains rather than two rankings.
 *
 *  ⚠️ AND IT MUST SAY WHY THE OTHER FIFTEEN ARE ABSENT. A ranked list of four sectors on a
 *  page showing nineteen reads as „these are the big ones" — which is false: Пенсии alone is
 *  €11.1bn, larger than any row here, and it is not in the list because its money never goes
 *  to tender. The basis line says so in words. Ranking all nineteen together is the one
 *  thing this hub must never do.
 *
 *  ⚠️ REFUSED WHEN THE GROUP IS EMPTY rather than rendered blank — on an early `ns:` scope
 *  every roster is €0 (the corpus starts in 2011), and an empty rail under „кои сектори
 *  минават през търг" reads as „none do". */
export const sectorsHubEvidence = (
  stats: SectorStats,
  lang: string,
  t: T,
  titleOf: (sectorId: string) => string,
  hrefOf: (sectorId: string) => string | undefined,
): HubEvidence | undefined => {
  const rows = Object.entries(stats ?? {})
    .filter(([, x]) => x.basis === "procurement" && !x.unavailable && x.value)
    // Ties broken by id, for the reason `largestOn` states: a rail that reorders between
    // renders is a rail whose gate cannot pin it.
    .sort(([aId, a], [bId, b]) => b.value - a.value || (aId < bId ? -1 : 1));
  if (!rows.length) return undefined;
  return {
    heading: t("sectors_evidence_heading"),
    basis: t("sectors_evidence_basis"),
    rows: rows.map(([id, x]) => ({
      // The sector id, not the title: titles are translated, and a translation collision
      // would make React reuse the wrong row.
      id,
      label: titleOf(id),
      value: formatEurCompact(x.value, lang),
      to: hrefOf(id),
    })),
    action: {
      to: "/procurement",
      label: t("sectors_evidence_action"),
    },
  };
};
