// TS ↔ SQL parity gate for the contract risk index, as an automatic test.
//
// WHY THIS WRAPPER EXISTS: the comparison itself lives in
// scripts/procurement/risk_parity.harness.ts, but for most of its life nothing
// ran it. Its only callers were `npm run risk:parity` and the tail of
// `ai:test:all` — both hand-run — and CI (.github/workflows/test.yml) never
// invoked either. That is how it came to spend months printing "skipped" against
// a fully loaded 407,693-row corpus while a real availability bug sat in 033's
// foundedByEik slice. A gate nobody runs is not a gate, so it rides `test:data`
// here, which `db:refresh` runs at the end of every local reload.
//
// 2k rows keeps this inside the suite's per-test budget while still touching all
// 12 checks; the full-corpus sweep stays `npm run risk:parity`.
//
// Auto-skips when Postgres is down or the cache is empty — like the other
// *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { runParity } from "../../procurement/risk_parity.harness";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.contract_risk_cache') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM contract_risk_cache",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / contract_risk_cache empty";

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "TS and SQL agree on all 12 contract risk checks",
  async () => {
    const r = await runParity({ n: 2000, seed: 42 });
    assert.equal(r.skipped, false, "cache went empty mid-run");

    // Report every disagreeing check at once rather than the first — a drifted rule
    // usually moves several bits, and the shape of the set is the diagnosis.
    assert.deepEqual(
      [...r.mismatches.entries()],
      [],
      `check-level parity broke; examples:\n${r.examples.join("\n")}`,
    );
    // cri/score are derived, so they can only differ if a bit did — but assert them
    // explicitly so a change to the derivation itself cannot pass unnoticed.
    assert.equal(r.criDiff, 0, "cri disagrees");
    assert.equal(r.scoreDiff, 0, "score disagrees");
    // The SPA decodes these masks rather than running the scorer, so "TS agrees
    // with SQL" no longer implies "the page agrees with SQL".
    assert.equal(
      r.decoderDiff,
      0,
      "the SPA mask decoder (src/lib/contractRiskMask.ts) disagrees — every chip " +
        "on the contract screens is derived from it",
    );
  },
);
