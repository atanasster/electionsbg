// Invariants of the COMMITTED municipal-transfer artifacts — the files that
// actually ship, as opposed to the two-row synthetic fixtures the parser tests
// use. Everything here is arithmetic over `data/budget/municipal_transfers/`,
// so it needs no network and no database.
//
// It exists because the envelope fix's whole point is a relationship BETWEEN
// files — `index.json`'s headline against `totals.json`'s five rows, and each
// category against its municipality's total — and a regeneration can break that
// relationship without any single file looking wrong. The original bug was
// exactly that shape: every file self-consistent, the AI tool printing a total
// smaller than the rows beneath it.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { TRANSFER_TYPES } from "./municipal_transfers";
import type {
  MunicipalTransfersByOblastFile,
  MunicipalTransfersIndexFile,
  MunicipalTransfersOblastShard,
  MunicipalTransfersTotalsFile,
} from "../../src/data/budget/types";

const DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/budget/municipal_transfers",
);

const read = <T>(...p: string[]): T =>
  JSON.parse(fs.readFileSync(path.join(DIR, ...p), "utf8")) as T;

const index = read<MunicipalTransfersIndexFile>("index.json");
const years = index.years.map((y) => y.fiscalYear);
const shards = fs
  .readdirSync(path.join(DIR, "oblasts"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => read<MunicipalTransfersOblastShard>("oblasts", f));

// Both sides convert from leva independently, so a few euro of rounding is
// arithmetic rather than disagreement — same bound the parser's canary uses.
const RECONCILE_TOLERANCE_EUR = 10;

// Per-row, the same story one level down: `total` is ONE conversion of the
// combined leva amount, while the five categories are converted separately, so
// their EUR sum can miss by a euro or two (measured max: 2, on 2,385 rows).
// In the source currency there is no rounding at all — every cell is a whole
// number of leva/euro — so `amount` holds the identity EXACTLY, and that is
// where the invariant is worth pinning hard. FY2026 needs no conversion, so it
// is exact on both.
const ROW_TOLERANCE_EUR = 3;

describe("the committed municipal-transfer artifacts", () => {
  it("covers every year the index lists", () => {
    expect(years.length).toBeGreaterThanOrEqual(9);
    for (const y of years) {
      expect(fs.existsSync(path.join(DIR, String(y), "totals.json"))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(DIR, String(y), "by_oblast.json"))).toBe(
        true,
      );
    }
  });

  it("lists every year that has artifacts on disk", () => {
    // The other direction, and the one a swallowed parse failure breaks: a year
    // dropping out of the index while its files stay behind is invisible to a
    // row count, and the UI's "latest year in the index" fallback then rolls
    // the whole site back a year with a label that reads as deliberate.
    const onDisk = fs
      .readdirSync(DIR)
      .filter((n) => /^\d{4}$/.test(n))
      .map(Number)
      .sort((a, b) => a - b);
    expect(onDisk).toEqual([...years].sort((a, b) => a - b));
  });

  it("has total == the sum of the five categories on every municipality-year", () => {
    let checked = 0;
    for (const shard of shards) {
      for (const y of shard.years) {
        for (const m of y.municipalities) {
          const where = `${shard.oblastCode}/${y.fiscalYear}/${m.nameBg}`;
          // Exact in the source currency — no rounding happens there.
          const sumAmount = TRANSFER_TYPES.reduce(
            (s, k) => s + (m[k]?.amount ?? 0),
            0,
          );
          expect({ where, sum: sumAmount }).toEqual({
            where,
            sum: m.total?.amount ?? 0,
          });
          // And within the per-conversion rounding budget in EUR, which is what
          // the tiles actually render.
          const sumEur = TRANSFER_TYPES.reduce(
            (s, k) => s + (m[k]?.amountEur ?? 0),
            0,
          );
          expect({
            where,
            ok:
              Math.abs(sumEur - (m.total?.amountEur ?? 0)) <= ROW_TOLERANCE_EUR,
          }).toEqual({ where, ok: true });
          checked++;
        }
      }
    }
    // Guard against the loop silently checking nothing.
    expect(checked).toBeGreaterThan(2000);
  });

  it("reconciles each year's envelope to the lead paragraph", () => {
    for (const year of years) {
      const f = read<MunicipalTransfersTotalsFile>(String(year), "totals.json");
      const lead = TRANSFER_TYPES.reduce(
        (s, k) => s + (f.totals[k]?.amountEur ?? 0),
        0,
      );
      expect({
        year,
        ok:
          Math.abs(f.rowSum.total.amountEur - lead) <= RECONCILE_TOLERANCE_EUR,
      }).toEqual({ year, ok: true });
    }
  });

  it("keeps index.json's grandTotalEur equal to the year's envelope", () => {
    // The pairing that produced the original "total < sum of rows" bug: the AI
    // tool prints this headline next to the five rows from totals.json.
    for (const row of index.years) {
      const f = read<MunicipalTransfersTotalsFile>(
        String(row.fiscalYear),
        "totals.json",
      );
      expect({ year: row.fiscalYear, total: row.grandTotalEur }).toEqual({
        year: row.fiscalYear,
        total: f.rowSum.total.amountEur,
      });
    }
  });

  it("keeps total >= basic, with the gap being exactly otherTargeted", () => {
    for (const year of years) {
      const f = read<MunicipalTransfersTotalsFile>(String(year), "totals.json");
      expect({
        year,
        gap: f.rowSum.total.amountEur - f.rowSum.basic.amountEur,
      }).toEqual({ year, gap: f.rowSum.otherTargeted.amountEur });
    }
  });

  it("has by_oblast rows summing to the year's national envelope", () => {
    for (const year of years) {
      const f = read<MunicipalTransfersTotalsFile>(String(year), "totals.json");
      const o = read<MunicipalTransfersByOblastFile>(
        String(year),
        "by_oblast.json",
      );
      const summed = o.oblasts.reduce((s, r) => s + r.total.amountEur, 0);
      expect({
        year,
        ok: Math.abs(summed - f.rowSum.total.amountEur) <= o.oblasts.length,
      }).toEqual({ year, ok: true });
    }
  });
});
