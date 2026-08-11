// The declared-stakes vs Commerce Registry cross-check (person-enrichment-v1, final step).
// Report: `npm run person:declared-vs-registry`.
//
// WHAT THESE PIN. The report names people whose own declaration omits a company the registry
// places on them — an accusation-shaped output, so what matters is not that it FINDS things
// but that each thing it finds has survived four filters. Every one of those filters fails
// SILENTLY if it breaks: the report simply gets longer, and reads more impressive.
//
//   1. the person filed an ANNUAL stakes table for that year — an Entry/Vacate filing is a
//      snapshot at a moment, not a statement about the year around it;
//   2. EVERY stake row on that filing resolved to an EIK — an unresolved row could be the
//      company being reported as missing, so a partial resolution voids the person-year;
//   3. only SHAREHOLDER registry roles count (a manager holds nothing to declare);
//   4. the holding overlapped that fiscal year.
//
// Auto-skips when Postgres is down or the person layer has never been resolved. The probe is
// TOP-LEVEL and feeds test.skipIf (docs/testing-standards.md) — an early `return` inside a
// body scores as a PASS and would report this gate green while asserting nothing.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_stake_company",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / declaration_stake_company empty";

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "a declared stake resolves only when the registry independently agrees",
  async () => {
    // Gate B of 096, restated as an assertion: every resolved stake must have the same
    // person placed at that EIK by the registry. Without it the report's denominator would
    // include name-only guesses and its numerator would be false accusations.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n
         FROM declaration_stake_company sc
         JOIN person p ON p.person_id = sc.person_id
        WHERE NOT EXISTS (SELECT 1 FROM tr_person_roles t
                           WHERE t.uic = sc.uic AND t.name_fold = p.name_fold)
          AND NOT EXISTS (SELECT 1 FROM tr_officers o
                           WHERE o.uic = sc.uic AND o.name_fold = p.name_fold)`,
    );
    assert.equal(
      Number(r.n),
      0,
      `${r.n} resolved stakes the registry does not corroborate`,
    );
  },
);

test.skipIf(skip)(
  "most person-years are UNUSABLE, and the report must keep saying so",
  async () => {
    // The honest headline. Only person-years where every declared stake resolved can support
    // a "missing" claim, and that is a small minority — measured 178 of 2,389. If this ratio
    // ever inverted without the resolution rate improving, the filter would have broken open
    // and the report would be listing unresolved names as concealed ones.
    //
    // Computed on the SAME annual basis as the script. On a wider one this gate would pass
    // while the script's own coverage line moved, which is the drift it exists to catch.
    const [r] = await allRows<{ filed: string; clean: string }>(
      `WITH filed AS (
         SELECT d.person_id, d.fiscal_year fy, count(*) n
           FROM declaration d JOIN declaration_stake s USING (declaration_id)
          WHERE d.person_id IS NOT NULL AND s.company_name IS NOT NULL
            AND d.declaration_type = 'Annualy' AND d.fiscal_year IS NOT NULL
          GROUP BY 1, 2),
       resolved AS (
         SELECT sc.person_id, d.fiscal_year fy, count(*) n
           FROM declaration_stake_company sc JOIN declaration d USING (declaration_id)
          WHERE d.declaration_type = 'Annualy' AND d.fiscal_year IS NOT NULL
          GROUP BY 1, 2)
       SELECT count(*)::text filed,
              count(*) FILTER (WHERE COALESCE(r.n, 0) = f.n)::text clean
         FROM filed f LEFT JOIN resolved r ON r.person_id = f.person_id AND r.fy = f.fy`,
    );
    assert.ok(
      Number(r.filed) > 1000,
      `only ${r.filed} person-years with a stakes table`,
    );
    assert.ok(
      Number(r.clean) > 0 && Number(r.clean) < Number(r.filed),
      `usable person-years (${r.clean}) must be a proper subset of ${r.filed} — ` +
        `all of them would mean the every-row-resolved filter stopped filtering`,
    );
  },
);

// The two rules below are asserted against the SCRIPT'S OWN TEXT, because both live in a
// SQL string where nothing else can see them. Re-stating the rule in the test instead —
// which the first draft did — produces a gate that passes whatever the script does.
const SCRIPT = readFileSync(
  join(__dirname, "..", "..", "person", "declared_vs_registry.ts"),
  "utf-8",
);

test("the registry side filters to shareholder roles only, never managers", () => {
  // A manager holds no stake, so чл.37 gives them nothing to declare; including them would
  // manufacture findings out of every board seat.
  assert.match(SCRIPT, /role IN \('partner', 'sole_owner'\)/);
  assert.ok(
    !/role IN \([^)]*'manager'/.test(SCRIPT),
    "a manager role reached the shareholder filter",
  );
});

test("the declared side is restricted to ANNUAL filings", () => {
  // The regression that produced provable false accusations: an Entry/Vacate filing is a
  // snapshot at a moment, not a statement about the year around it. Comparing a year's
  // holdings against one reported a stake acquired 2025-12-11 as missing from a filing made
  // 2025-02-13. Both the row query and the coverage figures must carry the restriction, or
  // the report states a fraction its rows are not drawn from.
  const occurrences = SCRIPT.match(/declaration_type = 'Annualy'/g) ?? [];
  assert.ok(
    occurrences.length >= 4,
    `expected the Annualy restriction on both CTEs of both queries, found ${occurrences.length}`,
  );
  assert.ok(
    !/COALESCE\(d\.fiscal_year, d\.declaration_year\)/.test(SCRIPT),
    "the COALESCE year is 096's rule for ATTRIBUTING a stake; inverted here it re-admits " +
      "point-in-time filings as year statements",
  );
});

test.skipIf(skip)(
  "no reported person-year rests on a non-annual filing",
  async () => {
    // The same rule, checked against the data rather than the source: every usable
    // person-year must have an actual Annualy filing behind it.
    const [r] = await allRows<{ n: string }>(
      `WITH filed AS (
         SELECT d.person_id, d.fiscal_year fy
           FROM declaration d JOIN declaration_stake s USING (declaration_id)
          WHERE d.person_id IS NOT NULL AND s.company_name IS NOT NULL
            AND d.declaration_type = 'Annualy' AND d.fiscal_year IS NOT NULL
          GROUP BY 1, 2)
       SELECT count(*) n FROM filed f
        WHERE NOT EXISTS (
          SELECT 1 FROM declaration d
           WHERE d.person_id = f.person_id AND d.fiscal_year = f.fy
             AND d.declaration_type = 'Annualy')`,
    );
    assert.equal(
      Number(r.n),
      0,
      `${r.n} usable person-years have no annual filing`,
    );
  },
);
