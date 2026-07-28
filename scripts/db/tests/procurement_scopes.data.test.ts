// procurement_scopes (migration 118) — the pscope windows as rows.
//
// WHAT THIS PINS. The scoped procurement precomputes iterate this table, and the page looks
// its rows up by the key useScopeWindow derives. If the two ever disagree the failure is
// SILENT: a scope the UI can select but the table does not carry serves an empty page, and
// a window stored under the wrong key serves one period's numbers under another's label.
// Neither raises anything, so both get an assertion here.
//
// The window arithmetic itself is unit-tested in src/data/scope/windows.test.ts (no DB).
// This gate is about what actually LANDED in the database.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import {
  allScopeWindows,
  type ElectionRef,
} from "../../../src/data/scope/windows";
import { SCOPE_FIRST_YEAR } from "../../../src/data/scope/constants";
import elections from "../../../src/data/json/elections.json";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM procurement_scopes",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};
const ok = await reachable();

afterAll(async () => {
  await end();
});

type Row = {
  scope_key: string;
  date_from: string | null;
  date_to: string | null;
};

test.skipIf(!ok)(
  "carries exactly the windows the shared definition produces",
  async () => {
    // Compared against allScopeWindows() — the same function the React hook and every
    // scoped loader call — so this fails the moment the table drifts from the UI.
    const rows = await allRows<Row>(
      "SELECT scope_key, date_from, date_to FROM procurement_scopes ORDER BY scope_key",
    );
    const expected = allScopeWindows(
      elections as ElectionRef[],
      new Date().getFullYear(),
    )
      .map((w) => ({ scope_key: w.key, date_from: w.from, date_to: w.to }))
      .sort((a, b) => a.scope_key.localeCompare(b.scope_key));
    assert.deepEqual(rows, expected);
  },
);

test.skipIf(!ok)(
  "covers every election as its own parliament window",
  async () => {
    // A newly ingested election with no row means the DEFAULT scope for that election has no
    // precomputed data — the most likely way this table goes stale, since it only changes
    // when elections.json does.
    const rows = await allRows<{ scope_key: string }>(
      "SELECT scope_key FROM procurement_scopes WHERE scope_key LIKE 'ns:%'",
    );
    const have = new Set(rows.map((r) => r.scope_key));
    const missing = (elections as ElectionRef[])
      .map((e) => `ns:${e.name}`)
      .filter((k) => !have.has(k));
    assert.deepEqual(
      missing,
      [],
      `election(s) with no precomputed scope window: ${missing.join(", ")} — re-run db:load:procurement-scopes:pg`,
    );
  },
);

test.skipIf(!ok)(
  "has the corpus-wide scope with both bounds open",
  async () => {
    const [r] = await allRows<Row>(
      "SELECT scope_key, date_from, date_to FROM procurement_scopes WHERE scope_key = 'all'",
    );
    assert.ok(r, "no 'all' scope — the full-corpus view has no window row");
    assert.equal(r.date_from, null);
    assert.equal(r.date_to, null);
  },
);

test.skipIf(!ok)("never stores an inverted or empty window", async () => {
  // A parliament window whose upper bound precedes its lower bound returns nothing at all,
  // which reads as "this parliament awarded no contracts" rather than as a bug. The CHECK
  // enforces it; asserted anyway so a dropped constraint surfaces here.
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM procurement_scopes
      WHERE date_from IS NOT NULL AND date_to IS NOT NULL AND date_from >= date_to`,
  );
  assert.equal(r.n, "0");
});

test.skipIf(!ok)(
  "spans the year range contiguously, from the corpus floor to the current year",
  async () => {
    const rows = await allRows<{ scope_key: string }>(
      "SELECT scope_key FROM procurement_scopes WHERE scope_key LIKE 'y:%' ORDER BY scope_key",
    );
    const years = rows.map((r) => Number(r.scope_key.slice(2)));
    // A gap would leave a `y:` option in the UI selector with no rows behind it.
    for (let i = 1; i < years.length; i++)
      assert.equal(years[i], years[i - 1] + 1, `year gap before ${years[i]}`);
    // FLOOR and CEILING, not just contiguity. The year windows are enumerated
    // SCOPE_FIRST_YEAR..currentYear, so the set goes stale on 1 January — the selector
    // offers the new year while the table still stops at the old one, and that scope
    // serves an empty page. Contiguity alone would pass in exactly that state.
    assert.equal(
      years[0],
      SCOPE_FIRST_YEAR,
      "year windows do not start at the corpus floor",
    );
    assert.equal(
      years[years.length - 1],
      new Date().getFullYear(),
      "no window for the current year — re-run db:load:procurement-scopes:pg (the year rolled over)",
    );
  },
);
