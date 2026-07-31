// The /api/db/agri-payload status contract. A missing row means two different
// things there, and the route must not flatten them:
//
//   kind='recipient' (key = eik)  → 200 + null. "No subsidies for this EIK" is a
//     correct, permanent answer; /farm/:eik renders it as an empty state.
//   kind='overview'  (key = scope) → 404. A scope was either precomputed or does
//     not exist. Serving null let the client record a SUCCESS with no data and
//     hold its skeleton forever, and /api/db is CDN-cached for an hour with 24 h
//     SWR — so a null served before the loader ran would be pinned at the edge.
//
// Pure JS over a mock dbRows; no Postgres, so this always runs.

import { test } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DB_ROUTES } = require("../../../functions/db_routes.js") as {
  DB_ROUTES: Record<
    string,
    (
      dbRows: (sql: string, params: unknown[]) => Promise<unknown[]>,
      q: Record<string, string>,
    ) => Promise<{ status?: number; body: unknown }>
  >;
};

const agriPayload = DB_ROUTES["agri-payload"];

/** A dbRows that records its calls and returns `rows`. */
const mockDb = (rows: unknown[]) => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const fn = async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    return rows;
  };
  return Object.assign(fn, { calls });
};

test("an overview scope with no precomputed row is a 404, not a 200 carrying null", async () => {
  const db = mockDb([]);
  const res = await agriPayload(db, { kind: "overview", key: "2019" });
  assert.equal(res.status, 404, "unbuilt scope must not answer 200");
  assert.deepEqual(db.calls[0].params, ["overview", "2019"]);
});

test("the default-scope overview ('' key) 404s the same way when unbuilt", async () => {
  const res = await agriPayload(mockDb([]), { kind: "overview" });
  assert.equal(res.status, 404);
});

test("a built overview scope serves its payload with no status override", async () => {
  const payload = { totalEur: 42 };
  const res = await agriPayload(mockDb([{ payload }]), {
    kind: "overview",
    key: "all",
  });
  assert.equal(res.status, undefined, "200 by omission");
  assert.deepEqual(res.body, payload);
});

// The other half of the contract — unchanged behaviour for entity keys.
test("a recipient EIK with no subsidies stays a 200 carrying null", async () => {
  const res = await agriPayload(mockDb([]), {
    kind: "recipient",
    key: "999999999",
  });
  assert.equal(
    res.status,
    undefined,
    "an entity with no money is not an error",
  );
  assert.equal(res.body, null);
});

test("a missing kind is still a 400", async () => {
  const res = await agriPayload(mockDb([]), {});
  assert.equal(res.status, 400);
});

// missingMigrationEmpty's sentinel is [{r:[]}] — TRUTHY, with no `payload` key.
// The overview branch must read through it to `undefined` and 404 rather than
// serve the sentinel as a payload.
test("a database predating migration 046 degrades to 404 for an overview", async () => {
  const failing = async () => {
    throw Object.assign(new Error("no migration"), { code: "42P01" });
  };
  const res = await agriPayload(failing, { kind: "overview", key: "2024" });
  assert.equal(res.status, 404);
});
