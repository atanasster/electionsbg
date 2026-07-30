// The per-contract risk masks must actually be POPULATED on the serving view.
//
// WHY VALUES AND NOT COLUMNS: the six risk_* columns are always present on
// contracts_list — rebuild_contracts_list() (000_search_fns.sql:124) guards the
// join on contract_risk_cache existing and emits `NULL::int` placeholders when it
// does not, precisely so the view's shape never changes. So asserting the columns
// exist proves nothing at all; it passes on a database where every contract is
// unscored.
//
// What actually breaks is the VALUE. Since T1.2 the contract screens render their
// chips by decoding these masks (src/lib/contractRiskMask.ts) instead of scoring
// in the browser, so a NULL mask is the difference between a page of risk chips
// and a page of "not scored" marks. Two ordinary operations produce that state:
//
//   * a contracts reload that never ran `SELECT rebuild_contract_risk_cache()`
//     (db:load:pg does it at :514 — a hand-run COPY into `contracts` does not),
//   * applying 112 to a database whose contracts_list predates it, leaving the
//     view bound to the NULL branch until the rebuild re-creates it.
//
// Neither fails anything else. The row counts stay right, the API keeps 200-ing,
// and the damage shows up only as chips quietly turning into question marks —
// green locally, blank on prod, which is the failure shape CLAUDE.md documents
// for the place-dim and persons-browse loaders.
//
// Auto-skips when Postgres is down — like the other *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

// Skip ONLY for "there is no database" or "the corpus was never loaded". A
// reachable database that HAS contracts but is missing contracts_list is a broken
// install and must FAIL — this file's whole subject is a gate that goes quiet
// instead of loud, and probing for the very relation it guards would reproduce
// that bug one level up. It is not hypothetical: 042 drops appealed_ocids with
// CASCADE and contracts_list joins it, so a partially-applied 042 leaves exactly
// this state, and a to_regclass probe here would report all four gates green.
const haveDb = await dbReachable();
const corpusLoaded =
  haveDb &&
  Number(
    (await allRows<{ n: string }>("SELECT count(*) n FROM contracts"))[0]?.n ??
      0,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !corpusLoaded
    ? "contracts corpus empty"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)("contract_risk_cache is populated", async () => {
  // Deliberately only "non-empty", with no cardinality threshold. A count-vs-count
  // comparison would measure the wrong thing — 5,000 orphan cache rows swapped for
  // 5,000 real ones still reports "407,964 of 407,964" at zero real coverage — and
  // the next gate already rejects, per row, every shortfall a threshold would
  // forgive. This one exists for its MESSAGE: an empty cache names the one command
  // that fixes it, instead of surfacing as 407k NULL-mask rows.
  const [r] = await allRows<{ cached: string }>(
    "SELECT count(*) cached FROM contract_risk_cache",
  );
  assert.ok(
    Number(r.cached) > 0,
    "contract_risk_cache is EMPTY — run `SELECT rebuild_contract_risk_cache();` " +
      "(db:load:pg does this at the end of a contracts load; a hand-run COPY into " +
      "`contracts` does not)",
  );
});

test.skipIf(skip)("contracts_list serves non-NULL risk masks", async () => {
  // The view, not the table: this is what /api/db/table and /api/db/contract
  // actually read, and it is where the NULL branch bites.
  const [r] = await allRows<{ total: string; null_masks: string }>(
    `SELECT count(*) AS total,
              count(*) FILTER (WHERE risk_fired_mask IS NULL
                                  OR risk_available_mask IS NULL) AS null_masks
         FROM contracts_list`,
  );
  assert.equal(
    r.null_masks,
    "0",
    `${r.null_masks} of ${r.total} rows on contracts_list carry NULL risk masks — ` +
      `every one renders as "not scored" in the browser. Either the risk cache was ` +
      `never rebuilt after a contracts load, or contracts_list predates migration ` +
      `112 and needs SELECT rebuild_contracts_list().`,
  );
});

test.skipIf(skip)("available_mask is a superset of fired_mask", async () => {
  // 112 ANDs every f_* with its a_*, so a fired-but-unavailable bit cannot be
  // produced by the rebuild — but the SPA decoder derives BOTH counts from
  // these two ints, and such a row would make firedCount exceed availableCount
  // and push the CRI over 100.
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM contract_risk_cache
        WHERE (fired_mask & ~available_mask) <> 0`,
  );
  assert.equal(
    r.n,
    "0",
    "rows have a fired bit outside the available set — the CRI denominator is " +
      "smaller than its numerator on those contracts",
  );
});

test.skipIf(skip)(
  "the stored scalars agree with the masks they were computed with",
  async () => {
    // fired / available / cri are stored alongside the masks. The decoder reads
    // only the masks, while the grade filter and the riskiest-contracts board
    // read the scalars — so a divergence means the chips and the ranking describe
    // the same contract differently.
    // ::bit(32), NOT ::bit(12). A narrower cast truncates from the LEFT — it keeps
    // the rightmost N bits — so 4096::bit(12) is all zeroes and a stray bit above
    // the 12 defined checks would slip past this gate AND the superset gate above.
    // It would also hardcode a width that 112 explicitly invites growing ("append
    // new checks at the end"), turning a 13th check into a corpus-wide failure
    // that blames the data. bit_count over the full width is exact at any count,
    // and measured ~3.5x faster than the string-replace trick it replaces.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n
         FROM (
           SELECT fired, available, cri,
                  bit_count(fired_mask::bit(32))     AS fired_bits,
                  bit_count(available_mask::bit(32)) AS avail_bits
             FROM contract_risk_cache
         ) x
        WHERE fired <> fired_bits
           OR available <> avail_bits
           OR cri <> CASE WHEN avail_bits = 0 THEN 0
                          ELSE round(100.0 * fired_bits / avail_bits) END`,
    );
    assert.equal(
      r.n,
      "0",
      "stored fired/available/cri disagree with the bit counts in their own masks",
    );
  },
);
