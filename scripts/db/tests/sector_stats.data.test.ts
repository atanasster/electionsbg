// Regression net for the AUDITED government-sector hub tiles
// (data/procurement/derived/sector_stats.json) + their EIK-set copies.
//
//   npm run test:data
//
// Auto-skips when Postgres is unreachable or the contracts table is absent
// (CI / fresh checkout), exactly like procurement_dossiers.data.test.ts. The
// non-PG assertions (blob shape, source reconciliation, EIK-set lockstep) still
// need a `contracts` table only for the signature-member spend floor; the rest
// read JSON + source constants and would pass anywhere, but we gate the whole
// file behind PG for a single, consistent skip.
//
// Sectors pinned here (extend per audit, one describe-block each):
//
//  · HEALTH (audit 2026-07-23, widened 2026-08-16) — the one sector here whose
//    EIK-SET and whose HEADLINE describe different things on purpose: a
//    MULTI-member set (НЗОК + МЗ) fronted by a SINGLE-body payout headline.
//    Summing МЗ's enacted budget onto НЗОК's cash execution would mix bases AND
//    double-count the state transfer that part-funds the fund, so the headline
//    stays НЗОК-only. (This bullet said "a single-member PAYOUT sector" until
//    the widening.) The tripwires:
//     - the hub headline stays basis='payout' and in a €-band around the НЗОК
//       cash-execution latest full year (catches a basis flip, a zeroed/renamed
//       source field, or a re-conversion-to-BGN that would ~halve the number);
//     - the headline reconciles to nzok/execution_history.json's latest month-12
//       point (the declared source of truth), and NO scope may publish a year
//       that has no December point — the B1 feed is cumulative-YTD, and this
//       sector has shipped a partial year as an annual figure twice;
//     - the EIK-set copies stay equal on BOTH EIKs (HEALTH_SECTOR_EIKS ↔
//       dashboard members ↔ browse pack) while leadEik stays НЗОК — that last is
//       what keeps the budget-bridge pack, rather than the generic KPI row, as
//       the dashboard's body — and health is NOT a procurement-basis sector;
//     - МЗ is claimed by exactly ONE sector. The whole argument for admitting a
//       €2.84bn ministry is that it double-counted against nothing, so that is
//       asserted rather than assumed;
//     - the second-level МЗ family (54 ЦСМП/РЗИ/НЦОЗА bodies, €86.6m) and the
//       234 state/university HOSPITALS (€10.6bn — НЗОК's own payees) stay OUT;
//     - both members are real, signature awarders in the corpus — proves neither
//       EIK is a typo, while НЗОК's own thin ЗОП line stays far below payout.
//
//  · WATER (audit 2026-08-13, docs/plans/water-sector-audit-v1.md) — a MULTI-member
//    PROCUREMENT sector, so the tripwires are the opposite shape to health's:
//     - the headline must RECONCILE EXACTLY to a live sum over WATER_SECTOR_EIKS,
//       which is what actually gates the generator's copy of the EIK-set (it
//       imports the constant, so an array-identity check is a tautology; a sum is
//       not — any EIK added, dropped or mistyped on either side moves it);
//     - each of the seven operators the audit ADDED is present above a per-EIK
//       floor. The audit found them worth €73.7M, three of them whole oblasti
//       with no regional operator at all, and a silent re-trim would look exactly
//       like the state it fixed;
//     - the sector and the HOLDING group stay far apart. They are two different
//       questions (/water vs /awarder/206086428) and the failure mode is one
//       collapsing into the other — which the prose figure for that gap could not
//       catch, having gone stale during the audit that wrote it;
//     - the name-collision EIKs a regex sweep surfaces (Басейнови дирекции,
//       РИОСВ, Център за подводна археология) stay OUT. They are МОСВ bodies
//       already counted in `environment`, so admitting one double-counts across
//       two sectors.
//
//  · TRANSPORT (audit 2026-08-13, docs/plans/transport-sector-audit-v1.md) — also a
//    MULTI-member PROCUREMENT sector, so it inherits water's exact-reconcile shape.
//    What it adds is a gate on the SUB-DIVISION, because that is where its defect
//    lived: the headline was right to the euro the whole time, and the mode split
//    beneath it was reporting state aviation procurement at €3.7M against a real
//    €348.2M — the sector declared five universes and one of them held only the
//    regulator. So the tripwires here are:
//     - the headline reconciles EXACTLY to a live sum over TRANSPORT_SECTOR_EIKS
//       (the same argument as water: the generator imports the constant, so an
//       array-identity check is a tautology and a sum is not);
//     - every DECLARED universe carries real money. A headline-only gate cannot see
//       a universe collapse, which is precisely how this one survived;
//     - the four bodies the audit added are present above a per-EIK floor. ⚠ Летище
//       София's floor is `all`-scope ONLY — its corpus ends 2021-04-06 (the SOF
//       Connect concession) and it legitimately contributes €0 to every later window;
//     - the anti-allowlist stays out — the „съобщения" bodies, the port OPERATORS,
//       the transport hospitals, КРС, ДАО, Метрополитен and АПИ/Автомагистрали. The
//       last two would double-count against `roads`, the same failure water guards;
//     - every member LOOKS like a transport body under every spelling the corpus
//       carries (the positive half — a wrong-but-real EIK passes every other gate,
//       since the test and the generator read the same constant and both move
//       together while the headline just inflates).
//
//  · ENERGY (audit 2026-08-13, docs/plans/energy-sector-audit-v1.md) — the third
//    MULTI-member PROCUREMENT sector, and the one whose MONEY was already clean:
//    the headline reconciled to the euro at every one of the 30 scopes and the
//    EIK-set survived both sweeps unchanged. It is pinned here anyway, because
//    "audited and correct" is a state that decays silently and had no gate at all.
//    Two shapes differ from transport's:
//     - ⚠ BEH ITSELF AWARDS NOTHING. Every other sector's "every curated EIK is a
//       real awarder" gate would fail on the holding parent (831373560, 0
//       contracts — it is a pure holding company), so it is exempted BY NAME
//       rather than by loosening the gate for everyone;
//     - the four copies are NOT all equal, uniquely so far. ENERGY_MEMBER_EIKS
//       (the dashboard) omits the ЕСО МЕР branch code that ENERGY_SECTOR_EIKS
//       (the hub) carries — a documented, intentional collapse. The test asserts
//       the difference is EXACTLY that branch and that it stays immaterial, so
//       the collapse cannot quietly grow into a real divergence.
//    The universe gate is transport's, with `holding` allowed to be empty — the
//    one legitimately money-less universe in the codebase, and the reason this
//    gate needs a per-universe floor list rather than "every universe carries
//    money". That arm counts CONTRACTS rather than euros: "awards nothing" is a
//    claim about rows, and the corpus holds 140 contracts with a NULL amount, so
//    a €0 sum is also what a holding with untotalled contracts would look like.
//
//    Both of the energy-only gates (the branch materiality line and the holding
//    arm) assert their SUBJECT still exists before measuring it. Each was
//    absence-equivalent when first written — remove the branch, or remove БЕХ from
//    ENERGY_ENTITIES, and the measurement is 0/undefined and the test goes green
//    reporting perfect health. A gate over an expected-empty thing has to prove
//    the thing is still there.

import { test, describe, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import {
  NZOK_EIK,
  MZ_EIK,
  HEALTH_SECTOR_EIKS,
} from "@/lib/healthReferenceData";
import { NZOK_SUPPLIER_CONTEXT } from "@/lib/nzokBenchmarks";
import { NOI_EIK } from "@/lib/noiBenchmarks";
import { SOCIAL_SECTOR_EIKS } from "@/lib/socialReferenceData";
import { API_EIK } from "@/lib/roadAttributes";
// The pension gates read funds.json through the SAME accessors the generator
// and /pensions use. Re-deriving "which year is complete" or "which fund is
// ДОО" here would let a bug in that module satisfy its own gate.
import {
  dooPensionsEur,
  isCompleteNoiYear,
  latestCompleteNoiYear,
} from "@/data/budget/noiYear";
// The function /pensions renders from — invoked, not reproduced. See the
// "ONE figure" test for why a hand-rolled equivalent would be worthless.
import { flattenFundYear } from "@/data/procurement/useNoi";
import type { NoiFundsFile as FrontendNoiFundsFile } from "@/data/budget/types";
import {
  WATER_SECTOR_EIKS,
  VIK_HOLDING_SUB_EIKS,
  VIK_HOLDING_EIK,
  WATER_OPERATORS,
} from "@/lib/vikReferenceData";
import {
  TRANSPORT_SECTOR_EIKS,
  TRANSPORT_ENTITIES,
  TRANSPORT_EIK,
  transportUniverseOf,
  type TransportUniverse,
} from "@/lib/transportReferenceData";
import {
  MO_ENTITIES,
  DEFENSE_SECTOR_EIKS,
  MOD_EIK,
  VMA_EIK,
  MO_BUDGET_NODE,
} from "@/lib/defenseReferenceData";
// Culture's ANTI-allowlist + its roll-up, read as the defense roster's
// completeness oracle. See the defense block's `mo_museum` test for why these
// imports are the point of the gate rather than an incidental dependency.
import { ADJACENT_EIKS, CULTURE_GROUP_EIKS } from "@/lib/kulturaReferenceData";
// Prose that MENTIONS a count is not an occurrence of it — see the file's own
// header for the two gates this primitive exists for.
import { stripComments } from "@/../scripts/lib/strip_comments";
import {
  AGRI_ENTITIES,
  AGRI_SECTOR_EIKS,
  AGRI_EXTERNAL_BODIES,
  AGRI_LEAD_EIK,
  AGRI_BODY_COUNT,
  agriFootnote,
} from "@/lib/agriReferenceData";
import {
  ENERGY_SECTOR_EIKS,
  ENERGY_MEMBER_EIKS,
  ENERGY_ALIAS_EIKS,
  ENERGY_ENTITIES,
  BEH_EIK,
  ENERGY_MINISTRY_EIK,
  universeOf as energyUniverseOf,
  type EnergyUniverse,
} from "@/lib/energyReferenceData";
// The generator's own window maths — imported, never re-derived here. See the
// ns: arm of the energy scope test for why a local copy would be worthless.
import {
  newestFirst,
  parliamentWindow,
  type ElectionRef,
} from "@/data/scope/windows";

// Anchor to the module, not the cwd, so a read failure can't escape the PG-skip.
const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../../");
const readJson = <T>(rel: string): T =>
  JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf-8")) as T;

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.contracts') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / contracts table absent";

afterAll(async () => {
  await end();
});

type SectorStat = {
  kind: string;
  basis: string;
  value: number;
  year?: number;
  note?: string;
  /** The selected y:<year> scope has no datum, so value/year are a fall-back to
   *  the latest available year and the tile renders a no-data caption. */
  unavailable?: boolean;
};
type SectorStats = Record<string, Record<string, SectorStat>>;

/** The "a published health figure is always a CLOSED year" rule, as a pure
 *  function of (feed points, emitted stats) → violations. Written this way so
 *  the health gate can run it twice: once over the real corpus, and once over a
 *  synthetic partial year to prove it still discriminates — a live-corpus-only
 *  check silently goes vacuous once every year in the feed has closed. */
const partialYearViolations = (
  points: NzokHistory["points"],
  stats: SectorStats,
): string[] => {
  const december = new Map(
    points.filter((p) => p.month === 12).map((p) => [p.year, p.expenditureEur]),
  );
  const bad: string[] = [];
  for (const [scope, sectors] of Object.entries(stats)) {
    const h = sectors.health;
    if (!h) {
      bad.push(`${scope}: no health stat emitted`);
      continue;
    }
    // Whatever year the stat NAMES, its value must be that year's December
    // cumulative — never a mid-year one.
    if (h.year == null || december.get(h.year) !== h.value)
      bad.push(
        `${scope}: value ${h.value} captioned ${h.year} is not a December point`,
      );
    // And a y:<year> scope may only claim its own year once that year closed.
    const m = /^y:(\d{4})$/.exec(scope);
    if (m && !december.has(Number(m[1])) && h.unavailable !== true)
      bad.push(
        `${scope}: ${m[1]} has no December point, so health must flag unavailable`,
      );
  }
  return bad;
};

type NzokHistory = {
  points: Array<{
    year: number;
    month: number;
    expenditureEur: number;
    backfilled?: boolean;
  }>;
};

/** Σ amount_eur over an EIK-set, whole corpus — the `all` scope's definition.
 *  Declared above the first describe rather than between two of them: this
 *  file's house style computes helpers at describe scope, and any consumer
 *  hoisted that way would hit the TDZ at COLLECTION time — a whole-file load
 *  failure rather than a test failure. */
const sectorSum = async (
  eiks: readonly string[],
  /** Extra SQL predicate, ANDed on (and PARENTHESISED — an unwrapped `OR`
   *  escapes the awarder_eik filter entirely, measured at €740,338 → €4,605,408).
   *  For narrowing to, or away from, the rows 061_awarder_group_model.sql's
   *  `sup` CTE excludes from the leaderboard. Test-local literals only; never
   *  interpolate a value from the corpus. */
  opts?: { extra?: string },
): Promise<number> => {
  const [r] = await allRows<{ eur: string }>(
    `select coalesce(round(sum(amount_eur)),0)::text eur
       from contracts
      where tag='contract' and awarder_eik = any($1)
        ${opts?.extra ? `and (${opts.extra})` : ""}`,
    [[...eiks]],
  );
  return Number(r?.eur ?? 0);
};

describe("health sector (НЗОК + МЗ; payout headline from НЗОК)", () => {
  test.skipIf(skip)(
    "hub headline is payout, in-band, reconciles to source",
    () => {
      const stats = readJson<SectorStats>(
        "data/procurement/derived/sector_stats.json",
      );
      const h = stats["all"]?.health;
      assert.ok(h, "sector_stats.json['all'].health must exist");
      assert.equal(h.kind, "eur");
      assert.equal(
        h.basis,
        "payout",
        "health must front НЗОК payout, not its thin ЗОП line",
      );

      // Band: the 2025 НЗОК cash execution is ~€4.7bn. Floor catches a zeroed/
      // renamed source field or an over-trim; ceiling catches a double-count or a
      // basis flip to a larger aggregate. Wide enough for a couple more full years.
      assert.ok(
        h.value > 4_000_000_000 && h.value < 7_000_000_000,
        `health payout €${h.value} out of expected band 4.0–7.0bn`,
      );

      // Reconcile to the declared source of truth: the latest FULL-year (month 12)
      // cumulative execution point in nzok/execution_history.json.
      const hist = readJson<NzokHistory>(
        "data/budget/nzok/execution_history.json",
      );
      const fullYears = hist.points.filter((p) => p.month === 12);
      assert.ok(
        fullYears.length > 0,
        "execution_history.json has no month-12 point",
      );
      const latestFull = fullYears.reduce((a, b) => (b.year > a.year ? b : a));
      assert.equal(
        h.value,
        latestFull.expenditureEur,
        "headline must equal the latest full-year НЗОК execution point",
      );
      assert.equal(
        h.year,
        latestFull.year,
        "headline year must be the latest full year",
      );
    },
  );

  test.skipIf(skip)(
    "the health EIK-set copies stay in lockstep on НЗОК + МЗ",
    () => {
      // Widened 2026-08-16 from НЗОК alone: МЗ is €2.84bn / 5,771 contracts —
      // 34× НЗОК's whole ЗОП line — and belonged to no sector at all. Pin both
      // EIKs so neither a re-narrowing nor a silent third member goes unnoticed.
      const expected = ["121858220", "000695317"];
      assert.equal(NZOK_EIK, "121858220", "NZOK_EIK constant drifted");
      assert.equal(MZ_EIK, "000695317", "MZ_EIK constant drifted");
      assert.deepEqual(
        [...HEALTH_SECTOR_EIKS],
        expected,
        "HEALTH_SECTOR_EIKS drifted",
      );
      assert.deepEqual(
        SECTOR_DASHBOARDS.health.members.map((m) => m.eik),
        expected,
        "SECTOR_DASHBOARDS.health.members drifted from HEALTH_SECTOR_EIKS",
      );
      assert.deepEqual(
        [...SECTOR_BROWSE_PACKS.nzok.eiks],
        expected,
        "SECTOR_BROWSE_PACKS.nzok.eiks drifted from HEALTH_SECTOR_EIKS",
      );
      // getSectorPack keys on leadEik, so this is what keeps the НЗОК
      // budget-bridge pack — not the generic KPI row — as the dashboard's body.
      assert.equal(SECTOR_DASHBOARDS.health.leadEik, NZOK_EIK);

      // Health is payout-basis: it must NOT be emitted as a procurement sector
      // (a procurement headline would understate НЗОК ~56×). This is also what
      // stops the widening from leaking into the headline — adding МЗ's budget
      // to НЗОК's cash execution would mix bases AND double-count the state
      // transfer that part-funds the fund.
      const stats = readJson<SectorStats>(
        "data/procurement/derived/sector_stats.json",
      );
      assert.equal(stats["all"].health.basis, "payout");
    },
  );

  test.skipIf(skip)("МЗ is claimed by exactly one sector", () => {
    // The whole argument for admitting a €2.84bn ministry is that it belonged to
    // no sector, so it double-counts against nothing. That was prose; this makes
    // it an invariant, on the all-packs idiom the НОИ block below already argues
    // for — unlike a hand-listed set it cannot silently under-cover, because a
    // pack added tomorrow is checked the day it lands.
    const claiming = Object.values(SECTOR_BROWSE_PACKS)
      .filter((pack) => pack.eiks.includes(MZ_EIK))
      .map((pack) => pack.id)
      .sort();
    assert.deepEqual(
      claiming,
      ["nzok"],
      `МЗ ${MZ_EIK} is claimed by browse packs: ${claiming.join(", ")}`,
    );

    const dashboards = Object.entries(SECTOR_DASHBOARDS)
      .filter(([, c]) => c.members.some((m) => m.eik === MZ_EIK))
      .map(([id]) => id)
      .sort();
    assert.deepEqual(
      dashboards,
      ["health"],
      `МЗ ${MZ_EIK} is a member of dashboards: ${dashboards.join(", ")}`,
    );

    // …and it must never reach a PROCUREMENT-basis EIK-set, which is where a
    // double-count would actually move a published number (health's own headline
    // is payout, so its set cannot).
    const procurementSets: Record<string, readonly string[]> = {
      water: WATER_SECTOR_EIKS,
      transport: TRANSPORT_SECTOR_EIKS,
      energy: ENERGY_SECTOR_EIKS,
      social: SOCIAL_SECTOR_EIKS,
      roads: [API_EIK],
    };
    for (const [id, eiks] of Object.entries(procurementSets))
      assert.ok(
        !eiks.includes(MZ_EIK),
        `МЗ ${MZ_EIK} leaked into the ${id} EIK-set — that WOULD double-count`,
      );
  });

  test.skipIf(skip)(
    "no EIK is claimed by two sectors, in either registry",
    () => {
      // The generalisation of the МЗ pin above. That test asks the question of ONE
      // body; this asks it of all 175, which is what the /awarder/:eik → /sector/:id
      // cross-link now depends on: it resolves a member EIK to A sector, so a body
      // claimed by two would be attributed to whichever the lookup reached first.
      //
      // `sectorDashboards.ts` refuses that at module load, so a dashboards collision
      // fails the build rather than this test. The value here is the OTHER registry
      // and the pairing: browse packs have no such guard, and a double-claim there
      // double-counts a body's money across two published sector totals.
      const claims = (
        sets: Array<{ id: string; eiks: readonly string[] }>,
      ): string[] => {
        const owner = new Map<string, string[]>();
        for (const s of sets)
          for (const eik of new Set(s.eiks))
            owner.set(eik, [...(owner.get(eik) ?? []), s.id]);
        return [...owner]
          .filter(([, ids]) => ids.length > 1)
          .map(([eik, ids]) => `${eik} -> ${ids.join(", ")}`)
          .sort();
      };

      const dashboardSets = Object.entries(SECTOR_DASHBOARDS).map(
        ([id, c]) => ({
          id,
          eiks: c.members.map((m) => m.eik),
        }),
      );
      const packSets = Object.values(SECTOR_BROWSE_PACKS).map((p) => ({
        id: p.id,
        eiks: p.eiks,
      }));

      // Floors first: without them a renamed export or an emptied registry makes
      // both assertions pass by having nothing to compare — the absence-equivalent
      // failure this file's own header warns about.
      // Floor the EIKs actually walked, not the number of sets holding them: 18
      // packs whose `eiks` arrays had all been emptied would pass a set-count
      // floor while comparing nothing. Browse packs are the arm that needs this
      // most — SECTOR_DASHBOARDS has a module-load guard in sectorDashboards.ts
      // and these have none.
      const memberCount = dashboardSets.reduce((n, s) => n + s.eiks.length, 0);
      const packEikCount = packSets.reduce((n, s) => n + s.eiks.length, 0);
      assert.ok(
        memberCount > 150,
        `only ${memberCount} dashboard members scanned — the registry looks empty`,
      );
      assert.ok(
        packEikCount > 250,
        `only ${packEikCount} browse-pack EIKs scanned — the registry looks empty`,
      );

      assert.deepEqual(
        claims(dashboardSets),
        [],
        "an EIK is a member of two sector dashboards",
      );
      assert.deepEqual(
        claims(packSets),
        [],
        "an EIK is claimed by two browse packs",
      );
    },
  );

  test.skipIf(skip)("no browse pack ships a duplicate EIK", () => {
    // A repeated EIK is harmless inside an IN (...) filter, which is why one
    // survived unnoticed in `judiciary` — but it makes eiks.length wrong and
    // would double-weight a member the day the list drives a per-EIK fan-out.
    const dupes = Object.values(SECTOR_BROWSE_PACKS)
      .filter((p) => new Set(p.eiks).size !== p.eiks.length)
      .map((p) => p.id);
    assert.deepEqual(dupes, [], `browse packs with duplicate EIKs: ${dupes}`);
  });

  test.skipIf(skip)(
    "the second-level МЗ family is deliberately out of the EIK-set",
    async () => {
      // ЦСМП / РЗИ / НЦОЗА are 54 separate legal persons under МЗ (~€86.6m).
      // Excluding them is a decision recorded in healthReferenceData.ts, not an
      // oversight — so assert it holds rather than letting a later sweep fold
      // them in silently. Resolved from the corpus, so it also catches a body
      // that starts matching after a rename.
      const rows = await allRows<{ eik: string }>(
        `select distinct awarder_eik eik from contracts
          where tag='contract'
            and (awarder_name ilike '%спешна медицинска помощ%'
              or awarder_name ilike '%регионална здравна инспекц%'
              or awarder_name ilike '%обществено здраве%')`,
      );
      const secondLevel = new Set(rows.map((r) => r.eik));
      // Measured 54. A floor of >10 would still pass after a reload that lost
      // 43 of them, leaving the anti-leak check below measuring an almost-empty
      // set — the vacuous-gate shape this file warns about elsewhere.
      assert.ok(
        secondLevel.size >= 40,
        `second-level МЗ sweep found only ${secondLevel.size} bodies (expected ~54)`,
      );
      const leaked = HEALTH_SECTOR_EIKS.filter((e) => secondLevel.has(e));
      assert.deepEqual(
        leaked,
        [],
        `second-level МЗ bodies leaked into HEALTH_SECTOR_EIKS: ${leaked.join(", ")}`,
      );
    },
  );

  test.skipIf(skip)(
    "the state and university hospitals stay out of the EIK-set",
    async () => {
      // The biggest neighbour by far — 234 bodies / €10.6bn, 3.7× МЗ — and the
      // one whose exclusion is NOT covered by the second-level argument: they
      // are commercial ЕАД/ООД, and МЗ holds the state's shares in them. What
      // rules them out is that НЗОК REIMBURSES them, so a set holding both the
      // payer and its payees counts the same care twice. Gated because the
      // reference file's earlier phrasing ("principal is verifiably the Minister
      // of Health") read as an invitation to add them.
      const rows = await allRows<{ eik: string }>(
        `select distinct awarder_eik eik from contracts
          where tag='contract'
            and (awarder_name ilike '%МБАЛ%' or awarder_name ilike '%болница%'
              or awarder_name ilike '%диспансер%')`,
      );
      const hospitals = new Set(rows.map((r) => r.eik));
      assert.ok(
        hospitals.size >= 150,
        `hospital sweep found only ${hospitals.size} bodies (expected ~234)`,
      );
      const leaked = HEALTH_SECTOR_EIKS.filter((e) => hospitals.has(e));
      assert.deepEqual(
        leaked,
        [],
        `hospitals leaked into HEALTH_SECTOR_EIKS — that double-counts НЗОК's own payees: ${leaked.join(", ")}`,
      );
    },
  );

  test.skipIf(skip)(
    "МЗ is a real signature awarder, far above НЗОК's own ЗОП line",
    async () => {
      const [r] = await allRows<{ name: string | null }>(
        `select min(awarder_name) name
           from contracts where tag='contract' and awarder_eik = $1`,
        [MZ_EIK],
      );
      // r is never nullish — a bare aggregate always returns one row — so the
      // "does this EIK exist in the corpus" check has to be on the NAME.
      assert.ok(r?.name, `no contracts at all for МЗ EIK ${MZ_EIK}`);
      assert.ok(
        /министерство на здравеопазването/i.test(r.name),
        `awarder_name for ${MZ_EIK} is not МЗ: ${r.name}`,
      );
      // Floor well under today's €2.84bn — this is the reason the sector was
      // widened, so a collapse here means the widening stopped being worth it.
      const eur = await sectorSum([MZ_EIK]);
      assert.ok(
        eur > 1_500_000_000,
        `МЗ procurement €${eur} below the floor — is the EIK still right?`,
      );
    },
  );

  test.skipIf(skip)(
    "full-year (December) backfill locks the y:2022-2024 payout scopes",
    () => {
      // The /quarter B1 feed lists 2022-2024 only through month 11, so those
      // years' hub scopes once showed an ~8-11% understated 11-month cumulative.
      // write_execution_annual.ts pins the hand-verified full-year figures and
      // write_execution.ts merges them as month-12 points. Pin the exact euro
      // values (immutable audited history) + assert the y:<year> scope reflects
      // the full year, so dropping the sidecar or the merge is caught.
      const EXPECTED: Record<number, number> = {
        2022: 3_186_364_868,
        2023: 3_518_553_760,
        2024: 4_166_591_166,
      };
      const hist = readJson<NzokHistory>(
        "data/budget/nzok/execution_history.json",
      );
      const stats = readJson<SectorStats>(
        "data/procurement/derived/sector_stats.json",
      );
      for (const [yStr, eur] of Object.entries(EXPECTED)) {
        const year = Number(yStr);
        const dec = hist.points.find((p) => p.year === year && p.month === 12);
        assert.ok(
          dec,
          `execution_history.json missing month-12 point for ${year}`,
        );
        assert.equal(
          dec.expenditureEur,
          eur,
          `${year} full-year expenditure drifted from the verified value`,
        );
        assert.equal(
          dec.backfilled,
          true,
          `${year} month-12 point should be flagged backfilled`,
        );
        const scope = stats[`y:${year}`]?.health;
        assert.ok(scope, `sector_stats missing y:${year}.health`);
        assert.equal(
          scope.value,
          eur,
          `y:${year} health scope must use the full-year (not the 11-month) figure`,
        );
        assert.equal(scope.year, year);
      }
    },
  );

  test.skipIf(skip)(
    "no health scope publishes a year the НЗОК feed has not closed",
    () => {
      // The B1 feed is CUMULATIVE-YTD, so only a month-12 point is a year. The
      // test above pins three specific years; this one is the corpus-wide rule,
      // and it exists because the sector has shipped this defect in BOTH of its
      // shapes — 2022-2024 as 11-month cumulatives (fixed by the backfill the
      // test above locks) and 2026 as a FOUR-month one, €1.72bn captioned
      // „изплатено 2026" against 2025's €4.72bn. The second shape can never be
      // backfilled, because the year is not over: the only thing standing
      // between it and the artifact is the selection rule, and this gate.
      const hist = readJson<NzokHistory>(
        "data/budget/nzok/execution_history.json",
      );
      const stats = readJson<SectorStats>(
        "data/procurement/derived/sector_stats.json",
      );
      assert.deepEqual(
        partialYearViolations(hist.points, stats),
        [],
        "a health scope is publishing a cumulative-YTD figure as an annual payout",
      );

      // Mutation check. Run the same rule over a SYNTHETIC feed rather than the
      // live one — the live-corpus form of this check stops discriminating the
      // moment 2026 gets a December point, which is exactly when a reader would
      // most trust a green suite. The fixture reconstructs the pre-fix
      // selection: take the last point of a year whether or not it closed, and
      // caption it with that year.
      const openYear = 2999;
      assert.notDeepEqual(
        partialYearViolations(
          [{ year: openYear, month: 4, expenditureEur: 1_720_537_150 }],
          {
            [`y:${openYear}`]: {
              health: {
                kind: "eur",
                basis: "payout",
                value: 1_720_537_150,
                year: openYear,
              },
            },
          },
        ),
        [],
        "the gate no longer catches a partial year published as an annual payout",
      );
    },
  );

  test.skipIf(skip)(
    "НЗОК is a real signature awarder, far below its payout",
    async () => {
      const rows = await allRows<{ name: string; cnt: string; eur: string }>(
        `select min(awarder_name) name, count(*) cnt,
              coalesce(round(sum(amount_eur)),0)::text eur
         from contracts
        where tag='contract' and awarder_eik = $1`,
        [NZOK_EIK],
      );
      const r = rows[0];
      assert.ok(r, "НЗОК EIK not found in contracts");
      assert.ok(
        /здравноосигурителна/i.test(r.name),
        `awarder_name for ${NZOK_EIK} is not НЗОК: ${r.name}`,
      );
      const eur = Number(r.eur);
      // Signature floor: НЗОК does run its own ЗОП (admin/IT/PDFs), but it must
      // stay far below the payout headline — proving payout ≠ procurement here.
      assert.ok(
        eur > 10_000_000,
        `НЗОК own procurement €${eur} suspiciously low`,
      );
      assert.ok(
        eur < 1_000_000_000,
        `НЗОК own procurement €${eur} suspiciously high`,
      );
    },
  );

  // ── beneficiary side ──────────────────────────────────────────────────────
  // Everything above audits the BUYER side. These five cover who the money
  // reaches, which no other gate in this file looks at. Shares and agreement,
  // never a rank or an absolute € — a leaderboard is SUPPOSED to reorder on
  // every fortnightly reload, and that is the one thing about it that is not a
  // defect.

  test.skipIf(skip)(
    "the top health beneficiary stays a share, not the whole window",
    async () => {
      const rows = await allRows<{ eik: string; name: string; eur: string }>(
        `select contractor_eik eik, min(contractor_name) name,
                coalesce(round(sum(amount_eur)),0)::text eur
           from contracts
          where tag='contract' and awarder_eik = any($1)
          group by 1 order by sum(amount_eur) desc nulls last limit 1`,
        [[...HEALTH_SECTOR_EIKS]],
      );
      const top = rows[0];
      assert.ok(top, "no beneficiaries for the health EIK-set");
      const total = await sectorSum(HEALTH_SECTOR_EIKS);
      const pct = (100 * Number(top.eur)) / total;
      // 8.42% measured 2026-08-16 (Санита Трейдинг, a pharma distributor).
      //
      // A BROAD sanity ceiling only: it catches a leaderboard that has collapsed
      // onto one supplier — a bad EIK fold, a scope that shrank to one contract.
      // It is deliberately NOT the consortium-double-count gate, and an earlier
      // draft of this comment wrongly claimed it was: measured, crediting every
      // member the full value moves this share 8.420% → 8.239%, i.e. DOWN, since
      // the mutation inflates the denominator too and the whole consortium
      // corpus is 1.5% of the sector. That defect is caught directly by the next
      // test. 15% rather than 25% so this can fire before a collapse completes.
      assert.ok(
        pct < 15,
        `top health beneficiary ${top.name} holds ${pct.toFixed(1)}% of the sector — has the leaderboard collapsed onto one supplier?`,
      );
    },
  );

  test.skipIf(skip)(
    "consortium members carry €0 — the money sits once, on the carrier",
    async () => {
      // The consortium double-count, asserted directly — the ceiling above
      // CANNOT see it (see its note: the mutation moves that share down), so
      // this is the only gate that covers it. МЗ buys through обединения (41 contracts, €43.6m); each is
      // stored as N zero-valued `member` rows plus ONE `carrier` row holding the
      // full value. If members ever start carrying money, every consortium
      // contract counts (N+1)× and the sector total inflates with no row count
      // moving. НЗОК alone has no consortium rows at all, so this arrived with
      // the МЗ widening.
      const rows = await allRows<{ role: string; n: string; eur: string }>(
        `select consortium_role role, count(*)::text n,
                coalesce(round(sum(amount_eur)),0)::text eur
           from contracts
          where tag='contract' and awarder_eik = any($1)
            and consortium_eik is not null
          group by 1`,
        [[...HEALTH_SECTOR_EIKS]],
      );
      const eurByRole = Object.fromEntries(
        rows.map((r) => [r.role, Number(r.eur)]),
      );
      const nByRole = Object.fromEntries(
        rows.map((r) => [r.role, Number(r.n)]),
      );

      // Prove the SUBJECT is still there before measuring it — this file's own
      // header (see the energy note) forbids a gate over an expected-empty
      // thing, and measured, `member ?? 0` read an absent key as a pass: with
      // every member row deleted, all three assertions below went green.
      assert.ok(
        (nByRole.member ?? 0) > 0,
        "no consortium `member` rows in the health set — this gate has gone vacuous (has the consortium split stopped emitting members?)",
      );
      assert.ok(
        (nByRole.carrier ?? 0) > 0,
        "no consortium `carrier` rows in the health set — this gate has gone vacuous",
      );
      assert.equal(
        eurByRole.member,
        0,
        "consortium member rows carry money — the sector total is double-counting",
      );
      assert.ok(
        eurByRole.carrier > 0,
        "consortium carriers hold no money — has the split changed shape?",
      );

      // …and each consortium CONTRACT's rows sum to exactly its full value.
      // contract_id is nullable and 13 consortium rows corpus-wide carry NULL,
      // which GROUP BY would collapse into one bucket — so assert the key
      // separately, and let a NULL in EITHER money column FAIL rather than pass
      // (a NULL makes the HAVING expression NULL, i.e. "not bad" — measured,
      // €11.9m of amount_eur could be dropped with every assertion green).
      const [k] = await allRows<{ nulls: string }>(
        `select count(*)::text nulls from contracts
          where tag='contract' and awarder_eik = any($1)
            and consortium_eik is not null and contract_id is null`,
        [[...HEALTH_SECTOR_EIKS]],
      );
      assert.equal(
        Number(k?.nulls ?? -1),
        0,
        "consortium rows with a NULL contract_id — the per-contract grouping below cannot be trusted",
      );
      const [m] = await allRows<{ bad: string }>(
        `select count(*)::text bad from (
           select contract_id
             from contracts
            where tag='contract' and awarder_eik = any($1)
              and consortium_eik is not null
            group by contract_id
           having count(consortium_full_eur) <> count(*)
               or count(amount_eur) <> count(*)
               or abs(sum(amount_eur) - min(consortium_full_eur)) > 1) t`,
        [[...HEALTH_SECTOR_EIKS]],
      );
      assert.equal(
        Number(m?.bad ?? -1),
        0,
        "a consortium contract's rows do not sum to its full value (or the full value is NULL)",
      );
    },
  );

  test.skipIf(skip)(
    "the supplier leaderboard and the awarder total differ only by the three documented exclusions",
    async () => {
      // Failure mode O — the leaderboard and the headline drifting onto
      // different bases — which is invisible to every other gate here because
      // both halves stay individually correct.
      //
      // ⚠ TWO earlier drafts of this test were tautologies, so read this before
      // simplifying it. The first compared two queries it wrote itself with the
      // SAME predicate (`Σ_groups Σ_rows ≡ Σ_rows`). The second split the rows
      // on 061's `sup` predicates and asserted the halves summed to the whole —
      // but those halves are exact COMPLEMENTS and `contractor_eik` is NOT NULL,
      // so `Σ_P + Σ_¬P ≡ Σ_all` was provable arithmetic over any corpus. Both
      // restated 061's predicates rather than reading them, which is why a
      // change to the function itself — the actual subject — moved nothing.
      //
      // So this calls `awarder_group_model()`, the function /awarder/:eik and
      // the sector dashboards actually render, and reconciles ITS OWN two
      // outputs: the suppliers it lists against the total it reports. They do
      // NOT agree, by design — the `sup` CTE drops blank-EIK, consortium
      // `member` and self-award rows from `suppliers` while keeping their € in
      // the headline, because the money really was spent. Measured 2026-08-16:
      // totalEur 2,922,420,337 over 864 suppliers summing to 2,921,680,003, a
      // €740,337 gap. The invariant is that every euro of that gap is one of
      // the three documented exclusions and nothing else.
      const [g] = await allRows<{ total: string; supp: string; n: string }>(
        `with m as (select awarder_group_model($1::text[]) j)
         select (j->>'totalEur') total,
                (select coalesce(round(sum((x->>'totalEur')::double precision)),0)::text
                   from jsonb_array_elements(j->'suppliers') x) supp,
                (select count(*)::text from jsonb_array_elements(j->'suppliers') x) n
           from m`,
        [[...HEALTH_SECTOR_EIKS]],
      );
      assert.ok(
        g?.total,
        "awarder_group_model returned no model for the health set",
      );
      const excluded = await sectorSum(HEALTH_SECTOR_EIKS, {
        extra: `contractor_eik = '' or consortium_role = 'member'
                or contractor_eik = awarder_eik`,
      });
      // 061 rounds PER SUPPLIER and then sums, so the slack is proportional to
      // the supplier COUNT rather than a flat ±1 (measured δ = 3 over 864). A
      // flat tolerance sat exactly on its own boundary and would flip red on an
      // ordinary reload.
      //
      // What that tolerance can and cannot see, stated rather than assumed:
      // dropping the blank-EIK exclusion moves €740,146 — 856× the slack, so it
      // fires loudly. Dropping the SELF-AWARD exclusion moves €191, which is
      // under it; that arm is covered on the COUNT side by the next test, not
      // here. No single gate covers all three.
      assert.ok(
        Math.abs(Number(g.supp) + excluded - Number(g.total)) <= Number(g.n),
        `awarder_group_model's suppliers + documented exclusions ≠ its own totalEur (${g.supp} + ${excluded} vs ${g.total}) — an unexplained residual means the leaderboard and the headline have stopped sharing a basis`,
      );
      // The exclusions must be NON-EMPTY, or the reconciliation degenerates into
      // the identity it replaced.
      assert.ok(
        excluded > 0,
        "no excluded rows — this reconciliation has gone vacuous",
      );
      // The tag filter this block leans on must still discriminate: €32.1m of
      // amendments today. (This catches amendments DISAPPEARING, not a partial
      // leak — `tag='contract'` is in every query here, so a retagged row enters
      // every term at once and reconciles. A partial leak is out of reach of
      // this gate and the comment must not claim otherwise.)
      const [amend] = await allRows<{ eur: string }>(
        `select coalesce(round(sum(amount_eur)),0)::text eur from contracts
          where tag='contractAmendment' and awarder_eik = any($1)`,
        [[...HEALTH_SECTOR_EIKS]],
      );
      assert.ok(
        Number(amend?.eur ?? 0) > 0,
        "no amendments in the health set — the tag='contract' filter no longer discriminates, so every basis assertion in this block has gone vacuous",
      );
    },
  );

  test.skipIf(skip)(
    "consortium members don't inflate the distinct-supplier count",
    async () => {
      // The COUNT side of the same split, and the reason the `member` exclusion
      // exists at all: dropping it adds 15 phantom zero-euro suppliers to the
      // leaderboard and to the HHI denominator while moving NO money, so every
      // money gate above stays green. (15, not 116 — 116 is the member ROW
      // count, folding onto 29 EIKs of which 15 appear nowhere else. Quoting a
      // row count as a supplier count is the exact conflation this gate exists
      // to catch, and an earlier draft of this comment made it.)
      //
      // Each arm is asserted SEPARATELY. Folded into one inequality, any single
      // exclusion could die while the other two held it green — measured,
      // renaming consortium_role 'member' → 'participant' gave 879 vs 881 and
      // PASSED, and deleting every member row gave 864 vs 866 and PASSED.
      const [r] = await allRows<{
        withAll: string;
        noMember: string;
        noBlank: string;
        noSelf: string;
        memberOnly: string;
      }>(
        `select count(distinct contractor_eik)::text as "withAll",
                count(distinct contractor_eik) filter (
                  where consortium_role is distinct from 'member')::text as "noMember",
                count(distinct contractor_eik) filter (
                  where contractor_eik <> '')::text as "noBlank",
                count(distinct contractor_eik) filter (
                  where contractor_eik <> awarder_eik)::text as "noSelf",
                (select count(*)::text from (
                   select contractor_eik from contracts
                    where tag='contract' and awarder_eik = any($1)
                      and consortium_role = 'member'
                   except
                   select contractor_eik from contracts
                    where tag='contract' and awarder_eik = any($1)
                      and consortium_role is distinct from 'member') z) as "memberOnly"
           from contracts
          where tag='contract' and awarder_eik = any($1)`,
        [[...HEALTH_SECTOR_EIKS]],
      );
      assert.ok(r, "no supplier-count row for the health set");
      // Prove the SUBJECT exists before measuring it: EIKs that appear ONLY as
      // consortium members are what the exclusion removes from the count.
      assert.ok(
        Number(r.memberOnly) > 0,
        "no member-only contractor EIKs — this gate has gone vacuous (has the consortium split stopped emitting members, or been renamed?)",
      );
      // …and each exclusion narrows the count on its own.
      assert.ok(
        Number(r.noMember) < Number(r.withAll),
        `the consortium-member exclusion no longer narrows the supplier count (${r.noMember} vs ${r.withAll}) — the HHI denominator has stopped being guarded`,
      );
      assert.ok(
        Number(r.noBlank) < Number(r.withAll),
        `the blank-EIK exclusion no longer narrows the supplier count (${r.noBlank} vs ${r.withAll})`,
      );
      assert.ok(
        Number(r.noSelf) < Number(r.withAll),
        `the self-award exclusion no longer narrows the supplier count (${r.noSelf} vs ${r.withAll})`,
      );
    },
  );

  test.skipIf(skip)(
    "Информационно обслужване is still recognisable as a state body",
    async () => {
      // ИО АД takes €35.6m of this sector (measured 2026-08-16) under чл. 7с
      // ЗЕУ, which designates it the state's systems integrator — so its
      // single-bid awards are a legal monopoly rather than a competition
      // failure, and the money never leaves government. It was 21.8% of the
      // sector before МЗ was added and 1.22% after, so nothing here pins a
      // share. For its ownership, see the annotation beside the same EIK in
      // SOCIAL_STATE_BODY_CONTRACTORS — stated once, there, not restated here.
      //
      // What IS pinned is the CURATED artifact, because that is the only thing
      // a source change can break: NZOK_SUPPLIER_CONTEXT is what
      // NzokProcurementLensTile renders the чл. 7с ЗЕУ chip from. Drop the entry
      // or mistype its key and the chip vanishes, leaving exactly the "apparent
      // market award" this gate exists to prevent — while every corpus fact
      // below stays true.
      //
      // ⚠ Do NOT swap this for the derived probe "is this contractor an awarder
      // elsewhere?". socialReferenceData.ts documents why that over-captures —
      // ЗОП's utilities regime makes private regulated companies contracting
      // authorities — and on THIS sector it also returns Овергаз, ЕВН, Ситигаз
      // and Аресгаз, none of them public bodies.
      // Addressed by KEY, not positionally: "831641791" is an array-index-like
      // string, so JS would order a numerically smaller second entry (НЗОК's own
      // 121858220 being the likeliest addition) ahead of it and fail with
      // "ИО is gone" on a change that did not touch ИО.
      const ioEik = "831641791";
      const ioCtx = NZOK_SUPPLIER_CONTEXT[ioEik];
      assert.ok(
        ioCtx,
        "NZOK_SUPPLIER_CONTEXT no longer keys ИО — its single-bid awards now read as a competition failure rather than a чл. 7с ЗЕУ designation",
      );
      assert.ok(
        /ЗЕУ|systems integrator/i.test(`${ioCtx.bg} ${ioCtx.en}`),
        "the ИО context chip no longer states the statutory basis",
      );
      // `kind` is a single-inhabitant literal type, so asserting it is vacuous.
      // What is worth pinning is the artifact's EXTENT: the tile is calibrated
      // for exactly this one statutory supplier, so a silent second entry is a
      // claim about a company nobody reviewed.
      assert.deepEqual(
        Object.keys(NZOK_SUPPLIER_CONTEXT),
        [ioEik],
        "NZOK_SUPPLIER_CONTEXT gained or lost an entry — each one asserts a statutory basis for a supplier's lack of competition and needs its own review",
      );

      // Narrower tripwires: the EIK is still real and still in this sector.
      const [h] = await allRows<{ eur: string }>(
        `select coalesce(round(sum(amount_eur)),0)::text eur from contracts
          where tag='contract' and awarder_eik = any($1) and contractor_eik = $2`,
        [[...HEALTH_SECTOR_EIKS], ioEik],
      );
      assert.ok(
        Number(h?.eur ?? 0) > 0,
        "ИО no longer appears as a health-sector contractor — did the EIK change?",
      );
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────

/** funds.json's per-year shape, to the depth these gates read. */
type NoiFundsFile = {
  years: Array<{
    fiscalYear: number;
    complete?: boolean;
    funds: Array<{ fundCode: string; pensionsBgn?: number | null }>;
    totals: {
      revenue: { amountEur: number };
      pensions?: { amountEur?: number };
    };
  }>;
};

describe("pension sector (payout / ДОО)", () => {
  const stats = () =>
    readJson<SectorStats>("data/procurement/derived/sector_stats.json");
  const funds = () => readJson<NoiFundsFile>("data/budget/noi/funds.json");

  test.skipIf(skip)(
    "hub headline is payout, in-band, reconciles to the latest COMPLETE year's ДОО line",
    () => {
      const s = stats();
      const p = s["all"]?.pension;
      assert.ok(p, "sector_stats.json['all'].pension must exist");
      assert.equal(p.kind, "eur");
      assert.equal(
        p.basis,
        "payout",
        "pension must front the ДОО payout, not НОИ's thin ЗОП line (€130.6m, 1.2% of it)",
      );

      // Sanity band ONLY. It deliberately does not try to discriminate the
      // three-fund rollup: the two are 0.47% apart, and a ceiling tight enough
      // to separate them cannot survive ordinary indexation — ДОО grew 13.4%
      // from 2023 (€9.77bn) to 2024 (€11.08bn), so a €11.2bn ceiling would red
      // `test:data`, and with it the last link of db:refresh, on a correct
      // figure at the next NOI ingest. No literal satisfies both jobs. The
      // rollup guard is the relative assertion below.
      assert.ok(
        p.value > 8_000_000_000 && p.value < 20_000_000_000,
        `pension payout €${p.value} out of expected band 8–20bn`,
      );

      // Reconcile to the declared source of truth, through the SAME accessor the
      // generator and /pensions use. Recomputing the selection here would let a
      // bug in noiYear.ts satisfy its own gate.
      const latest = latestCompleteNoiYear(funds().years);
      assert.ok(latest, "funds.json carries no complete year");
      const expected = dooPensionsEur(latest);
      assert.ok(
        expected,
        "the latest complete year carries no ДОО pension line",
      );
      assert.equal(
        p.value,
        expected,
        "headline must be the ДОО fund alone — totals.pensions is the 3-fund rollup",
      );
      assert.equal(p.year, latest.fiscalYear);

      // The rollup guard that actually discriminates, and that cannot go stale
      // as the series grows: ДОО is strictly ONE of the three funds, so the
      // headline must sit strictly below the rollup — at any scale, in any year.
      const rollup = latest.totals.pensions?.amountEur;
      assert.ok(
        rollup,
        "the latest complete year carries no three-fund rollup",
      );
      assert.ok(
        p.value < rollup,
        `headline €${p.value} is at or above the three-fund rollup €${rollup} — ` +
          "the tile is publishing ДОО + УчПФ + ГВРС, not ДОО alone",
      );

      // Every scope must carry the key. The generator omits `pension` wholesale
      // when the series is empty, so a PARTIAL emission (present on `all`,
      // dropped from the ns:/y: scopes) is the one shape the per-scope loops in
      // the tests below cannot see — each skips a missing key and stays green.
      const withPension = Object.values(s).filter((sec) => sec.pension).length;
      assert.equal(
        withPension,
        Object.keys(s).length,
        `${Object.keys(s).length - withPension} scope(s) carry no pension stat — ` +
          "the per-scope gates below silently skip those",
      );
    },
  );

  test.skipIf(skip)("no scope ever publishes the three-fund rollup", () => {
    // ДОО + Учителски пенсионен фонд + ГВРС. €52,502,905 / 0.47% above the ДОО
    // line on 2024, all of it УчПФ. The hub tile served this while /pensions —
    // the page it links to — served ДОО, which is the defect this file gates.
    const latest = latestCompleteNoiYear(funds().years);
    assert.ok(latest);
    const rollup = latest.totals.pensions?.amountEur;
    const doo = dooPensionsEur(latest);
    assert.ok(rollup && doo);
    // Without this the gate goes vacuous the moment the two coincide (e.g. a
    // year where only ДОО reported), and would then pass on the bug it exists for.
    assert.notEqual(
      rollup,
      doo,
      "rollup == ДОО this year — the gate below cannot discriminate; " +
        "pin a year where they differ before trusting it",
    );
    for (const [key, sectors] of Object.entries(stats()))
      if (sectors.pension)
        assert.notEqual(
          sectors.pension.value,
          rollup,
          `${key} publishes the three-fund rollup`,
        );
  });

  test.skipIf(skip)("a SHELL year is never published as its own payout", () => {
    // The B1 ingest publishes each new fiscal year mid-cycle as a shell:
    // funds: [], revenue 0, and a totals.pensions that is really the pension
    // YEARBOOK's grand total. This is the tripwire for the latent half of the
    // audit — the day a 2025 shell lands, an un-guarded generator flips `all`
    // and every ns: headline onto it while /pensions holds the last complete
    // year. Asserting against the ARTIFACT (not a recomputation) is what makes
    // a stale committed file fail too.
    //
    // ⚠ Today's only shell (2023) has `funds: []`, so dooPensionsEur already
    // returns null for it and a guard-ONLY regression in the generator is
    // absorbed upstream — a green run here is therefore NOT evidence that the
    // isCompleteNoiYear call is load-bearing. What this test uniquely owns is
    // the STAMPED shell: `complete: false` WITH real fund rows and a 5500
    // snapshot, which the producer can now emit and which nothing else stops.
    const s = stats();
    const shells = funds().years.filter((y) => !isCompleteNoiYear(y));
    for (const y of shells) {
      const scope = s[`y:${y.fiscalYear}`];
      if (!scope?.pension) continue;
      assert.equal(
        scope.pension.unavailable,
        true,
        `y:${y.fiscalYear} is a shell year — it must fall back with a no-data flag, ` +
          "so the tile says no-data-for-that-year rather than a cross-basis figure",
      );
      assert.notEqual(
        scope.pension.year,
        y.fiscalYear,
        `y:${y.fiscalYear} still resolves to the shell year itself`,
      );
      // The cross-basis arm — the yearbook grand total the shell carries in
      // place of a B1 pensions line. Assert the figure EXISTS first: without
      // that, `notEqual(<number>, undefined)` can never fail and the one arm
      // naming the audited defect goes quiet on a shell of a different shape.
      const yearbook = y.totals.pensions?.amountEur;
      assert.ok(
        yearbook,
        `y:${y.fiscalYear} shell carries no totals.pensions — the cross-basis ` +
          "arm below cannot discriminate; confirm the shell shape before trusting it",
      );
      assert.notEqual(
        scope.pension.value,
        yearbook,
        `y:${y.fiscalYear} publishes the pension YEARBOOK grand total as a payout`,
      );
    }
  });

  test.skipIf(skip)("the hub tile and /pensions publish ONE figure", () => {
    // INVOKE the page's own flattener rather than reproducing it. /pensions
    // renders useNoiFundYear → flattenFundYear, so a change confined to the
    // page's half — the exact audited defect, reintroduced there — fails here.
    // A hand-rolled `funds.find(5500)` + fundPensionsEur would not: it would
    // pin the shared accessor (already covered by noiYear.test.ts, with no
    // database) while leaving the surface this test is named for unobserved.
    const page = flattenFundYear(
      readJson<FrontendNoiFundsFile>("data/budget/noi/funds.json"),
    );
    assert.ok(
      page,
      "/pensions would render nothing for the latest complete year",
    );
    const p = stats()["all"].pension;
    assert.equal(
      p.value,
      page.pensionsEur,
      "the hub tile and the page it links to publish different pension figures",
    );
    assert.equal(p.year, page.fiscalYear);
  });

  test.skipIf(skip)(
    "pension is not a procurement sector, and НОИ leaks into no EIK-set",
    async () => {
      const s = stats();
      for (const [key, sectors] of Object.entries(s))
        if (sectors.pension)
          assert.equal(
            sectors.pension.basis,
            "payout",
            `${key}.pension flipped off the payout basis`,
          );

      // НОИ's own procurement is a browse pack, never a sector EIK-set.
      assert.deepEqual(
        [...SECTOR_BROWSE_PACKS.noi.eiks],
        [NOI_EIK],
        "SECTOR_BROWSE_PACKS.noi.eiks drifted from the single НОИ EIK",
      );

      // Exactly ONE browse pack may claim НОИ — the all-packs idiom this file
      // already uses for ДП РАО. Unlike a hand-listed set this cannot silently
      // under-cover: a pack added tomorrow is checked the day it lands.
      const claiming = Object.values(SECTOR_BROWSE_PACKS)
        .filter((pack) => pack.eiks.includes(NOI_EIK))
        .map((pack) => pack.id)
        .sort();
      assert.deepEqual(
        claiming,
        ["noi"],
        `НОИ is claimed by ${claiming.length} browse packs (${claiming.join(", ") || "none"})`,
      );

      // …and no sector EIK-set. `social` is the one the exclusion was actually
      // written for — socialReferenceData.ts:16 carries the ⚠ — because folding
      // НОИ in would double-count the whole pension system into a second tile.
      // `roads` is the fourth member of the generator's SECTOR_EIKS.
      for (const [id, eiks] of Object.entries({
        water: WATER_SECTOR_EIKS,
        transport: TRANSPORT_SECTOR_EIKS,
        energy: ENERGY_SECTOR_EIKS,
        social: SOCIAL_SECTOR_EIKS,
        roads: [API_EIK],
      }))
        assert.ok(
          !eiks.includes(NOI_EIK),
          `НОИ ${NOI_EIK} leaked into the ${id} EIK-set`,
        );

      // A real awarder, so the EIK is not a typo — and orders below the payout,
      // which is exactly why the tile fronts payout rather than procurement.
      const eur = await sectorSum([NOI_EIK]);
      assert.ok(eur > 50_000_000, `НОИ procurement €${eur} — EIK may be wrong`);
      assert.ok(
        eur < s["all"].pension.value / 10,
        `НОИ procurement €${eur} is no longer negligible beside the payout`,
      );
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────

describe("water sector (procurement / ВиК)", () => {
  test.skipIf(skip)(
    "hub headline is procurement and reconciles EXACTLY to the EIK-set",
    async () => {
      const stats = readJson<SectorStats>(
        "data/procurement/derived/sector_stats.json",
      );
      const w = stats["all"]?.water;
      assert.ok(w, "sector_stats.json['all'].water must exist");
      assert.equal(w.kind, "eur");
      assert.equal(
        w.basis,
        "procurement",
        "water must front the operators' own tender flow — it has no ministry seat",
      );

      // Band first, so a wildly wrong number fails with a readable message rather
      // than an equality diff. ~€3.27bn at the 2026-08-13 audit.
      assert.ok(
        w.value > 3_000_000_000 && w.value < 6_000_000_000,
        `water procurement €${w.value} out of expected band 3.0–6.0bn`,
      );

      // THE lockstep gate. The generator imports WATER_SECTOR_EIKS, so comparing
      // the arrays proves nothing; comparing the emitted total against a live sum
      // over the same constant catches any drift on either side — including a
      // stale blob nobody regenerated after the reference data moved.
      assert.equal(
        w.value,
        await sectorSum(WATER_SECTOR_EIKS),
        "headline ≠ Σ contracts over WATER_SECTOR_EIKS — regenerate " +
          "sector_stats.json (npm run db:gen-sector-stats) or reconcile the EIK-set",
      );
    },
  );

  test.skipIf(skip)("the EIK-set copies stay in lockstep", () => {
    // Today this compares the browse pack's array to ITSELF — sectorPacks.tsx
    // assigns `eiks: WATER_SECTOR_EIKS` by reference, so it passes trivially,
    // and that passing IS the desired state. It is a TRIPWIRE, not a content
    // gate: it turns into a real comparison the moment someone replaces the
    // import with a literal list of digits, which is the drift the four-copy
    // rule exists to prevent.
    assert.deepEqual(
      [...SECTOR_BROWSE_PACKS.water.eiks],
      [...WATER_SECTOR_EIKS],
      "SECTOR_BROWSE_PACKS.water.eiks drifted from WATER_SECTOR_EIKS — a copy " +
        "has stopped deriving from the reference data",
    );
    // Water is bespoke (/water), so unlike health it has no generic dashboard
    // entry — assert that, so adding one silently gains a fifth unchecked copy.
    assert.equal(
      SECTOR_DASHBOARDS.water,
      undefined,
      "water gained a SECTOR_DASHBOARDS entry — add it to this lockstep check",
    );
    // NOTE: no duplicate-EIK assertion here. WATER_SECTOR_EIKS is built as
    // [...new Set(...)], so asserting it is deduped can never fail. The check
    // that CAN fail runs on the right input — the raw WATER_OPERATORS rows — in
    // src/lib/vikReferenceData.test.ts, which needs no database.
  });

  test.skipIf(skip)(
    "every operator the 2026-08-13 audit added is present and material",
    async () => {
      // Per-EIK floors ≈ half the measured spend, so ordinary corpus growth can
      // never trip them but a removal or a mistyped digit does. Разград and
      // Кюстендил are whole oblasti that had NO regional operator before this;
      // Пазарджик's live operator was absent while its liquidated predecessor
      // stood in for the oblast.
      const ADDED: Array<[string, number, string]> = [
        ["826043778", 20_000_000, "Водоснабдяване-Дунав (Разград)"],
        ["205756975", 8_000_000, "ДП УСЯ (язовири)"],
        ["205323041", 8_000_000, "ВиК услуги (Пазарджик, live)"],
        ["200167154", 5_000_000, "Кюстендилска вода"],
        ["822104714", 500_000, "ВКС (Пещера)"],
        ["822106633", 50_000, "ВКТВ (Велинград)"],
        ["208403279", 10_000, "ВиК Елин Пелин"],
      ];
      for (const [eik, , label] of ADDED)
        assert.ok(
          WATER_SECTOR_EIKS.includes(eik),
          `${label} (${eik}) dropped out of WATER_SECTOR_EIKS`,
        );

      const rows = await allRows<{ eik: string; eur: string }>(
        `select awarder_eik eik, coalesce(round(sum(amount_eur)),0)::text eur
           from contracts
          where tag='contract' and awarder_eik = any($1)
          group by 1`,
        [ADDED.map(([e]) => e)],
      );
      const byEik = new Map(rows.map((r) => [r.eik, Number(r.eur)]));
      for (const [eik, floor, label] of ADDED) {
        const eur = byEik.get(eik) ?? 0;
        assert.ok(
          eur >= floor,
          `${label} (${eik}) has €${eur}, below the €${floor} floor — ` +
            `either the EIK is wrong or its contracts left the corpus`,
        );
      }
    },
  );

  test.skipIf(skip)(
    "the sector and the holding group do not collapse into each other",
    async () => {
      // /water answers "what does the water sector buy"; /awarder/206086428
      // answers "what does Български ВиК холдинг's group buy". The sector is the
      // strict superset, and the gap is dominated by Софийска вода — a Veolia
      // CONCESSION that must never be counted as a holding company.
      const holding = [VIK_HOLDING_EIK, ...VIK_HOLDING_SUB_EIKS];
      for (const e of holding)
        assert.ok(
          WATER_SECTOR_EIKS.includes(e),
          `holding member ${e} missing from the sector set`,
        );
      assert.ok(
        holding.length < WATER_SECTOR_EIKS.length,
        "the holding group must stay strictly narrower than the sector",
      );

      const [sector, group] = [
        await sectorSum(WATER_SECTOR_EIKS),
        await sectorSum(holding),
      ];
      assert.ok(sector > group, "sector total must exceed the holding group's");
      // ~€896M at the audit. A band, not a figure — this is the number an earlier
      // draft hard-coded in three source files and got wrong in all three.
      const gap = sector - group;
      assert.ok(
        gap > 600_000_000 && gap < 1_600_000_000,
        `sector−holding gap €${gap} out of band — one universe may have been ` +
          `pointed at the other's EIK-set`,
      );
    },
  );

  test.skipIf(skip)(
    "name-collision bodies stay out, and every member is a real awarder",
    async () => {
      // Each of these matches a водоснабдяване/води name sweep and is NOT a water
      // operator. The first four are МОСВ bodies already inside ENV_SECTOR_EIKS,
      // so admitting one double-counts it across two sector tiles.
      const MUST_NOT_BE_MEMBERS: Array<[string, string]> = [
        ["114597909", "Басейнова дирекция — Дунавски район"],
        ["103776654", "Басейнова дирекция — Черноморски район"],
        ["000530415", "РИОСВ"],
        ["000697371", "Дирекция ЕМП към МОСВ"],
        ["102819095", "Център за подводна археология"],
        // The retired ВиК Свищов EIK: the SAME company as 200736851, so
        // including it would render two rows for one operator and double-count.
        ["000120252", "ВиК Свищов (retired EIK)"],
      ];
      for (const [eik, label] of MUST_NOT_BE_MEMBERS)
        assert.ok(
          !WATER_SECTOR_EIKS.includes(eik),
          `${label} (${eik}) must not be a water-sector member`,
        );

      // Every curated EIK resolves to a real awarder — catches a typo that would
      // silently contribute €0 and never show up in any total.
      const rows = await allRows<{ eik: string }>(
        `select distinct awarder_eik eik from contracts
          where tag='contract' and awarder_eik = any($1)`,
        [[...WATER_SECTOR_EIKS]],
      );
      const seen = new Set(rows.map((r) => r.eik));
      const missing = WATER_SECTOR_EIKS.filter((e) => !seen.has(e)).map(
        (e) => `${e} (${WATER_OPERATORS.find((o) => o.eik === e)?.name})`,
      );
      assert.deepEqual(
        missing,
        [],
        `curated water EIKs with no contracts at all: ${missing.join(", ")}`,
      );
    },
  );

  test.skipIf(skip)(
    "every member LOOKS like a water body in the corpus, under every spelling",
    async () => {
      // The POSITIVE half, and the one the audit family is named for. A denylist
      // only catches the wrong bodies somebody already thought of; the defense
      // near-miss was two МВР directorates worth €370M that no denylist named.
      // A wrong-but-real EIK passes every other gate here — including the exact
      // reconciliation, because the test and the generator read the SAME
      // constant, so both sides move together and the headline just inflates.
      //
      // Checked against EVERY distinct awarder_name, not min(): the corpus
      // carries many spellings per EIK and asserting one lets the others rot.
      // Deliberately loose — it must accept „в и К ООД", which is how seven
      // members are recorded — so it is a sanity check on KIND, not a
      // classifier. Pairs with the denylist above, which handles the near-misses
      // this cannot: „Център за подводна археология" contains „водна", and the
      // retired ВиК Свищов EIK is a genuine water company excluded for being a
      // duplicate of 200736851 rather than for not being water.
      const WATER_NAME =
        /водоснабдяване|в и к|вик|вода|водна|напоителн|язовир|канализац/i;
      const rows = await allRows<{ eik: string; name: string }>(
        `select distinct awarder_eik eik, awarder_name name
           from contracts
          where tag='contract' and awarder_eik = any($1)`,
        [[...WATER_SECTOR_EIKS]],
      );
      const offenders = rows
        .filter((r) => !WATER_NAME.test(r.name))
        .map((r) => `${r.eik} → "${r.name}"`);
      assert.deepEqual(
        offenders,
        [],
        `water-sector members whose corpus name is not a water body — a wrong ` +
          `EIK inflates the headline while every other gate stays green:\n  ` +
          offenders.join("\n  "),
      );
    },
  );
});

describe("transport sector (procurement / МТС)", () => {
  test.skipIf(skip)(
    "hub headline is procurement and reconciles EXACTLY to the EIK-set",
    async () => {
      const stats = readJson<SectorStats>(
        "data/procurement/derived/sector_stats.json",
      );
      const t = stats["all"]?.transport;
      assert.ok(t, "sector_stats.json['all'].transport must exist");
      assert.equal(t.kind, "eur");
      assert.equal(
        t.basis,
        "procurement",
        "transport must front the group's own tender flow — the МТС budget node " +
          "(~€572M) is a fraction of what the group contracts, because the PSO and " +
          "rolling-stock money is capital/EU-funded rather than administrative",
      );

      // ~€7.26bn at the 2026-08-13 audit. The floor is the load-bearing half: it is
      // above the €6.89bn the 11-EIK set produced, so silently reverting the four
      // additions fails here rather than looking like ordinary corpus drift.
      assert.ok(
        t.value > 7_000_000_000 && t.value < 12_000_000_000,
        `transport procurement €${t.value} out of expected band 7.0–12.0bn`,
      );

      assert.equal(
        t.value,
        await sectorSum(TRANSPORT_SECTOR_EIKS),
        "headline ≠ Σ contracts over TRANSPORT_SECTOR_EIKS — regenerate " +
          "sector_stats.json (npm run db:gen-sector-stats) or reconcile the EIK-set",
      );
    },
  );

  test.skipIf(skip)("the EIK-set copies stay in lockstep", () => {
    // Transport has all four copies (unlike water, which is bespoke and has no
    // SECTOR_DASHBOARDS entry). Today each compares an array to ITSELF, because
    // every copy assigns by reference — and that passing IS the desired state.
    // These are TRIPWIRES: they turn into real comparisons the moment someone
    // replaces an import with a literal list of digits.
    assert.deepEqual(
      [...SECTOR_BROWSE_PACKS.transport.eiks],
      [...TRANSPORT_SECTOR_EIKS],
      "SECTOR_BROWSE_PACKS.transport.eiks drifted from TRANSPORT_SECTOR_EIKS",
    );
    assert.deepEqual(
      SECTOR_DASHBOARDS.transport.members.map((m) => m.eik),
      [...TRANSPORT_SECTOR_EIKS],
      "SECTOR_DASHBOARDS.transport.members drifted from TRANSPORT_SECTOR_EIKS",
    );
    assert.equal(
      SECTOR_DASHBOARDS.transport.leadEik,
      TRANSPORT_EIK,
      "the dashboard's lead EIK is no longer the ministry",
    );
    // NOTE: no duplicate-EIK assertion here. It belongs on the raw entity rows and
    // needs no database, so it lives in src/lib/transportReferenceData.test.ts —
    // which matters more for transport than for water, since TRANSPORT_SECTOR_EIKS
    // is a plain .map rather than [...new Set(...)].
  });

  test.skipIf(skip)(
    "every declared universe carries real money — the defect the headline could not show",
    async () => {
      // THE gate this audit exists for. Before it, `aviation` held one EIK (ГД ГВА,
      // the regulator) at €3.68M while the state's air-navigation enterprise was
      // absent — so the mode-split tile rendered a €348M mode as a rounding error
      // and the headline, which was correct to the euro throughout, said nothing
      // about it. Floors are roughly half the measured spend per mode, so corpus
      // growth cannot trip them and a mode collapsing back does.
      const FLOORS: Array<[TransportUniverse, number, string]> = [
        ["rail", 2_000_000_000, "Железници (НКЖИ + БДЖ + ДП ТСВ)"],
        ["ministry", 1_000_000_000, "Министерство (централа)"],
        ["aviation", 150_000_000, "Въздух (БУЛАТСА + Летище София + ГД ГВА)"],
        ["maritime", 140_000_000, "Море, пристанища и Дунав"],
        ["road", 25_000_000, "Автомобилен транспорт и безопасност"],
      ];

      const rows = await allRows<{ eik: string; eur: string }>(
        `select awarder_eik eik, coalesce(round(sum(amount_eur)),0)::text eur
           from contracts
          where tag='contract' and awarder_eik = any($1)
          group by 1`,
        [[...TRANSPORT_SECTOR_EIKS]],
      );
      const byUniverse = new Map<string, number>();
      for (const r of rows) {
        const u = transportUniverseOf(r.eik);
        if (u) byUniverse.set(u, (byUniverse.get(u) ?? 0) + Number(r.eur));
      }

      for (const [universe, floor, label] of FLOORS) {
        assert.ok(
          TRANSPORT_ENTITIES.some((e) => e.universe === universe),
          `universe "${universe}" (${label}) has no entities at all`,
        );
        const eur = byUniverse.get(universe) ?? 0;
        assert.ok(
          eur >= floor,
          `${label} has €${eur}, below the €${floor} floor — a mode has collapsed ` +
            `to a token member, which the hub headline cannot show`,
        );
      }
    },
  );

  test.skipIf(skip)(
    "every body the 2026-08-13 audit added is present and material",
    async () => {
      // ⚠ SCOPES DIFFER PER EIK, on purpose. Летище София was 100% state with МТС as
      // principal, but its corpus runs 2011-01-13 → 2021-04-06 and stops there — the
      // SOF Connect operating concession took the airport over later in 2021. So its
      // floor is meaningful on the whole corpus and on nothing else: under the site's
      // default `ns` scope, under any `y:<year>` after 2021 and under most `ns:`
      // windows it contributes exactly €0, and a floor written against a window would
      // fail. The other three are live, so theirs hold under windows too.
      const ADDED: Array<[string, number, string]> = [
        ["000697179", 130_000_000, "БУЛАТСА (ДП РВД) — air navigation"],
        ["121023551", 40_000_000, "Летище София ЕАД (corpus ends 2021-04-06)"],
        ["000513106", 10_000_000, "ИАППД — река Дунав"],
        ["130847116", 3_000_000, "ДП ТСВ — rail works"],
      ];
      for (const [eik, , label] of ADDED)
        assert.ok(
          TRANSPORT_SECTOR_EIKS.includes(eik),
          `${label} (${eik}) dropped out of TRANSPORT_SECTOR_EIKS`,
        );

      const rows = await allRows<{ eik: string; eur: string }>(
        `select awarder_eik eik, coalesce(round(sum(amount_eur)),0)::text eur
           from contracts
          where tag='contract' and awarder_eik = any($1)
          group by 1`,
        [ADDED.map(([e]) => e)],
      );
      const byEik = new Map(rows.map((r) => [r.eik, Number(r.eur)]));
      for (const [eik, floor, label] of ADDED) {
        const eur = byEik.get(eik) ?? 0;
        assert.ok(
          eur >= floor,
          `${label} (${eik}) has €${eur}, below the €${floor} floor — ` +
            `either the EIK is wrong or its contracts left the corpus`,
        );
      }
    },
  );

  test.skipIf(skip)(
    "the anti-allowlist stays out, and every member is a real awarder",
    async () => {
      // The header's "EXPLICITLY OUT" block, as assertions. Each was measured and
      // rejected in the audit; the last two are the double-count guard — they are
      // the `roads` sector, and admitting either counts €5.6bn of road building in
      // two sector tiles at once.
      const MUST_NOT_BE_MEMBERS: Array<[string, string]> = [
        ["000632256", "Метрополитен ЕАД — municipal (Столична община)"],
        ["121396123", "Български пощи — the „съобщения“ half of МТС"],
        ["131516795", "ИАЕСМИС — the „съобщения“ half of МТС"],
        ["103061301", "Пристанище Варна ЕАД — port OPERATOR"],
        ["117021078", "Пристанищен комплекс Русе ЕАД — port OPERATOR"],
        ["102004532", "Пристанище Бургас ЕАД — port OPERATOR"],
        ["000662655", "НМТБ „Цар Борис III“ — buys medicines"],
        ["115214445", "МТБ Пловдив — buys medicines"],
        ["121747864", "КРС — reports to Народното събрание"],
        ["129009105", "Държавен авиационен оператор — към Министерски съвет"],
        ["000695089", "АПИ — the separate /sector/roads"],
        ["831646048", "„Автомагистрали“ ЕАД — the separate /sector/roads"],
      ];
      for (const [eik, label] of MUST_NOT_BE_MEMBERS)
        assert.ok(
          !TRANSPORT_SECTOR_EIKS.includes(eik),
          `${label} (${eik}) must not be a transport-sector member`,
        );

      // Every curated EIK resolves to a real awarder — catches a typo that would
      // silently contribute €0 and never appear in any total.
      const rows = await allRows<{ eik: string }>(
        `select distinct awarder_eik eik from contracts
          where tag='contract' and awarder_eik = any($1)`,
        [[...TRANSPORT_SECTOR_EIKS]],
      );
      const seen = new Set(rows.map((r) => r.eik));
      const missing = TRANSPORT_SECTOR_EIKS.filter((e) => !seen.has(e)).map(
        (e) => `${e} (${TRANSPORT_ENTITIES.find((t) => t.eik === e)?.name})`,
      );
      assert.deepEqual(
        missing,
        [],
        `curated transport EIKs with no contracts at all: ${missing.join(", ")}`,
      );
    },
  );

  test.skipIf(skip)(
    "every member LOOKS like a transport body in the corpus, under every spelling",
    async () => {
      // The POSITIVE half, which is what the audit family is named for: a denylist
      // only catches the wrong bodies somebody already thought of, and the defense
      // near-miss was two МВР directorates worth €370M that no denylist named. A
      // wrong-but-real EIK passes every other gate here — including the exact
      // reconciliation, because the test and the generator read the SAME constant,
      // so both sides move together and the headline just inflates.
      //
      // Checked against EVERY distinct awarder_name, not min(): the corpus carries
      // many spellings per EIK. Deliberately loose — a sanity check on KIND, not a
      // classifier — and it must accept the ministry itself under its several
      // historical names („Министерство на транспорта, Информационните технологии
      // и съобщенията"), which is why „съобщени" is in the pattern even though the
      // communications BODIES are on the anti-allowlist.
      const TRANSPORT_NAME =
        // „желез" rather than „железоп": the БДЖ holding is recorded as „Холдинг
        // Български държавни ЖЕЛЕЗНИЦИ", which a железопътен-only stem misses.
        /транспорт|желез|жп|бдж|пристанищ|морск|въздух|въздуш|авиац|летищ|дунав|автомобилн|движението|съобщени/i;
      const rows = await allRows<{ eik: string; name: string }>(
        `select distinct awarder_eik eik, awarder_name name
           from contracts
          where tag='contract' and awarder_eik = any($1)`,
        [[...TRANSPORT_SECTOR_EIKS]],
      );
      const offenders = rows
        .filter((r) => !TRANSPORT_NAME.test(r.name))
        .map((r) => `${r.eik} → "${r.name}"`);
      assert.deepEqual(
        offenders,
        [],
        `transport-sector members whose corpus name is not a transport body — a ` +
          `wrong EIK inflates the headline while every other gate stays green:\n  ` +
          offenders.join("\n  "),
      );
    },
  );
});

describe("energy sector (procurement / БЕХ)", () => {
  test.skipIf(skip)(
    "hub headline is procurement and reconciles EXACTLY to the EIK-set",
    async () => {
      const stats = readJson<SectorStats>(
        "data/procurement/derived/sector_stats.json",
      );
      const e = stats["all"]?.energy;
      assert.ok(e, "sector_stats.json['all'].energy must exist");
      assert.equal(e.kind, "eur");
      assert.equal(
        e.basis,
        "procurement",
        "БЕХ is a commercial group whose real spend IS its tender flow — unlike a " +
          "pass-through ministry, it must not be moved onto a budget basis (the МЕ " +
          "policy line is ~€5.9M and is deliberately not in the group at all)",
      );

      // ~€10.22bn at the 2026-08-13 audit, the largest procurement sector on the
      // site. The floor is set below the smallest single-member loss that would
      // matter (dropping ЕСО at €2.22bn lands at ~€8.0bn), so a silent trim fails
      // here rather than reading as ordinary corpus drift.
      assert.ok(
        e.value > 9_000_000_000 && e.value < 16_000_000_000,
        `energy procurement €${e.value} out of expected band 9.0–16.0bn`,
      );

      assert.equal(
        e.value,
        await sectorSum(ENERGY_SECTOR_EIKS),
        "headline ≠ Σ contracts over ENERGY_SECTOR_EIKS — regenerate " +
          "sector_stats.json (npm run db:gen-sector-stats) or reconcile the EIK-set",
      );
    },
  );

  test.skipIf(skip)("every scope reconciles, not just `all`", async () => {
    // The headline gate above pins ONE of the 30 scopes. A window-boundary bug
    // (an off-by-one on a parliament's dissolution date, a year bucket built
    // from the wrong column) leaves `all` exactly right and moves the windows
    // underneath it — which is the shape the audit's scope table was built to
    // rule out, so it is worth keeping ruled out.
    //
    // THREE year windows spanning the corpus — 2019 is the Балкански поток capex
    // spike (€2.06bn, the largest single year), 2020 its trough (€52.7M), 2024 an
    // ordinary year — plus TWO parliament windows, which are the ones that can
    // actually drift: a year bucket is a fixed string prefix, while an ns window is
    // computed from elections.json. That is why the ns bounds come from
    // `parliamentWindow`, the SAME function the generator calls, rather than dates
    // copied into this file — a local copy would agree with itself for ever and
    // never see the dissolution off-by-one this test names as its motivation.
    const stats = readJson<SectorStats>(
      "data/procurement/derived/sector_stats.json",
    );
    const elections = newestFirst(
      readJson<ElectionRef[]>("src/data/json/elections.json"),
    );
    const nsWindow = (name: string): [string, string, string] => {
      const { from, to } = parliamentWindow(elections, name);
      return [`ns:${name}`, from ?? "0000", to ?? "9999"];
    };
    const WINDOWS: Array<[string, string, string]> = [
      ["y:2019", "2019-01-01", "2020-01-01"],
      ["y:2020", "2020-01-01", "2021-01-01"],
      ["y:2024", "2024-01-01", "2025-01-01"],
      nsWindow("2024_10_27"),
      nsWindow("2026_04_19"),
    ];
    for (const [scope, from, to] of WINDOWS) {
      const stat = stats[scope]?.energy;
      assert.ok(stat, `sector_stats.json['${scope}'].energy must exist`);
      // ⚠ `contracts.date` is TEXT, not date — compare as text, the way the
      // generator does (`c.date >= COALESCE($1,'0000')`). ISO-8601 sorts
      // lexicographically so the window is still correct, and a `::date` cast
      // here does not merely fail: it would be comparing a different thing
      // from the code under test.
      const [row] = await allRows<{ eur: string }>(
        `select coalesce(round(sum(amount_eur)),0)::text eur
             from contracts
            where tag='contract' and awarder_eik = any($1)
              and date >= $2 and date < $3`,
        [[...ENERGY_SECTOR_EIKS], from, to],
      );
      assert.equal(
        stat.value,
        Number(row?.eur ?? 0),
        `${scope}: headline €${stat.value} ≠ Σ contracts €${row?.eur} in that window`,
      );
    }
  });

  test.skipIf(skip)("the EIK-set copies stay in lockstep", () => {
    // Mostly the same tripwire shape as water/transport — the browse pack assigns
    // ENERGY_SECTOR_EIKS by reference, so that comparison is an array against
    // ITSELF and passing trivially IS the desired state; it becomes a real
    // comparison the moment a copy hardcodes digits.
    //
    // ⚠ The members check below is NOT that. SECTOR_DASHBOARDS.energy.members is
    // nine hand-written EIK literals (it carries per-member bilingual names and
    // group labels, so it cannot just spread the constant), which makes it the one
    // genuine content assertion in this test — do not prune it as duplicate of the
    // others.
    assert.deepEqual(
      [...SECTOR_BROWSE_PACKS.energy.eiks],
      [...ENERGY_SECTOR_EIKS],
      "SECTOR_BROWSE_PACKS.energy.eiks drifted from ENERGY_SECTOR_EIKS",
    );
    assert.equal(
      SECTOR_DASHBOARDS.energy.leadEik,
      BEH_EIK,
      "the dashboard's lead EIK is no longer the БЕХ holding",
    );

    // ⚠ The one INTENTIONAL divergence in this file. The dashboard rolls up
    // ENERGY_MEMBER_EIKS, which omits the ЕСО МЕР branch code the hub's
    // ENERGY_SECTOR_EIKS carries. Assert the difference is EXACTLY that branch —
    // an unexplained third state (a member dropped from one side, a new EIK added
    // to only one) is the drift this whole test class exists to catch.
    assert.deepEqual(
      SECTOR_DASHBOARDS.energy.members.map((m) => m.eik),
      [...ENERGY_MEMBER_EIKS],
      "SECTOR_DASHBOARDS.energy.members drifted from ENERGY_MEMBER_EIKS",
    );
    const onlyInHub = ENERGY_SECTOR_EIKS.filter(
      (e) => !ENERGY_MEMBER_EIKS.includes(e),
    );
    const onlyInDashboard = ENERGY_MEMBER_EIKS.filter(
      (e) => !ENERGY_SECTOR_EIKS.includes(e),
    );
    assert.deepEqual(
      onlyInHub,
      ["1752013040"],
      "the hub/dashboard difference is no longer just the ЕСО МЕР branch",
    );
    assert.deepEqual(
      onlyInDashboard,
      [],
      "the dashboard carries an EIK the hub headline does not count",
    );

    // The ministry is the group's principal, not a member — folding its ~€5.9M
    // policy line into a generation-and-grid rollup would relabel the sector.
    assert.ok(
      !ENERGY_SECTOR_EIKS.includes(ENERGY_MINISTRY_EIK),
      "Министерство на енергетиката must not be a member of the БЕХ group",
    );
  });

  test.skipIf(skip)(
    "the documented hub/dashboard gap stays immaterial",
    async () => {
      // The collapse above is only defensible while the branch is a rounding
      // error (~€75K against €10.2bn). If ЕСО ever starts awarding through it at
      // scale, the two surfaces would publish visibly different totals for the
      // same group and the omission would need revisiting rather than documenting.
      const gapEiks = ENERGY_SECTOR_EIKS.filter(
        (e) => !ENERGY_MEMBER_EIKS.includes(e),
      );
      // Without this the test is ABSENCE-EQUIVALENT: drop the branch from
      // ENERGY_SECTOR_EIKS entirely and the sum is €0, which sails under the
      // ceiling and reports the gap as healthier than ever. Assert there IS a gap
      // to measure before measuring it.
      assert.deepEqual(
        gapEiks,
        ["1752013040"],
        "there is no longer a hub/dashboard gap to measure — this test has gone " +
          "vacuous; reconcile it with the lockstep test above",
      );
      const gap = await sectorSum(gapEiks);
      assert.ok(
        gap < 1_000_000,
        `the ЕСО branch now awards €${gap} — above the €1M materiality line, so ` +
          `the dashboard's omission of it is no longer safe to treat as documented`,
      );
    },
  );

  // ДП РАО (131218471) — added 2026-08-13. The environment-sector audit found it
  // awarding €47M while belonging to NO sector EIK-set on the site; it is a
  // чл. 62 ал. 3 ТЗ state enterprise (чл. 78 ал. 1 ЗБИЯЕ) whose принципал is the
  // Minister of Energy, so the energy set is its home. Three things can silently
  // undo that, and none is visible to a row count.
  test.skipIf(skip)(
    "ДП РАО stays attributed to energy, and only to energy",
    async () => {
      const RAO = "131218471";

      // 1. BOTH sides, or the two surfaces publish different sector totals. This is
      //    the invariant that made the ЕСО-branch collapse tolerable and would NOT
      //    tolerate a second member: at €47M this is 47x the €1M materiality line
      //    the gap test above enforces, so a member-only or hub-only ДП РАО breaks
      //    that test rather than passing quietly. Asserted here too, because the
      //    failure THERE reads as "the ЕСО branch grew" and would send a reader to
      //    the wrong EIK entirely.
      assert.ok(
        ENERGY_SECTOR_EIKS.includes(RAO),
        "ДП РАО dropped out of ENERGY_SECTOR_EIKS — the hub headline has stopped " +
          "counting a €47M state energy buyer that belongs to no other sector",
      );
      assert.ok(
        ENERGY_MEMBER_EIKS.includes(RAO),
        "ДП РАО dropped out of ENERGY_MEMBER_EIKS — the /sector/energy dashboard " +
          "now under-counts the hub headline by €47M for the same sector",
      );

      // 2. It must NOT reach ENERGY_ALIAS_EIKS. That set is the БЕХ HOLDING fan-out
      //    (it drives the group pack on a subsidiary's /awarder page), and ДП РАО is
      //    not a БЕХ subsidiary — its principal is МЕ directly. Folding it in would
      //    render the БЕХ group pack on the page of a company БЕХ does not own,
      //    which is a false ownership claim rather than a wrong total.
      assert.ok(
        !ENERGY_ALIAS_EIKS.includes(RAO),
        "ДП РАО leaked into ENERGY_ALIAS_EIKS — that is the БЕХ holding set, and " +
          "ДП РАО is under МЕ directly, not a БЕХ subsidiary",
      );

      // 3. Exactly ONE browse pack may claim it. The audit found it in zero; the
      //    opposite failure (two sectors both counting it, e.g. someone reading
      //    „отпадъци" as an environment concern) would double-count it in the hub
      //    grid with every per-sector total still reconciling on its own.
      const claiming = Object.values(SECTOR_BROWSE_PACKS)
        .filter((p) => p.eiks.includes(RAO))
        .map((p) => p.id)
        .sort();
      assert.deepEqual(
        claiming,
        ["energy"],
        `ДП РАО is claimed by ${claiming.length} browse packs (${claiming.join(", ") || "none"}) ` +
          "— it must be attributed to energy and nowhere else",
      );

      // 4. It is a REAL awarder at the size the attribution was argued from. A
      //    wrong-EIK entry (the МВР €370M-into-defense class) sums to ~nothing;
      //    the floor is roughly half the measured €47.06M so corpus growth cannot
      //    trip it. Uses the serving basis, tag='contract'.
      const rao = await sectorSum([RAO]);
      assert.ok(
        rao > 20_000_000,
        `ДП РАО sums to €${rao} on the serving basis — below the €20M floor the ` +
          "energy attribution was argued from; verify the EIK before trusting it",
      );
    },
  );

  test.skipIf(skip)(
    "every money-bearing universe carries real money — and `holding` legitimately does not",
    async () => {
      // Transport's gate, which caught a €348M mode rendered as €3.7M. Floors are
      // roughly half the measured spend, so corpus growth cannot trip them and a
      // universe collapsing to a token member does.
      const FLOORS: Array<[EnergyUniverse, number, string]> = [
        ["gas", 1_500_000_000, "Газ (Булгартрансгаз + Булгаргаз)"],
        ["coal", 1_200_000_000, "Въглища (ТЕЦ + Мини Марица изток)"],
        ["grid", 1_000_000_000, "Електропренос (ЕСО)"],
        ["nuclear", 900_000_000, "Ядрена енергия (АЕЦ Козлодуй)"],
        ["hydro", 200_000_000, "ВЕЦ и търговия (НЕК + ВЕЦ Козлодуй)"],
        ["waste", 20_000_000, "Радиоактивни отпадъци (ДП РАО)"],
      ];

      const rows = await allRows<{ eik: string; eur: string }>(
        `select awarder_eik eik, coalesce(round(sum(amount_eur)),0)::text eur
           from contracts
          where tag='contract' and awarder_eik = any($1)
          group by 1`,
        [[...ENERGY_SECTOR_EIKS]],
      );
      const byUniverse = new Map<string, number>();
      for (const r of rows) {
        const u = energyUniverseOf(r.eik);
        if (u) byUniverse.set(u, (byUniverse.get(u) ?? 0) + Number(r.eur));
      }

      for (const [universe, floor, label] of FLOORS) {
        assert.ok(
          ENERGY_ENTITIES.some((e) => e.universe === universe),
          `universe "${universe}" (${label}) has no entities at all`,
        );
        const eur = byUniverse.get(universe) ?? 0;
        assert.ok(
          eur >= floor,
          `${label} has €${eur}, below the €${floor} floor — a universe has ` +
            `collapsed to a token member, which the hub headline cannot show`,
        );
      }

      // `holding` is the exception and must STAY one: БЕХ is a pure holding that
      // awards no ЗОП of its own. A non-zero here is not a win — it means either a
      // real change at the parent, or a subsidiary's contracts being attributed to
      // it, which would double-count against the subsidiary's own line.
      //
      // Counted in CONTRACTS, not euros, for two independent reasons. „Awards
      // nothing" is a claim about rows: the corpus carries 140 contracts with a
      // NULL amount_eur, so a €-sum of 0 is also what a holding with untotalled
      // contracts looks like. And the whole gate would be absence-equivalent if it
      // only read the aggregate map — remove БЕХ from ENERGY_ENTITIES and
      // `byUniverse.get("holding")` is undefined, which passes. So assert the
      // entity still exists first.
      assert.ok(
        ENERGY_ENTITIES.some(
          (e) => e.eik === BEH_EIK && e.universe === "holding",
        ),
        "БЕХ is no longer the `holding` entity — this gate has gone vacuous",
      );
      const [beh] = await allRows<{ n: string }>(
        `select count(*)::text n from contracts
          where tag='contract' and awarder_eik = $1`,
        [BEH_EIK],
      );
      assert.equal(
        Number(beh?.n ?? 0),
        0,
        `БЕХ (the holding parent) now has ${beh?.n} contracts — verify this is a ` +
          `real change at the parent and not a re-attribution of a subsidiary's ` +
          `spend, which would double-count against that subsidiary's own line`,
      );
    },
  );

  test.skipIf(skip)(
    "the anti-allowlist stays out, and every member is a real awarder",
    async () => {
      // The reference-data header's "explicitly OUT" block, as assertions. These
      // are not hypothetical: every one of them was surfaced by the audit's name
      // sweep over енерг|тец|аец|топлофикац|газ|вец|мини|електро|ядрен, and each
      // was rejected for a stated reason. Admitting any private or municipal body
      // here turns a state-spending total into an industry total.
      const MUST_NOT_BE_MEMBERS: Array<[string, string]> = [
        [
          "130277958",
          "Електроразпределителни мрежи Запад — private ЕРП (€1.74bn)",
        ],
        ["115552190", "ЕВН Електроразпределение — private ЕРП (€1.23bn)"],
        ["104518621", "Електроразпределение Север — private ЕРП (€468M)"],
        ["831609046", "Топлофикация София — MUNICIPAL, not state (€610M)"],
        ["130533432", "Овергаз мрежи — private gas distribution (€186M)"],
        ["130020522", "КонтурГлобал Марица изток 3 — 73% private JV (€175M)"],
        ["201383265", "ICGB — 50/50 JV, awards under its own EIK"],
        ["103551629", "ТЕЦ Варна — privatised (€37.7M)"],
        ["109513731", "ТЕЦ Бобов дол — privatised (€15.9M)"],
        ["115016602", "ЕВН България топлофикация — private heat (€109M)"],
        ["121683785", "Столичен електротранспорт — municipal transport, matched „електро“"], // prettier-ignore
        ["000185872", "ПГ по ядрена енергетика „Курчатов“ — a SCHOOL, matched „ядрен“"], // prettier-ignore
        ["000193250", "Община Козлодуй — the TOWN, matched „козлодуй“"],
        ["130098909", "КЕВР — regulator, not a commercial buyer"],
        ["000697567", "АЯР — regulator, not a commercial buyer"],
        ["121459246", "АУЕР — agency, not a commercial buyer"],
      ];
      for (const [eik, label] of MUST_NOT_BE_MEMBERS)
        assert.ok(
          !ENERGY_SECTOR_EIKS.includes(eik),
          `${label} (${eik}) must not be an energy-sector member`,
        );

      // Every curated EIK resolves to a real awarder — catches a typo that would
      // contribute €0 for ever and never surface in any total.
      //
      // ⚠ БЕХ is exempt, and this is the only such exemption in the file: the
      // holding parent awards nothing (see the universe gate above), so it is
      // legitimately absent from `contracts` while being a correct member of the
      // group. Exempting it BY EIK rather than relaxing the gate keeps the check
      // sharp for the other nine.
      const expectAwarding = ENERGY_SECTOR_EIKS.filter((e) => e !== BEH_EIK);
      const rows = await allRows<{ eik: string }>(
        `select distinct awarder_eik eik from contracts
          where tag='contract' and awarder_eik = any($1)`,
        [[...expectAwarding]],
      );
      const seen = new Set(rows.map((r) => r.eik));
      const missing = expectAwarding
        .filter((e) => !seen.has(e))
        .map((e) => `${e} (${ENERGY_ENTITIES.find((x) => x.eik === e)?.name})`);
      assert.deepEqual(
        missing,
        [],
        `curated energy EIKs with no contracts at all: ${missing.join(", ")}`,
      );
    },
  );

  test.skipIf(skip)(
    "every member LOOKS like an energy body in the corpus, under every spelling",
    async () => {
      // The POSITIVE half. A denylist only catches the wrong bodies somebody
      // already thought of — the defense near-miss was two МВР directorates worth
      // €370M that no denylist named — and a wrong-but-real EIK passes every other
      // gate here, since the test and the generator read the SAME constant.
      //
      // Checked against EVERY distinct awarder_name, not min(): this set carries
      // 157 of them. ЕСО is the reason — its regional МЕР units award under the
      // PARENT EIK under their own names („Мрежови експлоатационен район - русе",
      // „УПРАВЛЕНИЕ МЕР СОФИЯ ОБЛАСТ"), with no „ЕСО" or „енерг" anywhere in the
      // string, so a min(name) check would have passed while 100+ spellings went
      // unexamined. Булгартрансгаз also appears as the typo „Булгартрасгаз",
      // which „газ" still catches.
      //
      // „марица" rather than „мини": „мини" is a substring of „МИНИстерство", so a
      // mining stem would silently accept any ministry that got added by mistake.
      //
      // ⚠ The three-letter stems are BOUNDARY-GUARDED, and that is not tidiness.
      // Bare `аец|тец|вец` are substrings of ordinary Bulgarian place and school
      // names — Община Лясков|ЕЦ|, Прав|ЕЦ|, Медков|ЕЦ|, „О|ТЕЦ| Паисий", „Здрав|ЕЦ|"
      // — all measured in this corpus, i.e. the gate would have waved through
      // exactly the wrong-domain class it exists to catch. Cyrillic lookarounds
      // rather than \b: JS \b is ASCII-only, so it treats every Cyrillic letter as
      // a boundary and would silently do nothing here.
      //
      // Still a check on KIND, not a classifier, and worth being explicit about
      // what it therefore cannot do: „Овергаз", „Община Козлодуй", „Община Марица"
      // and Министерство на енергетиката all MATCH. They are kept out by the
      // anti-allowlist above, which is the layer that owns them — this one exists
      // to catch a member from an entirely different domain (the МВР-into-defense
      // shape), which no denylist can name in advance.
      //
      // „радиоактивн" is ДП РАО, and it is the one member whose energy membership
      // is NOT legible from its name — «Държавно предприятие „Радиоактивни
      // отпадъци"» carries no energy stem at all, because the attribution is by
      // PRINCIPAL (чл. 78 ал. 1 ЗБИЯЕ → министъра на енергетиката), not by what it
      // is called. That is precisely why the reasoning lives in a comment on its
      // entry in energyReferenceData.ts rather than being inferable here: this gate
      // can only confirm the kind is nuclear-adjacent, never that МЕ is its
      // principal. Narrow on purpose — it matches radioactive-waste bodies and
      // nothing else in the corpus, so it cannot wave through a general „отпадъци"
      // (municipal waste) awarder, which would be an МОСВ concern, not an energy one.
      const ENERGY_NAME =
        /електроенерг|електрическ|енергиен|енергетик|марица|козлодуй|газ|есо еад|системен оператор|мрежови експлоатационен|управление\s+мер|радиоактивн|(?<![а-я])(аец|тец|вец)(?![а-я])/i;
      const rows = await allRows<{ eik: string; name: string }>(
        `select distinct awarder_eik eik, awarder_name name
           from contracts
          where tag='contract' and awarder_eik = any($1)`,
        [[...ENERGY_SECTOR_EIKS]],
      );
      const offenders = rows
        .filter((r) => !ENERGY_NAME.test(r.name))
        .map((r) => `${r.eik} → "${r.name}"`);
      assert.deepEqual(
        offenders,
        [],
        `energy-sector members whose corpus name is not an energy body — a wrong ` +
          `EIK inflates the headline while every other gate stays green:\n  ` +
          offenders.join("\n  "),
      );
    },
  );
});

describe("defense sector (budget / МО)", () => {
  // The audit that produced this block (2026-08-19) found the BUYER side clean:
  // the headline reconciles at every scope, all 25 EIKs were real МО bodies, the
  // anti-allowlist held (ДА „Държавен резерв" at €1.365bn and both МВР
  // directorates correctly out), and every bespoke tile summed to its own header.
  // What it found instead was a completeness hole no per-sector gate could see —
  // two МО bodies in NO roster at all — and a heading that miscounted the list
  // beneath it. Both shapes are pinned below.
  //
  // ⚠ Defense is a BUDGET-basis sector, so unlike water/transport/energy above,
  // the EIK-set does NOT feed the headline. That decouples the two halves of this
  // block: an EIK error here is invisible to every € assertion, which is exactly
  // why the roster needs its own gates rather than riding on a reconcile.

  test.skipIf(skip)(
    "hub headline is budget and reconciles to the МО node's enacted expenditure",
    async () => {
      const stats = readJson<SectorStats>(
        "data/procurement/derived/sector_stats.json",
      );
      const node = readJson<{
        nodeId: string;
        years: Array<{
          fiscalYear: number;
          expenditure?: { amountEur?: number | null };
        }>;
      }>(`data/budget/ministries/${MO_BUDGET_NODE}.json`);
      assert.equal(node.nodeId, MO_BUDGET_NODE);

      const byYear = new Map(
        node.years
          .filter((y) => y.expenditure?.amountEur)
          .map((y) => [y.fiscalYear, y.expenditure!.amountEur!]),
      );

      const d = stats["all"]?.defense;
      assert.ok(d, "sector_stats.json['all'].defense must exist");
      assert.equal(d.kind, "eur");
      assert.equal(
        d.basis,
        "budget",
        "МО's own ЗОП flow (~€2.7bn all-time) is a fraction of what it is " +
          "appropriated, and a defense headline must never be a budget FUNCTION " +
          "either — „Отбрана и сигурност“ bundles police, courts and prisons. " +
          "The administrative ПРБ node is the honest figure",
      );

      // Band, not equality: the node gains a year every autumn. The floor sits
      // below FY2024 (€1.089bn, the last pre-rearmament year) so a zeroed or
      // renamed source field fails; the ceiling is well above FY2026's €2.569bn.
      assert.ok(
        d.value > 900_000_000 && d.value < 6_000_000_000,
        `defense budget €${d.value} out of expected band 0.9–6.0bn`,
      );

      // EVERY scope, not just `all` — the same argument the energy block makes.
      // A budget-basis sector resolves its year through annual(), so an
      // off-by-one there leaves `all` right and moves the windows underneath it.
      const bad: string[] = [];
      for (const [scope, sectors] of Object.entries(stats)) {
        const st = sectors.defense;
        if (!st) {
          bad.push(`${scope}: no defense stat emitted`);
          continue;
        }
        if (st.basis !== "budget") {
          bad.push(`${scope}: basis ${st.basis} (expected budget)`);
          continue;
        }
        if (st.year == null || byYear.get(st.year) !== st.value)
          bad.push(
            `${scope}: €${st.value} captioned ${st.year} is not that year's ` +
              `enacted expenditure in ${MO_BUDGET_NODE}.json`,
          );
      }
      assert.deepEqual(
        bad,
        [],
        "a defense scope disagrees with the МО budget node — regenerate " +
          "sector_stats.json (npm run db:gen-sector-stats)",
      );
    },
  );

  test.skipIf(skip)("the EIK-set copies are ONE set", () => {
    // Defense has three copies, not the usual four: it is a bespoke screen, so
    // there is no SECTOR_DASHBOARDS entry, and it is budget-basis, so the
    // generator's SECTOR_EIKS has no defense key either. The browse pack imports
    // the constant, which makes THIS assertion weaker than water's sum-based one
    // — it cannot catch a wrong EIK, only a second hand-maintained list. The
    // wrong-EIK question is the anti-allowlist test below.
    const roster = [...MO_ENTITIES].map((e) => e.eik).sort();
    assert.deepEqual(
      [...DEFENSE_SECTOR_EIKS].sort(),
      roster,
      "DEFENSE_SECTOR_EIKS must be derived from MO_ENTITIES, not restated",
    );
    assert.deepEqual(
      [...SECTOR_BROWSE_PACKS.defense.eiks].sort(),
      roster,
      "SECTOR_BROWSE_PACKS.defense.eiks has drifted from MO_ENTITIES — repoint " +
        "it at DEFENSE_SECTOR_EIKS rather than re-listing digits",
    );
    // One row per EIK. A duplicate would double-count the body in every
    // per-universe rollup while every €-total stayed right.
    assert.equal(
      new Set(roster).size,
      roster.length,
      "duplicate EIK in MO_ENTITIES",
    );
  });

  test.skipIf(skip)(
    "every mo_museum body culture disclaims is claimed HERE",
    () => {
      // THE completeness gate, and the reason it reads a sibling's file.
      //
      // `kulturaReferenceData.ts`'s ADJACENT_EIKS is an ANTI-allowlist: culture
      // lists a body there precisely to say "somebody else is the principal",
      // which excludes it from every culture roll-up and headline. So a
      // `kind: "mo_museum"` entry is culture ASSERTING the body is МО's. If this
      // roster does not then claim it, the body is in no sector at all — and
      // grepping its EIK finds it either way, in a file that looks authoritative.
      //
      // That is exactly what happened: РВИМ Плевен (114102692) and НПМ
      // „Шипка-Бузлуджа" (000804161), €7.43m over 16 contracts, were disclaimed
      // by culture and unclaimed here, with every row count reconciling. Same
      // shape as the 2026-08-18 education audit (НХА/НМА/НАТФИЗ stranded between
      // edu and culture).
      //
      // DERIVED from culture's own map rather than pinning the two known EIKs: a
      // hand-listed pair covers only the bodies somebody already found, while
      // this fails on a FIFTH mo_museum entry until someone decides where it
      // belongs. That is the whole difference between a regression test and a
      // gate.
      const disclaimed = Object.entries(ADJACENT_EIKS)
        .filter(([, v]) => v.kind === "mo_museum")
        .map(([eik]) => eik);

      // Non-vacuity: if the `kind` is ever renamed, the filter silently empties
      // and this test passes over nothing.
      assert.ok(
        disclaimed.length >= 4,
        `expected ≥4 mo_museum entries in culture's ADJACENT_EIKS, found ${disclaimed.length}`,
      );

      const roster = new Set(MO_ENTITIES.map((e) => e.eik));
      const stranded = disclaimed.filter((eik) => !roster.has(eik));
      assert.deepEqual(
        stranded,
        [],
        "culture disclaims these as МО's and MO_ENTITIES does not claim them, " +
          "so they are in NO sector: " +
          stranded.join(", "),
      );
    },
  );

  test.skipIf(skip)(
    "no МО body is ALSO claimed by a culture roll-up",
    async () => {
      // The converse of the test above, and the reason the stranding fix is not
      // a double-count: an ADJACENT entry is excluded from culture's own totals,
      // so a body may sit in exactly one of the two. Both directions have to
      // hold or „the sector procured €X" is wrong somewhere.
      const adjacent = new Set(Object.keys(ADJACENT_EIKS));
      const alsoInCulture = MO_ENTITIES.map((e) => e.eik).filter(
        (eik) =>
          (CULTURE_GROUP_EIKS as readonly string[]).includes(eik) &&
          !adjacent.has(eik),
      );
      assert.deepEqual(
        alsoInCulture,
        [],
        "EIK is in both MO_ENTITIES and a culture roll-up: " +
          alsoInCulture.join(", "),
      );
    },
  );

  test.skipIf(skip)("the anti-allowlist stays out", async () => {
    // The wrong-EIK half. Curating by NAME instead of EIK false-positives hard
    // here — „7-МО Основно училище" matches „МО", the town of Раковски matches
    // the Раковски military academy, and the EIK prefix 1290* is the whole
    // security-services range — so the near-miss that motivated this roster was
    // two МВР directorates worth €370M.
    //
    // Each entry carries its own €, so the assertion also proves the test is not
    // passing because the body is absent from the corpus.
    const FORBIDDEN: Record<string, string> = {
      "129010157": "МВР ДУССД (€301M) — the €370M near-miss",
      "129010698": "МВР ДКИС (€70M) — the other half of it",
      "129009710": "ДАНС — a separate CoM agency",
      "129010090": "ДАТО — a separate CoM agency",
      "831913661":
        "ДА „Държавен резерв и военновременни запаси“ (€1.365bn) — the " +
        "single largest wrong answer available, and the most plausible one",
      "121817309":
        "Военно-апелативна прокуратура — reads as military, belongs to the " +
        "judiciary. The one a name sweep is most likely to admit",
    };
    const roster = new Set(MO_ENTITIES.map((e) => e.eik));
    const admitted = Object.entries(FORBIDDEN)
      .filter(([eik]) => roster.has(eik))
      .map(([eik, why]) => `${eik}: ${why}`);
    assert.deepEqual(admitted, [], admitted.join("\n"));

    // ДА „Държавен резерв" is the one worth measuring rather than merely
    // listing: it is a real, huge, military-sounding awarder, so a future
    // „the roster looks short" edit would land on it first. If it ever stops
    // being large this test has quietly lost its subject.
    const reserve = await sectorSum(["831913661"]);
    assert.ok(
      reserve > 500_000_000,
      `ДА „Държавен резерв“ is only €${reserve} — this gate assumed it was ` +
        "large enough to be a tempting wrong answer; re-check the exclusion",
    );
  });

  test.skipIf(skip)(
    "signature members are real, present awarders",
    async () => {
      // A wrong-but-real EIK passes every structural gate in this block, because
      // the test and the app read the same constant. Money is the independent
      // check: a typo'd digit lands on a body with a different spend, or none.
      const mod = await sectorSum([MOD_EIK]);
      const vma = await sectorSum([VMA_EIK]);
      assert.ok(mod > 500_000_000, `МО central EIK spend €${mod} below floor`);
      assert.ok(vma > 500_000_000, `ВМА spend €${vma} below floor`);

      // ВМА is the segmentation's whole justification — it buys oncology drugs and
      // nursing care, so a whole-group tile that cannot exclude it reads as
      // "the МО buys medicines". Pinned as a SHARE, which is what makes the claim
      // true, rather than as a €, which moves every reload.
      const group = await sectorSum(DEFENSE_SECTOR_EIKS);
      const share = vma / group;
      assert.ok(
        share > 0.25 && share < 0.6,
        `ВМА is ${(share * 100).toFixed(1)}% of the МО group — outside the band ` +
          "the universe filter was designed around (DEFENSE_UNIVERSES)",
      );

      // Both bodies the 2026-08-19 audit added are present and non-trivial. A
      // silent re-trim would look exactly like the state it fixed.
      for (const [eik, floor, name] of [
        ["114102692", 100_000, "РВИМ — Плевен"],
        ["000804161", 1_000_000, "НПМ „Шипка-Бузлуджа“"],
      ] as const) {
        assert.ok(
          MO_ENTITIES.some((e) => e.eik === eik),
          `${name} (${eik}) dropped from MO_ENTITIES — it was stranded in NO sector before the audit`,
        );
        const eur = await sectorSum([eik]);
        assert.ok(eur > floor, `${name} spend €${eur} below floor ${floor}`);
      }
    },
  );

  test.skipIf(skip)("the roster count is never a literal", () => {
    // The heading „Парите: N-те структури на МО" sits directly above the list it
    // counts, and the same number is in the prerendered <meta description> for
    // /awarder/000695324 — an INDEXED page. The literal had already gone stale
    // once (DefenseSearchBox's header said 24 against a 25-row roster) and went
    // stale again at 27, so every surface now derives it.
    const files = [
      "src/screens/defense/DefenseAwardersTile.tsx",
      "src/screens/defense/DefenseSearchBox.tsx",
      "scripts/prerender/institutions.ts",
      "scripts/prerender/routes.ts",
      "scripts/data_map/model.ts",
    ];
    const offenders: string[] = [];
    for (const rel of files) {
      const body = stripComments(
        fs.readFileSync(path.join(ROOT, rel), "utf-8"),
      );
      // Anchored on МО, not on „структури" alone. A bare number matches CPV
      // codes, percentages and years; „N структури" matches the OTHER sectors'
      // roster counts, which are hardcoded too (МВР's „74 структури" in
      // prerender/routes.ts, „75 структури" in data_map/model.ts) but are those
      // sectors' business — a defense gate that fails on them would be failing
      // for the wrong reason and would be deleted by the next person to see it.
      const m = body.match(
        /\d+(?:-те)?\s+(?:структури(?:те)?\s+(?:на\s+)?(?:МО|Министерств)|Ministry of Defence units|МО units)/g,
      );
      if (m) offenders.push(`${rel}: ${m.join(", ")}`);
    }
    assert.deepEqual(
      offenders,
      [],
      "hardcoded МО roster count — derive it from MO_ENTITIES.length:\n" +
        offenders.join("\n"),
    );
  });
});

// ---------------------------------------------------------------------------
// Земеделие (agri) — audit 2026-08-20, docs/plans/agri-sector-audit-v1.md.
//
// The sector's headline is `basis: 'payout'` — CAP money ДФЗ pays to farmers —
// while its ROSTER is the МЗХ family's procurement. Two bases, one page, and the
// gates below exist because each fails in a way no other check here would see:
//
//   * the headline drifting off `agri_payloads`, or `agri` acquiring a
//     SECTOR_EIKS entry, which would silently flip the tile from €1.59bn of
//     payout to €597.0M of procurement with every row count reconciling;
//   * the roster shrinking back toward the single EIK it was (€131.1M, showing
//     €2.9M on the default scope) or growing to swallow the 132 ТПДГС timber
//     enterprises (€911.3M), which would make „Земеделие" a logging sector;
//   * the three EIK-set copies drifting apart;
//   * an agricultural VOCATIONAL SCHOOL or a ССА institute leaking in on a name
//     sweep — both are МОН bodies and both match `%земедел%`.
//
// The anti-allowlist's OTHER half — that every AGRI_EXTERNAL_BODIES row is really
// claimed by the sector it names — lives in src/lib/agriReferenceData.test.ts,
// which needs no Postgres and so runs on every clone.
describe("agri sector (ДФЗ/МЗХ; payout headline, procurement roster)", () => {
  test.skipIf(skip)(
    "hub headline is payout and reconciles to agri_payloads",
    async () => {
      const stats = readJson<SectorStats>(
        "data/procurement/derived/sector_stats.json",
      );
      const a = stats["all"]?.agri;
      assert.ok(a, "no agri stat for the `all` scope");
      assert.equal(a.basis, "payout", "agri headline basis changed");
      assert.equal(a.kind, "eur");

      // The emitted value must BE a published annual payout, not merely near one.
      // `annual()` resolves `all` to the latest year, so the datum is one row of
      // agri_payloads and equality is the right assertion — a band would admit a
      // year-off slip, which is exactly what a stale generator produces.
      const rows = await allRows<{ key: string; eur: string }>(
        `select key, (payload->'headline'->>'totalEur')::text eur
         from agri_payloads
        where kind = 'overview' and key ~ '^[0-9]{4}$'`,
      );
      assert.ok(rows.length >= 5, "agri_payloads has no annual overviews");
      const byYear = new Map(rows.map((r) => [Number(r.key), Number(r.eur)]));
      assert.ok(
        a.year && byYear.has(a.year),
        `agri headline names year ${a.year}, which agri_payloads has no overview for`,
      );
      assert.ok(
        Math.abs(byYear.get(a.year!)! - a.value) < 1,
        `agri headline ${a.value} ≠ agri_payloads[${a.year}] ${byYear.get(a.year!)}`,
      );
      // …and it must be the LATEST published year, not an older one left behind by
      // a generator that ran before the newest payout landed.
      assert.equal(
        a.year,
        Math.max(...byYear.keys()),
        "agri headline is not the latest published CAP year",
      );
    },
  );

  test.skipIf(skip)(
    "agri never joins the generator's procurement EIK-sets",
    () => {
      // THE tripwire for the basis. Adding `agri` to SECTOR_EIKS in
      // gen_procurement/sector_stats.ts would move the tile from „ИЗПЛАТЕНО €1,6
      // млрд." to „ПОРЪЧКИ €597 млн." — a 2.7x drop presented as the same sector's
      // money — and nothing else in this file would notice, because both numbers
      // are individually correct.
      const src = stripComments(
        fs.readFileSync(
          path.join(ROOT, "scripts/db/gen_procurement/sector_stats.ts"),
          "utf-8",
        ),
      );
      const map = src.slice(
        src.indexOf("const SECTOR_EIKS"),
        src.indexOf("};", src.indexOf("const SECTOR_EIKS")),
      );
      assert.ok(
        map.length > 40,
        "could not locate SECTOR_EIKS — update this gate",
      );
      assert.ok(
        !/\bagri\s*:/.test(map),
        "agri joined SECTOR_EIKS — its hub tile would silently switch from payout to procurement",
      );
      // Non-vacuity: the slice really is the map, so a rename cannot pass this.
      assert.ok(
        /\bwater\s*:/.test(map),
        "SECTOR_EIKS slice lost its known members",
      );
    },
  );

  test.skipIf(skip)("the three EIK-set copies stay equal", () => {
    const norm = (xs: readonly string[]) => [...new Set(xs)].sort();
    const canonical = norm(AGRI_SECTOR_EIKS);
    assert.deepEqual(
      norm(SECTOR_DASHBOARDS.agri.members.map((m) => m.eik)),
      canonical,
      "SECTOR_DASHBOARDS.agri.members drifted from AGRI_SECTOR_EIKS",
    );
    assert.deepEqual(
      norm(SECTOR_BROWSE_PACKS.agri.eiks),
      canonical,
      "SECTOR_BROWSE_PACKS.agri.eiks drifted from AGRI_SECTOR_EIKS",
    );
    assert.equal(
      SECTOR_DASHBOARDS.agri.leadEik,
      AGRI_LEAD_EIK,
      "the agri lead is no longer ДФЗ",
    );
    // No duplicates — the judiciary pack shipped two, invisible behind an IN filter.
    assert.equal(
      canonical.length,
      AGRI_SECTOR_EIKS.length,
      "duplicate agri EIK",
    );

    // ⚠ THE EQUALITIES ABOVE CANNOT FAIL TODAY, and that is worth stating rather
    // than pretending otherwise: `SECTOR_BROWSE_PACKS.agri.eiks` IS
    // `AGRI_SECTOR_EIKS` (same object), and the members array is mapped from the
    // same source. They are a tripwire for a FUTURE hardcode, and `energy` is the
    // live proof that hardcoding happens — SECTOR_DASHBOARDS.energy.members
    // restates nine EIK literals instead of mapping its roster, so a roster edit
    // there does not propagate. What can fail today is the source scan: neither
    // consuming site may contain an EIK literal in its agri entry.
    for (const rel of [
      "src/screens/sector/sectorDashboards.ts",
      "src/screens/components/procurement/sectorPacks.tsx",
    ]) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf-8"));
      const i = src.indexOf("agri: {");
      assert.ok(i > 0, `${rel}: no agri entry found — update this gate`);
      const entry = src.slice(i, src.indexOf("\n  },", i));
      const literals = entry.match(/["']\d{9,13}["']/g) ?? [];
      assert.deepEqual(
        literals,
        [],
        `${rel}: agri entry hardcodes EIK literals instead of importing AGRI_SECTOR_EIKS — ${literals.join(", ")}`,
      );
    }
  });

  test.skipIf(skip)(
    "the roster's money stays in band, and every member is real",
    async () => {
      const total = await sectorSum(AGRI_SECTOR_EIKS);
      // Measured 2026-08-20: €596,988,935 over 3,885 contracts across 66 EIKs.
      // FLOOR catches a trim back toward the single-EIK roster (€131.1M) — the state
      // this audit found. CEILING catches the 132 ТПДГС/ТПДЛС timber enterprises
      // (€911.3M) being folded in, which is a sector-boundary decision and not a
      // curation edit; see agriReferenceData.ts's header.
      assert.ok(
        total > 450_000_000 && total < 800_000_000,
        `agri roster € out of band: ${total}`,
      );

      // Every member must actually be an awarder. A typo'd EIK contributes €0 and is
      // invisible in the total, but puts a dead chip on the awarders tile.
      const rows = await allRows<{ eik: string }>(
        `select distinct awarder_eik eik from contracts
        where tag='contract' and awarder_eik = any($1)`,
        [[...AGRI_SECTOR_EIKS]],
      );
      const live = new Set(rows.map((r) => r.eik));
      assert.deepEqual(
        AGRI_SECTOR_EIKS.filter((e) => !live.has(e)),
        [],
        "agri member EIKs with no contracts at all",
      );
    },
  );

  test.skipIf(skip)(
    "the signature members carry the money they should",
    async () => {
      // БАБХ is the sector's largest buyer and МЗХ its principal; both were in NO
      // sector before this audit. Pinning them by EIK — never by name — is what
      // makes a silent removal fail.
      for (const [eik, name, floor] of [
        ["176040023", "БАБХ", 150_000_000],
        ["831909905", "МЗХ", 80_000_000],
        ["121486802", "ИА по горите", 5_000_000],
      ] as const) {
        assert.ok(
          AGRI_SECTOR_EIKS.includes(eik),
          `${name} ${eik} left the roster`,
        );
        const eur = await sectorSum([eik]);
        assert.ok(eur > floor, `${name} ${eik} holds only ${eur}`);
      }
    },
  );

  test.skipIf(skip)("no agricultural school or ССА institute leaks in", () => {
    // The `%земедел%` sweep that finds this roster also returns ~15 „Професионална
    // гимназия по земеделие" (МОН/municipal) and every ССА institute (edu). Each is
    // the `7-МО Основно училище` error from the defense audit, in the same shape.
    const banned: Array<[string, string]> = [
      ["000847248", 'ПГ по земеделие „Тодор Рачински"'],
      ["000183295", 'ПГ по земеделие „Стефан Цанов" — Кнежа'],
      ["000014128", 'ЗПГ „Климент Аркадиевич Тимирязев"'],
      ["000559000", 'ПЗГ „Добруджа"'],
      ["000840410", "Добруджански земеделски институт (ССА → edu)"],
      ["123650307", "Земеделски институт Стара Загора (ССА → edu)"],
      ["000455440", "УХТ Пловдив (edu)"],
      ["831160078", "Напоителни системи (water)"],
    ];
    const set = new Set(AGRI_SECTOR_EIKS);
    assert.deepEqual(
      banned.filter(([e]) => set.has(e)).map(([e, n]) => `${e} (${n})`),
      [],
      "a non-МЗХ body leaked into the agri roster",
    );
    // …and the externals this roster DISCLAIMS must stay out of it, which is the
    // half agriReferenceData.test.ts checks from the other side.
    assert.deepEqual(
      AGRI_EXTERNAL_BODIES.filter((e) => set.has(e.eik)).map((e) => e.eik),
      [],
      "an AGRI_EXTERNAL_BODIES row is also a roster member",
    );
  });

  test.skipIf(skip)(
    "the footnote counts INSTITUTIONS, not awarder records",
    () => {
      // „Възложители 66 … от 65 в сектора" rendered live: an EIK count over a body
      // count. The two differ by the succeeded-body rows.
      //
      // ⚠ An arithmetic restatement of that (`BODY_COUNT === EIKS.length −
      // succeeded`) is VACUOUS — it is true of every possible roster, which a
      // 19,211-case fuzz confirmed. The defect was in the PROSE, so the gate has to
      // read the prose: the footnote must open on the institution count and must not
      // call it „възложителя", the noun reserved for EIKs.
      const succeeded = AGRI_ENTITIES.filter((e) => e.succeededBy).length;
      assert.ok(
        succeeded > 0,
        "no succeeded body — the two counts now coincide",
      );
      assert.ok(AGRI_BODY_COUNT < AGRI_SECTOR_EIKS.length);
      for (const bgLang of [true, false]) {
        const f = agriFootnote(bgLang);
        const noun = bgLang ? "институции" : "institutions";
        assert.ok(
          f.startsWith(`${AGRI_BODY_COUNT} ${noun}`),
          `footnote (${bgLang ? "bg" : "en"}) does not open on the institution count: ${f.slice(0, 60)}`,
        );
        assert.ok(
          !f.includes(`${AGRI_BODY_COUNT} възложителя`),
          "footnote calls the institution count „възложителя“ — that noun means an EIK",
        );
      }
    },
  );

  test.skipIf(skip)(
    "no state forestry ENTERPRISE is in the roster",
    async () => {
      // The six чл. 163 ЗГ държавни предприятия and their териториални поделения
      // (държавни горски / ловни стопанства) are МЗХ bodies and are deliberately
      // excluded — commercial timber undertakings, not administration.
      //
      // ⚠ THIS ASSERTS MEMBERSHIP, NOT SIZE, AND THAT IS THE FINDING. Four attempts
      // to delimit the family BY NAME produced four different totals, each wrong in
      // a new way:
      //   `'%държавно предприятие%' AND '%дп%дп%'`      → €911.3M — sweeps in ДП
      //      „Пристанищна инфраструктура" (transport), ДП РВД, ДП „Радиоактивни
      //      отпадъци" (energy) and Българския спортен тотализатор.
      //   `'%държавно горско стопанство%'` alone        → €146.1M — undercounts,
      //      because a parent ДП and its ТП share a Булстат and file under both names.
      //   the same folded to EIKs                        → €622.8M — pulls in
      //      Лесотехнически университет's whole €23.5M (it files rows as „Учебно-
      //      опитно горско стопанство") plus six ПГ по горско стопанство. The
      //      university is a member of educationReferenceData.ts, so the figure
      //      double-books another sector's roster.
      //   adding `териториално поделение`                → €992.2M — that phrase is
      //      generic; ДП „Пристанищна инфраструктура" uses it too.
      // Two of those four figures reached committed files before this gate was
      // written. So no total is asserted here and none is quoted in the reference
      // data: the exclusion rests on the KIND of body, which is checkable, rather
      // than on a magnitude, which by name is not. What IS precise is the question
      // this gate asks — does any of the 66 KNOWN roster EIKs file under a forestry-
      // enterprise name? That is a membership test over a closed set.
      const leaked = await allRows<{ eik: string; name: string }>(
        `select distinct awarder_eik eik, min(awarder_name) name from contracts
          where tag='contract' and awarder_eik = any($1)
            and (awarder_name ~* '(тпдгс|тпдлс)'
              or awarder_name ~* 'държавно (горско|ловно) стопанство'
              or awarder_name ~* '(северно|южно|северо|юго)(западно|източно|централно) държавно предприятие')
          group by 1`,
        [[...AGRI_SECTOR_EIKS]],
      );
      assert.deepEqual(
        leaked.map((x) => `${x.eik} (${x.name})`),
        [],
        "a state forestry enterprise entered the agri roster",
      );
      // Non-vacuity: the pattern must still match SOMETHING in the corpus, or this
      // gate silently stops asking its question.
      const [any] = await allRows<{ n: string }>(
        `select count(distinct awarder_eik)::text n from contracts
          where tag='contract'
            and (awarder_name ~* '(тпдгс|тпдлс)'
              or awarder_name ~* 'държавно (горско|ловно) стопанство')`,
      );
      assert.ok(
        Number(any?.n ?? 0) > 50,
        `the forestry-enterprise pattern now matches ${any?.n} EIKs — it has gone stale`,
      );
    },
  );

  test.skipIf(skip)("every universe keeps a floor of members", () => {
    // ⚠ A TOTAL-ONLY BAND CANNOT SEE A UNIVERSE DISAPPEARING. Deleting the audit's
    // own headline finding — the 16 РДГ and 11 nature parks recovered from no
    // sector at all — leaves €531.9M, comfortably inside the >€450M floor, with
    // ИАГ still present to satisfy the signature-member check. Nothing else here
    // would fail. Per-universe floors are what make that visible; transport and
    // energy carry the same shape.
    const n = (u: string) =>
      AGRI_ENTITIES.filter((e) => e.universe === u).length;
    const FLOORS: Record<string, number> = {
      ministry: 1,
      paying_agency: 1,
      food_safety: 4,
      agency: 7,
      state_enterprise: 1,
      forestry: 17, // ИАГ + 16 РДГ
      nature_park: 11,
      regional_odbh: 16,
      regional_odz: 8,
    };
    const short = Object.entries(FLOORS)
      .filter(([u, min]) => n(u) < min)
      .map(([u, min]) => `${u}: ${n(u)} < ${min}`);
    assert.deepEqual(short, [], "a universe lost members");
    // …and every declared universe must be in this table, so a new one cannot be
    // added without a floor — which is how a universe joins with no gate at all.
    const declared = [...new Set(AGRI_ENTITIES.map((e) => e.universe))].sort();
    assert.deepEqual(
      declared,
      Object.keys(FLOORS).sort(),
      "a universe is missing from the floor table",
    );
  });
});
