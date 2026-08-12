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

// GATE B IS NOT ASSERTED HERE, and the previous attempt is worth recording because it looked
// like the file's most important test and could not fail.
//
// It counted own-arm rows for which the registry does not place `p.name_fold` at `sc.uic`,
// and asserted 0. But 096 sets `confirm_fold = p.name_fold` exactly when the row is own-arm,
// and gate B already requires a footprint at `confirm_fold` — so the predicate is
// unsatisfiable by construction, not by correctness. It is not inert, either: the same
// predicate flags 323 rows on the family arm the test excludes. That is precisely the
// anti-pattern stake_procurement.data.test.ts's header forbids ("A test that ... repeats the
// matview's WHERE clause is not a test"), and the trap it records as having hidden four live
// defects. Gate B's real coverage lives there, in "each published EIK is the only candidate
// the declared holder is registered at", which rebuilds the footprint from raw
// tr_person_roles / tr_officers rows in TypeScript.

test.skipIf(skip)(
  "most person-years are UNUSABLE, and the report must keep saying so",
  async () => {
    // The honest headline. Only person-years where every declared stake resolved can support
    // a "missing" claim, and that is a small minority — measured 283 of 1,528 (2026-08-12).
    // If this ratio ever inverted without the resolution rate improving, the filter would
    // have broken open and the report would be listing unresolved names as concealed ones.
    //
    // Computed on the SAME basis as the script — annual filings AND the declarant's own
    // stakes. On a wider one this gate would pass while the script's own coverage line moved,
    // which is the drift it exists to catch, and which it then suffered itself: when the
    // script grew the holder filter and this query did not, the gate went on measuring
    // 329 of 2,580 — 1,052 person-years the report no longer reports on, and a usable count
    // 16% above the number it prints. Both assertions stayed green throughout.
    const [r] = await allRows<{ filed: string; clean: string }>(
      `WITH filed AS (
         SELECT d.person_id, d.fiscal_year fy, count(*) n
           FROM declaration d JOIN declaration_stake s USING (declaration_id)
           JOIN person p ON p.person_id = d.person_id
          WHERE d.person_id IS NOT NULL AND s.company_name IS NOT NULL
            AND stake_holder_is_declarant(s.holder_name, p.name_fold)
            AND d.declaration_type = 'Annualy' AND d.fiscal_year IS NOT NULL
          GROUP BY 1, 2),
       resolved AS (
         SELECT sc.person_id, d.fiscal_year fy, count(*) n
           FROM declaration_stake_company sc JOIN declaration d USING (declaration_id)
          WHERE sc.holder_is_declarant
            AND d.declaration_type = 'Annualy' AND d.fiscal_year IS NOT NULL
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

test("both queries count the declarant's OWN stakes on both sides", () => {
  // The newest member of the class above, and the one the family arm introduced. The declared
  // side cannot read `holder_is_declarant` — it counts rows of `declaration_stake`, where no
  // flag exists — so it calls 096's `stake_holder_is_declarant()`, which is the one definition
  // of the rule. Both halves of the fraction must carry it: filtering only the numerator
  // compares own-held resolutions against a denominator of every stake on the filing, so
  // nobody with a spouse's company is ever clean; filtering only the denominator does the
  // reverse. It appears four times — `filed` and `resolved`, in the row query and in the
  // coverage query.
  const declared = SCRIPT.match(/stake_holder_is_declarant\(/g) ?? [];
  const resolved = SCRIPT.match(/sc\.holder_is_declarant/g) ?? [];
  assert.ok(
    declared.length >= 2,
    `the declared side must call stake_holder_is_declarant() in both queries, found ${declared.length}`,
  );
  assert.ok(
    resolved.length >= 2,
    `the resolved side must filter holder_is_declarant in both queries, found ${resolved.length}`,
  );
  assert.ok(
    !/translit_bg_latin\(s\.holder_name\)/.test(SCRIPT),
    "the holder rule was restated inline instead of calling 096's stake_holder_is_declarant()",
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
