// Tier 3 (Postgres-native) — the subtitle that tells a search row whose ЕИК it is, run
// over the REAL corpus through the REAL builders.
//
//   npm run test:data
//
// WHAT IT GUARDS, PRECISELY. `entitySubtitle` decides, per row, whether to print
// „<eik> · в договорите: <name>". This gate covers ONE class of failure — the PROVENANCE
// class: the module comparing strings other than the ones it renders. That class is not
// hypothetical and is the reason the file exists: the fold compared the RAW `name` and
// `primary_name` while both halves render through `decodeEntities`, and `&amp;` survives a
// `\p{L}\p{N}` strip as the letters „amp" — so all 3 entity-carrying contractor rows
// printed the same visible name twice, once as the row and once as its own „correction".
//
// ⚠️ WHAT IT CANNOT SEE, said plainly so nobody reads a green run as more than it is.
// `flat`-equal implies `nameKey`-equal by construction (`flat` forgives strictly less), so
// a fold that is merely TOO WEAK — one that should have collapsed two spellings and did
// not — produces no violation here. `nameKey`'s own documented homoglyph gap („ПЕТРОЛ АД"
// vs a Latin-A „ПЕТРОЛ AД") is exactly such a case and is invisible to this test. Closing
// that needs a per-character sweep, not this comparison.
//
// ⚠️ IT IMPORTS THE REAL BUILDERS, and that is the whole design. An earlier cut re-derived
// „what the row shows" from `entitySubtitle` alone and compared it against the RAW `name` —
// so it PASSED with the entity bug re-introduced, i.e. it was vacuous against the one
// defect it was written for. Going through `companyItems`/`awarderItems` means the test
// reads the same `primary` the reader does. Verified by mutation both ways: reverting the
// fix fails it with „3 of 8828 …", restoring it passes.
//
// ⚠️ First data gate to import a module whose graph reaches `lucide-react` and the fetch
// layer. Safe — `tsconfig.app.json` compiles `src` and `scripts` as one project and the
// icons are inert values — but worth knowing if this file ever fails at import time.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import type { SearchItem } from "../../../src/ux/search/EntitySearchTile";
import {
  awarderItems,
  companyItems,
  entitySubtitle,
} from "../../../src/screens/components/search/procurementSearchSource";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

interface Row {
  eik: string;
  name: string;
  primaryName: string | null;
}

const rowsFor = (table: string): Promise<Row[]> =>
  allRows<Row>(
    `SELECT eik, name, primary_name AS "primaryName" FROM ${table}
      WHERE primary_name IS NOT NULL`,
  );

// ⚠️ THE SKIP IS DECIDED ONCE, AT MODULE SCOPE, AND EVERY TEST TAKES IT. An in-body
// `return reportSkip(...)` reports the test as PASSED, so „this corpus predates the column"
// would read as „the rule is enforced" — the exact inversion this file's own promise
// forbids. It also has to cover the NAMED case below, which otherwise hard-FAILS on an
// un-reloaded corpus and blames the fold for a missing column.
const haveDb = await dbReachable();
const rows = haveDb
  ? {
      contractor_search: await rowsFor("contractor_search"),
      awarder_search: await rowsFor("awarder_search"),
    }
  : { contractor_search: [] as Row[], awarder_search: [] as Row[] };
const skip = !haveDb
  ? "Postgres unreachable"
  : rows.contractor_search.length === 0 && rows.awarder_search.length === 0
    ? "contractor_search/awarder_search.primary_name is entirely NULL — this corpus predates the column; run npm run db:load:pg"
    : false;
reportSkip(import.meta.url, skip);

afterAll(async () => end());

/** Whitespace/case-insensitive only — deliberately NOT the module's `nameKey`.
 *
 *  ⚠️ THE REASON IS THE ONE THAT SURVIVES THE FIX, not the one that motivated it. Both
 *  halves now arrive decoded, so `&amp;` can no longer reach this function; what `flat`
 *  still buys is ZERO FALSE POSITIVES — it forgives only differences a reader cannot see,
 *  so anything it flags really is the same visible text printed twice. Using `nameKey` here
 *  would make the test agree with the implementation by construction and prove nothing. */
const flat = (s: string): string =>
  s.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("bg");

/** The rows that actually printed a correction, as the reader sees them.
 *
 *  ⚠️ ONE ROW PER BUILDER CALL, so item ↔ row is exactly 1:1. Batching and then filtering
 *  by EIK looks equivalent and is not: several ROWS share an EIK (that is what an alias
 *  IS), so an EIK-keyed set keeps every spelling of a corrected company and inflates the
 *  denominator — measured, 17,166 against a true 8,828, i.e. the test would report on a
 *  population twice the size of the one it means.
 *
 *  ⚠️ MEMBERSHIP COMES FROM `entitySubtitle`, NOT FROM SNIFFING THE COPY. Testing the
 *  rendered string for „: " would tie the gate to the wording: change the separator and the
 *  set empties, and the assertion below passes green over nothing. Comparing against
 *  `r.eik` is structural — that is exactly what the function returns when it stays silent.
 *
 *  A row whose key is synthetic (`ph-`/`np-`/empty) yields NO item: `companyItems` drops
 *  those, correctly, and they are simply not part of what a reader can see. */
const rendered = (table: string): SearchItem[] =>
  rows[table as keyof typeof rows]
    .filter((r) => entitySubtitle(r, true) !== r.eik)
    .flatMap((r) =>
      table === "contractor_search"
        ? companyItems({ companies: [r] }, true)
        : awarderItems({ awarders: [r] }, true),
    );

for (const table of ["contractor_search", "awarder_search"]) {
  test.skipIf(skip)(
    `${table}: no rendered correction repeats the row's own name`,
    async () => {
      const built = rendered(table);
      const noOps = built.filter((i) => {
        const sub = String(i.secondary);
        return flat(sub.slice(sub.indexOf(": ") + 2)) === flat(i.primary);
      });
      assert.deepEqual(
        noOps.slice(0, 5).map((i) => `${i.primary} → ${i.secondary}`),
        [],
        `${noOps.length} of ${built.length} rendered corrections repeat the row's own name`,
      );
    },
  );

  test.skipIf(skip)(
    `${table}: the fold still fires where the names genuinely differ`,
    async () => {
      // MUTATION CHECK. The assertion above is satisfied by a fold that has stopped
      // discriminating and renders NOTHING — the same defect in its other direction,
      // silently. A PROPORTIONAL floor rather than a constant: measured 2026-09-02, 8,828
      // of 45,343 contractor rows (19.5%) and 4,097 of 10,553 awarder rows (38.8%) render
      // a correction, so a tenth of the population is ~2x under the real figure and cannot
      // quietly ratchet down as the corpus grows.
      const all = rows[table as keyof typeof rows];
      const built = rendered(table);
      assert.ok(
        built.length > all.length / 10,
        `only ${built.length} of ${all.length} rows render a correction — the fold has ` +
          "stopped discriminating, so the silent-when-they-differ direction is unguarded",
      );
      // …and not on nearly everything: `primary_name` is one of the EIK's OWN names, so a
      // single-spelling EIK has nothing to correct. This bound only catches a total
      // inversion; the real figures are 19.5% and 38.8%.
      assert.ok(
        built.length < all.length * 0.9,
        `${built.length} of ${all.length} rows render a correction — implausibly many`,
      );
    },
  );
}

test.skipIf(skip)(
  "the named case: the Клет alias on БИТ И ТЕХНИКА's ЕИК is corrected",
  async () => {
    // The reported symptom, pinned end to end: one of EIK 103795327's 1,101 contract rows
    // was filed under Клет България's name, so the dropdown showed two „Клет" rows and the
    // second carried БИТ И ТЕХНИКА's €2,214,873 under Клет's name.
    const row = rows.contractor_search.find(
      (r) => r.eik === "103795327" && /лет.*ългария/i.test(r.name),
    );
    if (!row) {
      // Not a silent pass: the corpus is loaded (the module-scope skip did not fire) and
      // the reference row is absent, which is a fact worth printing rather than asserting.
      reportSkip(
        import.meta.url,
        "the reference Клет alias is not in this corpus",
      );
      return;
    }
    const sub = entitySubtitle(row, true);
    assert.notEqual(sub, row.eik, "the mis-keyed row rendered no correction");
    assert.match(sub, /в договорите/);
    assert.match(sub, /Техника/);
    // ⚠️ „в договорите", not „в регистъра": 27% of the rows that render this subtitle name
    // an EIK with no `tr_companies` entry at all (64.6% on the awarder side).
    assert.ok(
      !sub.includes("регистъра"),
      "the subtitle must not claim a register entry",
    );
  },
);
