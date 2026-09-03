// The `/elections` head band — four figures, each naming its own basis.
//
// ⚠ THE BAND IS ABOUT THE CORPUS AND ABOUT ONE CYCLE, and each cell says which. §3.1 settles
// that this page is the cross-kind ENTRY rather than a result: `/parliamentary` and
// `/elections/<latest>` already own "the latest result", so a band that merely restated the
// newest cycle would duplicate two pages that are already indexed. The first two cells are the
// coverage — what this hub can answer at all — and the last two are the resolved cycle's own
// protocol.
//
// ⚠ CELLS 3 AND 4 ALWAYS DESCRIBE A PARLIAMENTARY CYCLE, and the basis names WHICH. Only the
// parliamentary catalogue carries a protocol; `local_elections.json` holds two dates and a
// kind. So when the reader has selected a local cycle these two fall back to the latest
// parliamentary one — and say so in the basis rather than silently attributing a parliamentary
// turnout to a local vote, which is the one thing a shared band must never do.
//
// ⚠ NO FETCH. Both catalogues are bundled JSON, so the band paints with the first frame and is
// never a skeleton — which also means `kpisPending` is never needed here.
//
// ⚠ THE TURNOUT RULE IS IMPORTED, NOT RESTATED. It was declared here — this file could not
// reach the generator's copy, which opens with `node:fs` — and the re-derivation came out
// WEAKER with the same name: it guarded a zero denominator and not a `cast > denom` one, which
// is abroad at 329.6%. It reads the national protocol, where that guard never fires, so the two
// agreed on every value anyone looked at. `ballotTotals.ts` is now the one definition.

import type { HubKpi } from "@/ux/infographic";
import { formatDate } from "@/lib/formatDate";
import allElections from "@/data/json/elections.json";
import allLocalElections from "@/data/json/local_elections.json";
import { turnoutPctOf, type Protocol } from "@/data/elections/ballotTotals";
import type { ElectionsHubCycle } from "./electionsHubCycle";

const PARLIAMENTARY_IDS = new Set(allElections.map((e) => e.name));

/** The parliamentary cycle cells 3 and 4 describe: the resolved one when it is parliamentary,
 *  the latest otherwise. */
export const parliamentaryBasisCycle = (
  c: ElectionsHubCycle,
): { id: string; date: string; isResolved: boolean } => {
  if (c.kind === "parliamentary" && PARLIAMENTARY_IDS.has(c.id))
    return { id: c.id, date: c.date, isResolved: true };
  const latest = allElections[0];
  return {
    id: latest.name,
    date: latest.name.split("_").join("-"),
    isResolved: false,
  };
};

export const electionsHubKpis = (args: {
  cycle: ElectionsHubCycle;
  lang: string;
  t: (k: string, o?: Record<string, unknown>) => string;
  formatInt: (n: number) => string;
  formatPct: (n: number) => string;
}): HubKpi[] => {
  const { cycle, lang, t, formatInt, formatPct } = args;
  const basisCycle = parliamentaryBasisCycle(cycle);
  const entry = allElections.find((e) => e.name === basisCycle.id);
  const protocol = entry?.results?.protocol as Protocol | undefined;
  const turnout = protocol ? turnoutPctOf(protocol) : null;
  const parties = entry?.results?.votes?.length;
  const dateLabel = formatDate(basisCycle.date, lang);
  // ⚠ THE BASIS SAYS WHOSE CYCLE IT IS. Identical wording for a resolved and a
  // fallen-back cycle would let a local selection render a parliamentary turnout under a
  // label the reader reads as their own.
  const cycleBasis = basisCycle.isResolved
    ? t("elections_kpi_basis_cycle", { date: dateLabel })
    : t("elections_kpi_basis_latest_parliamentary", { date: dateLabel });

  const kpis: HubKpi[] = [
    {
      value: formatInt(allElections.length),
      label: t("elections_kpi_parliamentary"),
      basis: t("elections_kpi_basis_since_2005"),
      to: "/parliamentary",
    },
    {
      value: formatInt(allLocalElections.length),
      label: t("elections_kpi_local"),
      basis: t("elections_kpi_basis_regular_local"),
    },
  ];
  // ⚠ WITHHELD, NEVER ZEROED. A protocol this build cannot read is not a turnout of 0%, and
  // an early cycle legitimately carries fewer fields than the newest one.
  if (turnout !== null)
    kpis.push({
      value: formatPct(turnout),
      label: t("elections_kpi_turnout"),
      basis: cycleBasis,
    });
  if (parties)
    kpis.push({
      value: formatInt(parties),
      label: t("elections_kpi_parties"),
      basis: cycleBasis,
    });
  return kpis;
};
