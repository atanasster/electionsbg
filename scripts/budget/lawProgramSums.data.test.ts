// Corpus guard for the programme-table leaf filter (law_html.ts →
// parseProgramTable). The unit fixtures beside this file pin the SHAPES; this
// pins the invariant over the real laws, in BOTH directions:
//
//   Σ(programmes) ≈ section II (РАЗХОДИ), per spending unit, per year.
//
// Both directions matter and they fail differently. Emitting a grouping
// subtotal beside its children OVER-counts — measured 2026-08-13 before the
// filter, 53 unit-years over, МОСВ +25.1%, ДА „Държавен резерв“ +100.0%, and it
// reached `/budget/ministry/<node>` and `budget_program_fact`. Dropping a
// subtotal whose children are only a PARTIAL „в т.ч." breakdown would
// UNDER-count instead, and the filter accepts that risk by design (it does not
// require a parent to equal the sum of its children). Neither occurs today —
// worst residual drift across the corpus is €2, pure integer rounding in
// cellToMoney — but nothing else keeps it that way: the next law year is
// whatever shape ДВ publishes, and the fixtures cannot see it.
//
// `raw_data/budget/` is GITIGNORED, so this follows the repo's skip-when-absent
// data-test convention rather than failing on a fresh clone.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, it, expect } from "vitest";
import { parseLawHtml } from "./law_html";

const CACHE_DIR = path.resolve(__dirname, "../../raw_data/budget");

const lawFiles = (): string[] =>
  fs.existsSync(CACHE_DIR)
    ? fs
        .readdirSync(CACHE_DIR)
        .filter((f) => /^law-.*\.html\.gz$/.test(f))
        .sort()
    : [];

/** The fiscal year the document is FOR. Cached files are named either
 *  `law-<year>` or `law-<ДВ id>`, so read it out of the text instead. The ДВ
 *  HTML separates words with NBSP (U+00A0), so collapse those first — the same
 *  normalisation law_html.ts does before running its own marker regexes. */
const fiscalYearOf = (html: string): number =>
  Number(
    /Закон за държавния бюджет[^]{0,120}?за\s+(20\d\d)\s*г/.exec(
      html.replace(/\u00A0/g, " "),
    )?.[1] ?? 0,
  );

const files = lawFiles();

describe("law programme sums reconcile to section II", () => {
  (files.length === 0 ? it.skip : it)(
    "no unit-year over- or under-states its РАЗХОДИ total",
    () => {
      // €2 of integer rounding on a ~€78m unit is ~2.5e-8, so 0.5% is a
      // materiality tolerance with four orders of magnitude of headroom — it
      // catches a re-introduced subtotal (the smallest real one was +16.2%)
      // without tripping on rounding.
      const TOLERANCE = 0.005;
      const offenders: string[] = [];
      let checked = 0;

      for (const f of files) {
        const html = zlib
          .gunzipSync(fs.readFileSync(path.join(CACHE_DIR, f)))
          .toString("utf8");
        const year = fiscalYearOf(html);
        if (!year) continue;
        for (const unit of parseLawHtml(html, year).units) {
          if (unit.programs.length === 0) continue;
          const total = unit.sections.find((s) => s.code === "II")?.amount
            ?.amountEur;
          if (!total) continue;
          checked++;
          const sum = unit.programs.reduce(
            (a, p) => a + (p.amount?.amountEur ?? 0),
            0,
          );
          const drift = (sum - total) / total;
          if (Math.abs(drift) > TOLERANCE)
            offenders.push(
              `${year} ${unit.unitName}: Σ${sum} vs II ${total} (${(drift * 100).toFixed(1)}%)`,
            );
        }
      }

      // A cache holding only non-law documents would make the assertion below
      // vacuously true, so require the corpus actually produced work.
      expect(checked).toBeGreaterThan(50);
      expect(offenders).toEqual([]);
    },
  );

  (files.length === 0 ? it.skip : it)(
    "an aliased leaf never carries its own name, and no alias is shared between leaves",
    () => {
      // The alias exists so an отчет reporting at the grouping level still
      // resolves (execution_facts.ts → findProgramNode). Two leaves answering
      // to one name would make that match ambiguous — findProgramNode returns
      // the FIRST hit, so the отчет's money would land on an arbitrary one.
      for (const f of files) {
        const html = zlib
          .gunzipSync(fs.readFileSync(path.join(CACHE_DIR, f)))
          .toString("utf8");
        const year = fiscalYearOf(html);
        if (!year) continue;
        for (const unit of parseLawHtml(html, year).units) {
          const seen = new Map<string, string>();
          for (const p of unit.programs) {
            for (const alias of p.aliases ?? []) {
              expect(alias, `${year} ${unit.unitName}`).not.toBe(p.nameBg);
              expect(
                seen.get(alias),
                `${year} ${unit.unitName}: "${alias}" aliases both "${seen.get(alias)}" and "${p.nameBg}"`,
              ).toBeUndefined();
              seen.set(alias, p.nameBg);
            }
          }
        }
      }
    },
  );
});
