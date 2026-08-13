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
//  · HEALTH (audit 2026-07-23) — a single-member PAYOUT sector. The tripwires:
//     - the hub headline stays basis='payout' and in a €-band around the НЗОК
//       cash-execution latest full year (catches a basis flip, a zeroed/renamed
//       source field, or a re-conversion-to-BGN that would ~halve the number);
//     - the headline reconciles to nzok/execution_history.json's latest month-12
//       point (the declared source of truth);
//     - the four EIK-set copies collapse to the single НЗОК EIK 121858220 and
//       stay equal (dashboard members ↔ browse pack ↔ NZOK_EIK constant), and
//       health is NOT a procurement-basis sector;
//     - НЗОК 121858220 is a real, signature awarder in the corpus (its own thin
//       ЗОП line) — proves the EIK isn't a typo while staying far below payout.
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
import { NZOK_EIK } from "@/lib/nzokBenchmarks";
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
  ENERGY_SECTOR_EIKS,
  ENERGY_MEMBER_EIKS,
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
};
type SectorStats = Record<string, Record<string, SectorStat>>;
type NzokHistory = {
  points: Array<{
    year: number;
    month: number;
    expenditureEur: number;
    backfilled?: boolean;
  }>;
};

describe("health sector (payout / НЗОК)", () => {
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
    "four EIK-set copies collapse to the single НЗОК EIK",
    () => {
      const expected = ["121858220"];
      assert.deepEqual([NZOK_EIK], expected, "NZOK_EIK constant drifted");
      assert.deepEqual(
        SECTOR_DASHBOARDS.health.members.map((m) => m.eik),
        expected,
        "SECTOR_DASHBOARDS.health.members drifted from the single НЗОК EIK",
      );
      assert.equal(SECTOR_DASHBOARDS.health.leadEik, NZOK_EIK);
      assert.deepEqual(
        SECTOR_BROWSE_PACKS.nzok.eiks,
        expected,
        "SECTOR_BROWSE_PACKS.nzok.eiks drifted from the single НЗОК EIK",
      );

      // Health is payout-basis: it must NOT be emitted as a procurement sector
      // (a procurement headline would understate НЗОК ~56×).
      const stats = readJson<SectorStats>(
        "data/procurement/derived/sector_stats.json",
      );
      assert.equal(stats["all"].health.basis, "payout");
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
});

// ─────────────────────────────────────────────────────────────────────────────

/** Σ amount_eur over an EIK-set, whole corpus — the `all` scope's definition. */
const sectorSum = async (eiks: readonly string[]): Promise<number> => {
  const [r] = await allRows<{ eur: string }>(
    `select coalesce(round(sum(amount_eur)),0)::text eur
       from contracts
      where tag='contract' and awarder_eik = any($1)`,
    [[...eiks]],
  );
  return Number(r?.eur ?? 0);
};

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
      const ENERGY_NAME =
        /електроенерг|електрическ|енергиен|енергетик|марица|козлодуй|газ|есо еад|системен оператор|мрежови експлоатационен|управление\s+мер|(?<![а-я])(аец|тец|вец)(?![а-я])/i;
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
