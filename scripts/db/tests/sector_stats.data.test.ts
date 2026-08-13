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
