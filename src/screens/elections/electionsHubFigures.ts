// The `/elections` head band — four figures, each naming its own basis.
//
// ⚠ THE BAND IS ABOUT THE CORPUS AND ABOUT ONE CYCLE, and each cell says which. §3.1 settles
// that this page is the cross-kind ENTRY rather than a result: `/parliamentary` and
// `/elections/<latest>` already own "the latest result", so a band that merely restated the
// newest cycle would duplicate two pages that are already indexed. The first two cells are the
// coverage — what this hub can answer at all — and the last two are the resolved cycle's own
// protocol.
//
// ⚠ CELLS 3 AND 4 DESCRIBE THE SELECTED CYCLE WHEN IT CARRIES A PROTOCOL, and the basis
// always names WHOSE cycle they are. Two of the three catalogues carry one: the parliamentary
// entries embed their protocol, and `presidential_elections.json` carries each round's turnout
// and its basis. `local_elections.json` holds two dates and a kind — nothing to count — so a
// local selection falls back to the latest parliamentary cycle and SAYS SO, rather than
// silently attributing a parliamentary turnout to a local vote, which is the one thing a
// shared band must never do.
//
// ⚠ A PRESIDENTIAL CYCLE FILLS THEM FROM ITS OWN ROUND 1, and cell 4 counts TICKETS rather
// than parties. „Партии" beside a presidential turnout would be a category error: a ballot
// line is a president+vice-president pair, and 2021's 23 of them are not 23 parties. The basis
// names the round too — round 2 is a different electorate (2021: 40.30% against 34.63%) and a
// figure captioned only „presidential vote" would be true of neither.
//
// ⚠ AND ITS TURNOUT BASIS IS NOT ALWAYS NATIONAL. 2006's 144 abroad sections report neither a
// roll nor a signature count while casting 46,113 valid votes, so that cycle's rate covers the
// country only — captioned as national it would describe a different population from every
// other cycle's.
//
// ⚠ NO FETCH. Both catalogues are bundled JSON, so the band paints with the first frame and is
// never a skeleton — which also means `kpisPending` is never needed here.
//
// ⚠⚠ TWO TURNOUT RULES SHARE ONE SLOT — check which cell you are reading before comparing
// them. The PARLIAMENTARY cell imports `ballotTotals.ts`: cast over registered PLUS
// additional voters, with the `cast > denom` guard abroad's 329.6% needs. It was re-derived
// here once and came out WEAKER under the same name (it guarded a zero denominator and not
// that one), which is why it is imported and never restated. The PRESIDENTIAL cell renders a
// figure PRECOMPUTED by `tallyRound` (§2.5-11): signatures over the roll ALONE, which is the
// basis art. 93 (3) is argued on. Measured on round 1, the two differ by up to 1.63 points
// (2021: 40.30% against 38.67%), so they are NOT commensurable — which is why each cell's
// basis names its own.

import type { HubKpi } from "@/ux/infographic";
import { formatDate } from "@/lib/formatDate";
import allElections from "@/data/json/elections.json";
import allLocalElections from "@/data/json/local_elections.json";
import { turnoutPctOf, type Protocol } from "@/data/elections/ballotTotals";
import allPresidentialElections from "@/data/json/presidential_elections.json";
import type { PresidentialElectionEntry } from "@/data/presidentialCatalogue";
import type { ElectionsHubCycle } from "./electionsHubCycle";

const PARLIAMENTARY_IDS = new Set(allElections.map((e) => e.name));
const PRESIDENTIAL = allPresidentialElections as PresidentialElectionEntry[];

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

/**
 * Cells 3 and 4 for a selected PRESIDENTIAL cycle, from its own round 1.
 *
 * ⚠ IT RETURNS `null` RATHER THAN GUESSING when the id is not a catalogued cycle or its
 * round-1 block is missing — the caller then falls back to the latest parliamentary cycle
 * and captions it as such, which is the honest answer. Filling in „the latest presidential
 * cycle" instead would put one election's turnout under another's date.
 *
 * @param cycle - The resolved hub cycle, already known to be presidential.
 * @param t - The translator, for the two captions.
 * @param formatInt - Integer formatter for the ticket count.
 * @param formatPct - Percentage formatter for the turnout.
 * @param lang - Rendering language, for the date in the basis.
 * @returns The two cells, or `null` when this cycle cannot fill them.
 */
export const presidentialCells = (args: {
  cycle: ElectionsHubCycle;
  lang: string;
  t: (k: string, o?: Record<string, unknown>) => string;
  formatInt: (n: number) => string;
  formatPct: (n: number) => string;
}): HubKpi[] | null => {
  const entry = PRESIDENTIAL.find((e) => e.name === args.cycle.id);
  return entry ? presidentialCellsFor(entry, args) : null;
};

/**
 * The same two cells, over an entry the caller supplies.
 *
 * ⚠ THE SEAM EXISTS SO THE WITHHELD-TURNOUT BRANCH CAN BE REACHED. Every catalogued cycle
 * has a rate, so `turnoutPct === null` is unreachable from the corpus — and until it is
 * taken, `typeof … === "number"` is indistinguishable from a bare truthiness check. The
 * distinction is load-bearing: `null` through the screen's own formatter renders „0%", i.e.
 * „nobody voted".
 */
export const presidentialCellsFor = (
  entry: PresidentialElectionEntry,
  args: {
    lang: string;
    t: (k: string, o?: Record<string, unknown>) => string;
    formatInt: (n: number) => string;
    formatPct: (n: number) => string;
  },
): HubKpi[] | null => {
  const { lang, t, formatInt, formatPct } = args;
  const round1 = entry.rounds[1];
  if (!round1) return null;
  const when = { date: formatDate(entry.round1Date, lang) };
  // ⚠ TWO BASES, NOT ONE. The turnout's names the POPULATION it is over — a domestic-only
  // rate captioned as national is the 2006 trap, and it gets its own sentence rather than a
  // footnote nobody reads. The ticket count is NATIONAL EVEN THERE: 2006's abroad sections
  // report no roll, so its RATE covers the country only; its 7 ballot lines did not. Sharing
  // one string put „само в страната" under a national count.
  const turnoutBasis = t(
    round1.turnoutBasis === "domestic-only"
      ? "elections_kpi_basis_presidential_r1_domestic"
      : "elections_kpi_basis_presidential_r1",
    when,
  );
  const roundBasis = t("elections_kpi_basis_presidential_round1", when);
  const kpis: HubKpi[] = [];
  // ⚠ WITHHELD, NEVER ZEROED — the band's existing rule — and `typeof`, not `!== null`. The
  // catalogue arrives through a CAST, so a row that never wrote the field is `undefined`,
  // which passes a null check and reaches `Intl.NumberFormat.format` as „NaN%". `null` is
  // the answer „no rate"; `undefined` is not an answer at all, and neither may be printed.
  if (typeof round1.turnoutPct === "number")
    kpis.push({
      value: formatPct(round1.turnoutPct),
      label: t("elections_kpi_turnout"),
      basis: turnoutBasis,
    });
  if (entry.tickets)
    kpis.push({
      value: formatInt(entry.tickets),
      // ⚠ TICKETS, not parties. A ballot line is a president+vice-president pair.
      label: t("elections_kpi_tickets"),
      basis: roundBasis,
    });
  return kpis.length ? kpis : null;
};

export const electionsHubKpis = (args: {
  cycle: ElectionsHubCycle;
  lang: string;
  t: (k: string, o?: Record<string, unknown>) => string;
  formatInt: (n: number) => string;
  formatPct: (n: number) => string;
}): HubKpi[] => {
  const { cycle, lang, t, formatInt, formatPct } = args;
  const presidential =
    cycle.kind === "presidential" ? presidentialCells(args) : null;
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
  // ⚠ A PRESIDENTIAL CYCLE ANSWERS FOR ITSELF, and only then. `presidentialCells` returns
  // `null` when it cannot, and the parliamentary fallback below takes over — captioned as
  // the latest parliamentary cycle, which is what it is.
  if (presidential) return [...kpis, ...presidential];
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
