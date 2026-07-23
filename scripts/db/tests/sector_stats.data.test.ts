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

import { test, describe, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import { NZOK_EIK } from "@/lib/nzokBenchmarks";

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
