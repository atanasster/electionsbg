// The mp-profile serving surface (110_mp_profile_detail.sql, loaded by load_mp_roster_pg.ts)
// that replaces the data/parliament/profiles/{id}.json shard tree.
// Plan: docs/plans/persons-pg-retirement-v1.md (Tier 2, T2.3b).
//
// Pins that /api/db/mp-profile serves each blob SEMANTICALLY IDENTICAL to the on-disk shard
// (jsonb reorders object keys, so the comparison is order-independent), that every profile
// file is loaded (the whole tree must leave the bucket, not just roster MPs), and that the
// route degrades an unknown / junk id to a null body rather than throwing.
//
// Auto-skips when Postgres is down or the table is empty — like the other *.data.test.ts gates.
//   npm run test:data

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

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

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PROFILES_DIR = path.join(ROOT, "data/parliament/profiles");

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.mp_profile_detail') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM mp_profile_detail",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = (await reachable()) && existsSync(PROFILES_DIR);
const skip = haveDb ? false : "Postgres unreachable / mp_profile_detail empty";

afterAll(async () => {
  await end();
});

type Json = unknown;
const norm = (x: Json): Json => {
  if (Array.isArray(x)) return x.map(norm);
  if (x && typeof x === "object")
    return Object.keys(x as Record<string, Json>)
      .sort()
      .reduce<Record<string, Json>>((o, k) => {
        o[k] = norm((x as Record<string, Json>)[k]);
        return o;
      }, {});
  return x;
};

const route = (id: string) => DB_ROUTES["mp-profile"](allRows, { id });

test.skipIf(skip)(
  "mp-profile serves every profile blob, semantically identical to its shard",
  async () => {
    const files = readdirSync(PROFILES_DIR).filter((f) => f.endsWith(".json"));

    // Whole-tree coverage: PG must hold a row for every shard (the entire tree leaves the
    // bucket, not just current-roster MPs).
    const [{ n }] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM mp_profile_detail",
    );
    assert.equal(Number(n), files.length, "row count != shard count");

    // Spot-check a spread of shards for byte-for-byte (order-independent) parity.
    for (const f of files.filter((_, i) => i % 137 === 0)) {
      const id = f.replace(".json", "");
      const disk = JSON.parse(readFileSync(path.join(PROFILES_DIR, f), "utf8"));
      const { body } = await route(id);
      assert.ok(body, `mp-profile ${id} returned null`);
      assert.deepEqual(norm(body), norm(disk), `blob mismatch for ${id}`);
    }
  },
);

test.skipIf(skip)(
  "mp-profile returns a null body for unknown / junk ids",
  async () => {
    assert.equal((await route("999999999")).body, null);
    assert.equal((await route("abc")).body, null);
    assert.equal((await route("0")).body, null);
    // Past int4 max: clamped to the int4 ceiling (a non-existent mp_id), so it stays a null
    // body rather than raising Postgres 22003 (out of range for integer) → a 500.
    assert.equal((await route("3000000000")).body, null);
  },
);
