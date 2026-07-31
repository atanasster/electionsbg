// AGRI_FINANCIAL_YEARS is the /subsidies year picker AND the whitelist
// agriScopeToKey validates against — so it must be exactly the set of overview
// scopes the loader precomputed. The two drift silently in both directions:
//
//   a year in the list with no payload → the picker offers a scope that serves
//     nothing (the bug this gate was added for);
//   a payload with no year in the list → a covered year is unreachable from the
//     UI, and agriScopeToKey now rejects its deep link as unsupported.
//
// Auto-skips when Postgres is down or agri_payloads is empty, like the other
// *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { AGRI_FINANCIAL_YEARS } from "@/data/agri/constants";

const haveDb = await dbReachable();
const loaded =
  haveDb &&
  (
    await allRows<{ n: string }>(
      "SELECT count(*) n FROM agri_payloads WHERE kind = 'overview'",
    ).catch(() => [{ n: "0" }])
  ).some((r) => Number(r.n) > 0);
const skip = !haveDb
  ? "Postgres unreachable"
  : !loaded
    ? "agri_payloads has no overview rows"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "AGRI_FINANCIAL_YEARS matches the precomputed overview scopes exactly",
  async () => {
    const rows = await allRows<{ key: string }>(
      "SELECT key FROM agri_payloads WHERE kind = 'overview'",
    );
    const keys = new Set(rows.map((r) => r.key));

    // The two non-year singletons the page always needs.
    assert.ok(keys.has(""), "the default (latest-year) overview is missing");
    assert.ok(keys.has("all"), "the all-years overview is missing");

    const built = [...keys]
      .filter((k) => /^\d{4}$/.test(k))
      .map(Number)
      .sort((a, b) => b - a);
    assert.deepEqual(
      built,
      [...AGRI_FINANCIAL_YEARS].sort((a, b) => b - a),
      "the year picker and the precomputed overview scopes disagree",
    );
  },
);
