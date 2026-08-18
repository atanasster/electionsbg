// Pre-generate the headline stat for the government-sector tiles (the
// /governance/sectors hub + the "featured sectors" strip on /procurement).
// Written as one small static file the tiles read — same pattern + serving path
// as hub_stats.json (committed + bucket-synced; the rest of procurement is
// PG-only).
//
// Keyed by the SAME scope key the frontend computes (useScopeWindow), so
// the sectors hub's scope control is live:
//   ns:<election>  — the selected parliament's tenure window
//   y:<year>       — one calendar year
//   all            — the full corpus
//
//   npm run db:gen-sector-stats   # reads PG (after db:refresh) + bespoke JSON
//
// The headline answers "how much money does this sector spend from public
// funds?" — so most sectors carry a BUDGET or PAYOUT figure, not their thin
// procurement line. Each stat therefore also carries a `basis` the tile turns
// into a one-word caption (бюджет / изплатено / поръчки / служители / успех), so
// the mixed metric kinds stay honest side by side. Five bases:
//   - budget (annual): the tax-funded bodies whose tile fronts a budget seat.
//     Two shapes, same basis + caption (бюджет <year>):
//       * first-level ПРБ — defense (МО), security (МВР), justice (ВСС/съдебна
//         власт), culture (Min. Culture), edu (МОН), tourism (МТ), social (МТСП),
//         regional (МРРБ), environment (МОСВ). The last two are PASS-THROUGH
//         ministries: they control far more than they procure, so a procurement
//         headline buries the sector's own thesis (see BUDGET_SECTOR_NODE).
//         Value = that PRB's enacted expenditure from
//         data/budget/ministries/<node>.json (execution is null there;
//         `expenditure` = приет по ЗДБРБ). Procurement alone understated these
//         100×–78,000× (Култура showed €3k vs a €234M budget).
//       * second-level agencies with no clean ЗДБРБ line — revenue (НАП) and
//         customs (Агенция „Митници“). Both are второстепенни разпоредители по
//         бюджета на МФ, so the budget law carries no per-agency total and the
//         МФ program budget lumps them into one „ефективно събиране / администри-
//         ране на приходите“ line (~€312M in 2025) that crosses both agencies.
//         Value = each agency's OWN годишен уточнен план (собствен ведомствен
//         бюджет) from data/budget/agencies/{nap,customs}.json — sourced from
//         НАП's годишен отчет and АМ's Отчет за касовото изпълнение (see those
//         files' `source`). Slightly different basis than the ЗДБРБ-приет above
//         (final adjusted plan, not initial law figure), but the only clean
//         per-agency budget that exists — far more honest than their thin tender
//         line, which understated НАП/АМ the same way.
//   - payout (annual): pension = ДОО fund pension outlay (funds.json), health =
//     НЗОК cash execution (nzok/execution_history.json), agri = ДФЗ CAP paid
//     (agri_payloads) — transfers, not contracts.
//   - procurement (windowed): the operational/commercial seats whose real spend
//     IS their tender flow, not a tiny ministry line — roads (АПИ), water (ВиК),
//     transport (МТС rail/ports group), energy (the state energy sector under
//     the Minister of Energy). Summed per scope from `contracts`.
//   - score: RETIRED 2026-08-18 with the `schools` tile. It was the national
//     mean ДЗИ-по-БЕЛ success, and it was the only headline here that was not
//     public money — /education has no awarder set, so it moved off the sectors
//     hub to /governance entirely (see the note in sectorRegistry.ts). The kind
//     is still handled in useSectorStats; nothing produces it. Do not re-add an
//     outcome number to a grid that answers "what does the state spend".
//   - headcount (annual): administration = total filled positions across the
//     whole state administration (budget/personnel.json) — headcount, not МЕУ's
//     thin procurement line.
// Annual figures track the scope's year for a y:<year> scope (falling back to
// the source's latest year), and show the latest year for ns/all — a parliament
// window spans several fiscal years, so "current scale" is the honest read.

// ⚠️ IN `db:refresh`, immediately after db:load:ngo-funding:pg — alongside
// hub_stats, whose header explains why that is the earliest safe slot. This file's
// own binding constraint is agri_payloads (db:load:agri:pg): the ДФЗ payout read in
// main() is one of the sector headlines, so an earlier slot emits it from the
// previous vintage. refresh_coverage.test.ts holds the chain membership.

import fs from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { allRows, end } from "../lib/pg";
import { missingRelations, isEmpty, warnSkip } from "./preflight";
import {
  newestFirst,
  parliamentWindow,
  type ElectionRef,
} from "../../../src/data/scope/windows";
import { API_EIK } from "../../../src/lib/roadAttributes";
import { WATER_SECTOR_EIKS } from "../../../src/lib/vikReferenceData";
import { ENERGY_SECTOR_EIKS } from "../../../src/lib/energyReferenceData";
import { TRANSPORT_SECTOR_EIKS } from "../../../src/lib/transportReferenceData";
import { MOSV_BUDGET_NODE } from "../../../src/lib/environmentReferenceData";
import { EDU_BUDGET_NODE } from "../../../src/lib/educationReferenceData";
import { ministryYearSeriesEur } from "../../../src/data/budget/ministrySeries";
import {
  dooPensionsEur,
  isCompleteNoiYear,
  type NoiFundLike,
  type NoiYearLike,
} from "../../../src/data/budget/noiYear";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const OUT = path.join(ROOT, "data/procurement/derived/sector_stats.json");
const ELECTIONS = path.join(ROOT, "src/data/json/elections.json");

const readJson = <T>(p: string): T =>
  JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")) as T;

// Procurement-basis sectors: id (matches SECTOR_SCENES / sectorRegistry) → the
// awarder EIK-set whose contract € rolls up to that sector. Only the
// operational/commercial seats whose real spend IS their tender flow live here
// (roads/water/transport/energy). The tax-funded bodies carry a budget figure
// (BUDGET_SECTOR_NODE + AGENCY_BUDGET_FILE below); health/pension/agri/
// administration carry a bespoke figure — all far more meaningful than a thin
// procurement line.
const SECTOR_EIKS: Record<string, string[]> = {
  roads: [API_EIK],
  water: WATER_SECTOR_EIKS,
  transport: TRANSPORT_SECTOR_EIKS, // МТС group (rail/ports/aviation/road-reg — АПИ roads excluded)
  energy: [...ENERGY_SECTOR_EIKS],
  // ⚠️ `environment` is NOT here — see BUDGET_SECTOR_NODE below. ENV_SECTOR_EIKS
  // is still the source of truth for the /sector/environment dashboard, its
  // browse pack and the group model; only the hub HEADLINE changed basis.
};

// Budget-basis sectors, first-level: id → the first-level budget org (ПРБ) node
// file under data/budget/ministries/. The tile fronts a tax-funded seat, so the
// honest headline is that body's enacted (приет) expenditure, not its procurement.
const BUDGET_SECTOR_NODE: Record<string, string> = {
  defense: "admin-ministerstvo-na-otbranata",
  security: "admin-ministerstvo-na-vatreshnite-raboti",
  justice: "admin-sadebnata-vlast",
  culture: "admin-ministerstvo-na-kulturata",
  // Образование — budget-basis, and the node covers LESS of its sector than any
  // other entry here. It is МОН's own enacted expenditure, so it excludes (a) the
  // state universities, which are separate ПРБ drawing their subsidy straight from
  // the central budget — МОН's whole higher-education programme is €48.5M in 2026
  // against €1.27bn of university procurement — (b) БАН, which is autonomous, (c)
  // ССА, which is второстепенен разпоредител към МЗХ, and (d) the delegated
  // municipal school budgets, the biggest slice of the function (COFOG GF09 is
  // €4.455bn for 2024 against this node's €579.4M).
  //
  // ⚠ Do NOT "close the gap" by summing EDU_SECTOR_EIKS' procurement onto this —
  // the /sector/edu group spans three budget principals while this figure spans
  // one, they are different bases, and adding them means nothing. The sector screen
  // states the exclusions instead, in SECTOR_DASHBOARDS.edu.footnote. Widening the
  // roster in educationReferenceData.ts deliberately does not move this number.
  edu: EDU_BUDGET_NODE,
  tourism: "admin-ministerstvo-na-turizma",
  social: "admin-ministerstvo-na-truda-i-sotsialnata-politika",
  // Регионално развитие — budget-basis (NOT procurement). МРРБ is a pass-through
  // ministry: it controls ~€1.06bn/year (2025 ЗДБ) but procures only ~€100M, the
  // rest leaving as capital transfers + EU-cohesion co-financing. A procurement
  // headline (~€213M for the whole group) understates the sector and buries its
  // own thesis — the honest headline is the enacted expenditure of this node.
  regional: "admin-ministerstvo-na-regionalnoto-razvitie-i-blagoustroystvoto",
  // Околна среда — moved off procurement 2026-08-13, same reason as регионално
  // but sharper. The 28-EIK МОСВ group's own tender flow is €257.1M over the
  // WHOLE corpus and €1.81M in the current parliament, so on the hub's default
  // scope the sector rendered at €1.8M beside — same scope — Енергетика €274.0M,
  // Води €157.0M and Пътища €115.7M: arithmetically exact and two orders of
  // magnitude out as a statement about the size of GF05. The ministry's own
  // enacted line is €77.8M (2026), and ОП „Околна среда" is a €3.19bn envelope.
  //
  // The ОПОС billions stay OUT of this headline deliberately: they are
  // disbursed BY municipalities and ВиК, so crediting them to МОСВ would
  // double-count against /water and the governance dashboards. The budget node
  // is what МОСВ itself is appropriated, which is the comparable figure beside
  // the other budget-basis tiles.
  //
  // Consequence worth knowing: the МОСВ node's series starts at FY2018 while the
  // generator mints a `y:<year>` scope from 2011, so `y:2011`–`y:2017` now carry
  // `unavailable: true` and the tile shows „няма данни за <year>" where it used
  // to show that year's real procurement €. Same behaviour as every other
  // budget-basis sector on those scopes, and a no-data notice beats a 2026
  // figure captioned 2011 — but it IS a visible change on 7 of 30 scopes.
  environment: MOSV_BUDGET_NODE,
};

// Budget-basis sectors, second-level: id → the agency budget file under
// data/budget/agencies/. НАП and Агенция „Митници“ are второстепенни разпоредители
// по бюджета на МФ, so they're absent from the first-level ministries tree and
// the ЗДБРБ carries no clean per-agency total (the МФ program budget lumps them
// into one revenue-collection line). Each file carries that agency's OWN годишен
// уточнен план (собствен ведомствен бюджет) per fiscal year — same
// `years[].expenditure.amountEur` shape as the ministries nodes, so it folds
// into budgetByYear below and emits basis='budget'. See each file's `source`.
const AGENCY_BUDGET_FILE: Record<string, string> = {
  revenue: "nap",
  customs: "customs",
};

// Flattened (eik, sector) pairs for a single grouped query per scope.
const eikList: string[] = [];
const sectorList: string[] = [];
for (const [sector, eiks] of Object.entries(SECTOR_EIKS)) {
  for (const e of eiks) {
    eikList.push(e);
    sectorList.push(sector);
  }
}

// `kind` drives number formatting (€ / score / integer); `basis` drives the
// tile's one-word caption. `year` (annual bases only) lets the caption name the
// fiscal year — procurement is a scope window, so it carries none. `note` is an
// optional caption qualifier the tile abbreviates: 'adjusted' marks the two
// second-level agencies (НАП/АМ) whose budget figure is a годишен уточнен план,
// not the ЗДБРБ-приет shown by the first-level ПРБ tiles.
type SectorBasis = "budget" | "payout" | "procurement" | "headcount" | "score";
interface SectorVal {
  kind: "eur" | "score" | "count";
  basis: SectorBasis;
  value: number;
  year?: number;
  note?: "adjusted";
  /** True when a specific `y:<year>` scope was requested but the annual series
   *  has no PUBLISHABLE datum for it, so `value`/`year` are a fall-back to the
   *  latest available year. Two causes, and the second is now the common one:
   *  the series does not reach that year (НЗОК payout before 2022), or the year
   *  is not over yet — a cumulative-YTD point is not an annual figure, so a
   *  running year counts as no data rather than as a small one. The tile shows a
   *  "no data for <year>" notice instead of a misleading fall-back number. */
  unavailable?: boolean;
}
type ScopeStats = Record<string, SectorVal>;

// ---- bespoke annual series (year → value) + latest ------------------------

const latestYearOf = (byYear: Record<number, number>): number => {
  const ys = Object.keys(byYear).map(Number);
  return ys.length ? Math.max(...ys) : 0;
};

// Budget € per fiscal year, per budget-basis sector. Both the first-level ПРБ
// nodes and the second-level agency files share the `years[].expenditure.amountEur`
// shape, so they fold into one map: ministries carry приет по ЗДБРБ (`execution`
// null there), agencies carry their own годишен уточнен план.
type BudgetFile = {
  years?: Array<{
    fiscalYear: number;
    expenditure?: { amountEur?: number | null };
    expenditureLaw?: { amountEur?: number | null } | null;
  }>;
};
// This is a per-YEAR series — `?pscope=y:<year>` picks a point out of it and the
// tile captions it „бюджет <year>" beside the other budget-basis sectors — so it
// reads the single-scope figure via ministryYearSeriesEur. Using `expenditure`
// would publish МОСВ's 2024 отчет-restated €104,230,071 where its ЗДБ line is
// €60,325,488, a 72.8% step no other year in the series carries.
const budgetSeries = (m: BudgetFile): Record<number, number> => {
  const byYear: Record<number, number> = {};
  for (const y of m.years ?? []) {
    const v = ministryYearSeriesEur(y);
    // Truthiness, not `!= null`, on purpose: a €0 year is an un-appropriated
    // shell rather than a real budget, and dropping it lets annual() fall back
    // to the latest real year instead of captioning „бюджет 2024: €0".
    if (v) byYear[y.fiscalYear] = v;
  }
  return byYear;
};
// ⚠️ data/budget/ministries/ is GITIGNORED (.gitignore:263) — the update-budget
// ingest writes those 55 node files and a fresh clone has NONE of them. The nine
// reads below therefore have to be absent-tolerant now that this generator runs
// inside the &&-chained db:refresh. They used to sit at MODULE level, which made
// the failure worse than a normal missing input: the ENOENT fired at IMPORT time,
// before main() could decide anything, so no preflight of any kind could have
// caught it. (The agency files, data/indicators.json, personnel.json,
// noi/funds.json and nzok/execution_history.json are all TRACKED, so those stay
// module-level and SHOULD throw if they vanish — a tracked file going missing is a
// real defect, per the refresh_coverage.ts convention.)
const MINISTRIES_DIR = path.join(ROOT, "data/budget/ministries");

const budgetByYear: Record<string, Record<number, number>> = {};
/** Absent budget inputs, repo-relative; empty ⇒ budgetByYear is fully populated. */
const loadBudgetSeries = (): string[] => {
  if (!existsSync(MINISTRIES_DIR))
    return [path.relative(ROOT, MINISTRIES_DIR) + "/"];
  // A present-but-partial tree is the half-finished-ingest case: emitting it
  // would silently drop whole sectors from the committed artifact, so report the
  // gap and let main() skip rather than write nine zeroed tiles.
  const missing = Object.values(BUDGET_SECTOR_NODE)
    .map((node) => `data/budget/ministries/${node}.json`)
    .filter((rel) => !existsSync(path.join(ROOT, rel)));
  if (missing.length) return missing;

  for (const [sector, node] of Object.entries(BUDGET_SECTOR_NODE))
    budgetByYear[sector] = budgetSeries(
      readJson<BudgetFile>(`data/budget/ministries/${node}.json`),
    );
  for (const [sector, file] of Object.entries(AGENCY_BUDGET_FILE))
    budgetByYear[sector] = budgetSeries(
      readJson<BudgetFile>(`data/budget/agencies/${file}.json`),
    );
  return [];
};

// Pension: ДОО fund pension outlay per fiscal year.
//
// Two rules here, both learned the hard way, and both delegated to noiYear.ts
// rather than restated — that module is the single interpreter of this file and
// says so in its header ("Import it; do not re-derive the predicate"). Until
// 2026-08-14 this generator was the ONLY reader of funds.json outside it.
//
//  · SHELL YEARS ARE SKIPPED. The B1 ingest publishes a new fiscal year
//    mid-cycle as a partial record (`funds: []`, revenue 0, and an
//    `expenditure`/`pensions` that is really the pension YEARBOOK's grand
//    total — a different basis: on 2024 it sits 0.53% below the three-fund B1
//    rollup and 0.06% below the ДОО B1 line). Taking every
//    year put the 2023 shell's yearbook figure on the `?pscope=y:2023` tile
//    under basis 'payout', and — because annual() resolves `all` and every
//    `ns:` scope through the MAX year present — would have flipped the headline
//    to a partial figure the moment the 2025 shell landed, while /pensions
//    (guarded) held the last complete year. A tile contradicting the page it
//    links to, at a 200, with nothing red.
//  · ДОО ALONE, never `totals.pensions`. That is the three-fund rollup and it
//    is €52.5m / 0.47% larger — all of it Учителски пенсионен фонд. See the
//    warning on dooPensionsEur.
//
// A complete year always carries its 5500 snapshot, so the null arm is the
// no-B1-for-ДОО case, which has nothing to publish.
const funds = readJson<{
  years?: Array<
    NoiYearLike & {
      funds: NoiFundLike[];
    }
  >;
}>("data/budget/noi/funds.json");
const pensionByYear: Record<number, number> = {};
for (const y of funds.years ?? []) {
  if (!isCompleteNoiYear(y)) continue;
  const v = dooPensionsEur(y);
  if (v) pensionByYear[y.fiscalYear] = v;
}

// НЗОК: cash-execution B1 outlay. The monthly feed is CUMULATIVE-YTD (the file's
// own source.description says so), so only a month-12 point is a full year — a
// month-4 point is January–April, not "2026".
//
// Two maps, and the split is the whole point. `nzokFullYear` (December only) is
// what may ever be PUBLISHED as an annual payout; `nzokByYear` (the last point of
// each year, complete or not) exists solely for the completeness report at the
// foot of main(), which should still see a partial year as data that arrived.
//
// Publishing the partial year is a defect this sector has already had twice, in
// both of its possible shapes:
//   · 2022-2024 shipped as 11-month cumulatives because the /quarter feed stops
//     at month 11 — fixed by the hand-verified December backfill that
//     write_execution_annual.ts pins (and sector_stats.data.test.ts locks).
//   · 2026 shipped as a FOUR-month cumulative (€1.72bn on `?pscope=y:2026`,
//     against 2025's €4.72bn — a 63.5% collapse in НЗОК payouts, at a 200).
//     A backfill can never fix this one: the year is not over. So the rule has to
//     live in the SELECTION, and it has to bind in BOTH branches of out.health —
//     the fallback already required month 12 via nzokLatestYear, which is exactly
//     why the defect was invisible on `all` and every `ns:` scope.
// A year with no December point therefore falls through to `unavailable`, the
// same no-data notice pension/agri/administration already show for 2026.
const nzok = readJson<{
  points?: Array<{ year: number; month: number; expenditureEur: number }>;
}>("data/budget/nzok/execution_history.json");
/** Last point per year, complete or not — completeness REPORTING only. */
const nzokByYear: Record<number, number> = {};
/** December points only — the sole series a headline may be published from. */
const nzokFullYear: Record<number, number> = {};
const nzokLastMonth: Record<number, number> = {};
for (const p of nzok.points ?? []) {
  if (!(p.year in nzokLastMonth) || p.month > nzokLastMonth[p.year]) {
    nzokLastMonth[p.year] = p.month;
    nzokByYear[p.year] = p.expenditureEur;
  }
  // Read off the points directly rather than off the last-point map above: the
  // two questions are independent, and routing December through "the last point,
  // if it happens to be December" would let one out-of-range adjustment row hide
  // a year's real December figure — marking a COMPLETE year „няма данни", which
  // is the same class of silent wrongness in the opposite direction.
  if (p.month === 12) nzokFullYear[p.year] = p.expenditureEur;
}

// Administration: total filled positions across the whole state administration
// (the "Доклад за състоянието на администрацията" щатна численост, filled), per
// year — a far more meaningful "administration" figure than МЕУ's thin
// procurement line. `filled` ≈ actual employees; years without it (2017) are
// skipped so they fall back to the latest.
const personnel = readJson<{
  national?: Record<string, { positions?: { filled?: number | null } }>;
}>("data/budget/personnel.json");
const adminByYear: Record<number, number> = {};
for (const [y, rec] of Object.entries(personnel.national ?? {})) {
  const filled = rec.positions?.filled;
  if (filled) adminByYear[Number(y)] = filled;
}

// ДФЗ CAP paid per financial year — filled from PG in main() before any scope
// is computed (scopeStats closes over it).
const agriByYear: Record<number, number> = {};

// An annual-basis stat: the scope's year where the series has it, else latest;
// `year` names whichever fiscal year the value came from (for the caption).
const annual = (
  byYear: Record<number, number>,
  year: number | null,
  kind: SectorVal["kind"],
  basis: SectorBasis,
): SectorVal => {
  const has = year != null && byYear[year] != null;
  const resolved = has ? year : latestYearOf(byYear);
  return {
    kind,
    basis,
    value: byYear[resolved] ?? 0,
    year: resolved || undefined,
    ...(year != null && !has ? { unavailable: true } : {}),
  };
};

// ---------------------------------------------------------------------------

const scopeStats = async (
  from: string | null,
  to: string | null,
  year: number | null,
): Promise<ScopeStats> => {
  // Windowed procurement € per sector, one grouped query. Sargable COALESCE
  // bounds (string date compares) so the date index is used.
  const rows = (await allRows(
    `SELECT m.sector AS sector, COALESCE(ROUND(SUM(c.amount_eur)), 0)::float8 AS eur
       FROM contracts c
       JOIN (SELECT unnest($3::text[]) AS eik, unnest($4::text[]) AS sector) m
         ON c.awarder_eik = m.eik
      WHERE c.tag = 'contract'
        AND c.date >= COALESCE($1, '0000')
        AND c.date <  COALESCE($2, '9999')
      GROUP BY m.sector`,
    [from, to, eikList, sectorList],
  )) as { sector: string; eur: number }[];

  const out: ScopeStats = {};
  for (const s of Object.keys(SECTOR_EIKS))
    out[s] = { kind: "eur", basis: "procurement", value: 0 };
  for (const r of rows)
    out[r.sector] = { kind: "eur", basis: "procurement", value: r.eur };

  // Budget-basis sectors: enacted (приет) expenditure of the fronting ПРБ, plus
  // the second-level agencies' own annual budget (revenue/customs) — both live
  // in budgetByYear. The agencies carry a годишен уточнен план (not ЗДБРБ-приет),
  // so tag them 'adjusted' for the tile's caption qualifier.
  for (const s of Object.keys(budgetByYear)) {
    out[s] = annual(budgetByYear[s], year, "eur", "budget");
    if (s in AGENCY_BUDGET_FILE) out[s].note = "adjusted";
  }

  // Bespoke payouts / score / headcount.
  //
  // pension OMITS its key rather than emitting a €0 payout when the series is
  // empty. funds.json is TRACKED, so an empty series means a tracked source
  // moved or lost its shape — and the completeness guard above widened the set
  // of inputs that reach that state (no complete year; no 5500 snapshot in one).
  // annual() would return `value: 0`, which this generator then commits over a
  // good artifact as „ДОО paid nothing" at a 200. A MISSING key instead lets the
  // tile render its own no-data state — the same way /pensions renders nothing
  // when flattenFundYear returns null, rather than confidently showing zero.
  if (Object.keys(pensionByYear).length)
    out.pension = annual(pensionByYear, year, "eur", "payout");
  // НЗОК: latest is the last FULL year (month 12), not the partial current YTD.
  // The rule lives ONCE, in nzokFullYear's construction — see its definition —
  // so the published series never holds a cumulative-YTD point and annual() can
  // treat "no December point" exactly like "no data", which for the purpose of
  // naming a year's payout is what it is. Both of the scopes that used to need
  // separate handling now fall out of that: a pre-2022 `y:<year>` and a
  // still-running current year alike get the latest complete year plus
  // `unavailable`, so the tile says „няма данни за <year>" rather than showing a
  // number captioned with a year it does not measure.
  //
  // OMITS its key on an empty series rather than emitting €0, for the reason
  // spelled out on pension above: annual() would return `value: 0`, which this
  // generator then commits over a good artifact as „НЗОК плати нищо" at a 200.
  if (Object.keys(nzokFullYear).length)
    out.health = annual(nzokFullYear, year, "eur", "payout");
  out.agri = annual(agriByYear, year, "eur", "payout");
  out.administration = annual(adminByYear, year, "count", "headcount");
  return out;
};

const main = async (): Promise<void> => {
  const t0 = Date.now();

  // Skip-and-warn preflight — db:refresh is &&-chained, so a missing dependency
  // must not abort it (refresh_coverage.ts). Order matters only in that the
  // cheapest check goes first.
  const budgetGaps = loadBudgetSeries();
  if (budgetGaps.length) {
    warnSkip(
      "sector_stats",
      `missing budget input(s): ${budgetGaps.join(", ")}`,
      "Run the update-budget ingest — data/budget/ministries/ is gitignored, so a fresh clone has none of it.",
    );
    await end();
    return;
  }

  const relGaps = await missingRelations(["contracts", "agri_payloads"]);
  if (relGaps.length) {
    warnSkip(
      "sector_stats",
      `missing relation(s): ${relGaps.join(", ")}`,
      "Run `npm run db:refresh` — db:load:pg and db:load:agri:pg fill these.",
    );
    await end();
    return;
  }

  // Present-but-empty `contracts` is the fresh-clone shape (migrations applied,
  // no shards to load). It would zero every procurement-basis sector on top of a
  // good committed artifact. agri_payloads is deliberately NOT checked the same
  // way: db:load:agri:pg legitimately skips its gitignored cache and leaves the
  // table empty, and the existing per-source warning below already names that.
  if (await isEmpty("contracts")) {
    warnSkip(
      "sector_stats",
      "the contracts table is empty",
      "Run the procurement ingest, then `npm run db:load:pg`.",
    );
    await end();
    return;
  }

  // ДФЗ CAP paid, per financial year, from the precomputed overview payloads.
  const agriRows = (await allRows(
    "SELECT key, (payload->'headline'->>'totalEur')::float8 AS eur FROM agri_payloads WHERE kind = 'overview' AND key ~ '^[0-9]{4}$'",
    [],
  )) as { key: string; eur: number }[];
  for (const r of agriRows) agriByYear[Number(r.key)] = r.eur;

  // Fail loud if a bespoke source came back empty — an all-zero tile is a
  // silent data bug (a moved JSON field, an unloaded agri_payloads table), not
  // a legitimate "0". The procurement sectors can legitimately be 0 in a narrow
  // scope, so they aren't checked here.
  const bespoke: [string, Record<number, number>][] = [
    ["pension (funds.json)", pensionByYear],
    ["health (nzok execution_history.json)", nzokByYear],
    // The series that is actually PUBLISHED, checked beside the raw one because
    // they fail apart: nzokByYear can be full while this is empty (the ingest
    // starts emitting `month` as a string, the field is renamed, the feed stops
    // publishing a December row). That state omits the health key entirely, so
    // without this line the tile would lose its headline sitewide with nothing
    // reporting why.
    ["health full-year (nzok December points)", nzokFullYear],
    ["agri (agri_payloads)", agriByYear],
    ["administration (personnel.json)", adminByYear],
    ...Object.entries(budgetByYear).map(
      ([s, series]): [string, Record<number, number>] => [
        BUDGET_SECTOR_NODE[s]
          ? `${s} budget (ministries/${BUDGET_SECTOR_NODE[s]})`
          : `${s} budget (agencies/${AGENCY_BUDGET_FILE[s]})`,
        series,
      ],
    ),
  ];
  for (const [label, series] of bespoke) {
    if (Object.keys(series).length === 0)
      console.warn(`  ⚠ sector_stats: ${label} produced no data`);
  }

  // newestFirst + parliamentWindow rather than a local copy of the formula: the loop below
  // reads elections[i-1] as the next-newer election, which is only correct while the source
  // happens to be sorted. src/data/scope/windows is the one definition the React hook and
  // every other scoped precompute share.
  const elections = newestFirst(
    JSON.parse(fs.readFileSync(ELECTIONS, "utf8")) as ElectionRef[],
  );
  const yearRows = (await allRows(
    "SELECT DISTINCT left(date,4) AS y FROM contracts WHERE date >= '2011' ORDER BY y",
    [],
  )) as { y: string }[];

  const out: Record<string, ScopeStats> = {};
  out["all"] = await scopeStats(null, null, null);
  for (const e of elections) {
    const { from, to } = parliamentWindow(elections, e.name);
    out[`ns:${e.name}`] = await scopeStats(from, to, null);
  }
  for (const { y } of yearRows) {
    const year = Number(y);
    if (!Number.isFinite(year)) continue;
    out[`y:${year}`] = await scopeStats(
      `${year}-01-01`,
      `${year + 1}-01-01`,
      year,
    );
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + "\n");
  console.log(
    `sector_stats: ${Object.keys(out).length} scope(s) → ${path.relative(ROOT, OUT)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  process.exit(0);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
