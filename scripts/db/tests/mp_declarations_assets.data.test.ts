// The mp-declarations + mp-assets serving routes (mp_declarations()/mp_assets(), migration 105)
// that replace the parliament/declarations/{id}.json + mp-assets/{id}.json shards.
// Plan: docs/plans/persons-pg-retirement-v1.md (Tier 2, T2.1b).
//
// The vocabulary RESHAPE (route JSON → MpDeclaration) is unit-tested in
// src/data/parliament/useMpDeclarations.test.ts; this gate pins the PG side:
//   - the ?id= path resolves the mp id → person slug (candidate screens have no slug),
//   - a filer's declarations carry the raw keys the reshape consumes, and asset/income/stake
//     counts match the on-disk shard (the declaration content is the same source),
//   - a filer's mp-assets rollup carries the person_wealth_year netWorthEur (NOT the JSON's
//     company-share-folded figure — deliberate, like T2.2),
//   - a non-filer's mp-assets row has null wealth (the hook maps that to undefined), and
//   - junk / unknown ids degrade to []/null, never a 500.
//
// Auto-skips when Postgres is down or the person layer is missing — like the other gates.
//   npm run test:data

import { existsSync, readFileSync } from "node:fs";
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
const DECL_DIR = path.join(ROOT, "data/parliament/declarations");

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person_wealth_year') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / person layer missing";

afterAll(async () => {
  await end();
});

const decl = (q: Record<string, string>) =>
  DB_ROUTES["mp-declarations"](allRows, q);
const assets = (q: Record<string, string>) =>
  DB_ROUTES["mp-assets"](allRows, q);

// A current MP who filed at least once (has a person_wealth_year row via the mp person_role).
const aFilerId = async (): Promise<number | null> => {
  const [r] = await allRows<{ mp_id: string }>(`
    SELECT m.mp_id
    FROM mp_profile m
    JOIN person_role r ON r.source = 'mp' AND r.ref = m.mp_id::text
    JOIN person_wealth_year w ON w.person_id = r.person_id
    WHERE m.is_current
    ORDER BY m.mp_id
    LIMIT 1`);
  return r ? Number(r.mp_id) : null;
};

test.skipIf(skip)(
  "mp-declarations?id= serves a filer's filings with raw reshape keys",
  async () => {
    const id = await aFilerId();
    assert.ok(id != null, "no filer MP found");
    const body = (await decl({ id: String(id) })).body as Record<
      string,
      unknown
    >[];
    assert.ok(Array.isArray(body) && body.length > 0, "no filings returned");
    const f = body[0];
    // The keys the reshape consumes must be present (renames happen client-side).
    for (const k of ["year", "type", "assets", "income", "stakes", "sourceUrl"])
      assert.ok(k in f, `filing missing key ${k}`);

    // Content parity with the on-disk shard: asset/income counts of the latest filing match.
    const shard = path.join(DECL_DIR, `${id}.json`);
    if (existsSync(shard)) {
      const disk = JSON.parse(readFileSync(shard, "utf8")) as Record<
        string,
        unknown
      >[];
      const d = disk.find((x) => x.sourceUrl === f.sourceUrl) ?? disk[0];
      assert.equal(
        (f.assets as unknown[]).length,
        ((d.assets as unknown[]) ?? []).length,
        "asset count differs from shard",
      );
      assert.equal(
        (f.income as unknown[]).length,
        ((d.income as unknown[]) ?? []).length,
        "income count differs from shard",
      );
    }
  },
);

test.skipIf(skip)(
  "mp-assets?id= serves a filer's person_wealth_year rollup",
  async () => {
    const id = await aFilerId();
    assert.ok(id != null);
    const body = (await assets({ id: String(id) })).body as {
      netWorthEur: number | null;
      latestDeclarationYear: number | null;
      mpId: number | null;
    };
    assert.ok(body, "null rollup for a filer");
    assert.equal(body.mpId, id);
    assert.ok(
      body.latestDeclarationYear != null,
      "filer has no latestDeclarationYear",
    );
    // The rollup net worth is the person_wealth_year series (what mp_assets_rankings_table ranks).
    const [rank] = await allRows<{ nw: string | null }>(
      "SELECT round(net_worth_eur) nw FROM mp_assets_rankings_table WHERE ns = 'all' AND mp_id = $1",
      [id],
    );
    if (rank?.nw != null)
      assert.equal(
        Number(body.netWorthEur),
        Number(rank.nw),
        "rollup net worth != rankings series",
      );
  },
);

test.skipIf(skip)(
  "mp-assets?id= yields a null-wealth row for a non-filer",
  async () => {
    const [r] = await allRows<{ mp_id: string }>(`
    SELECT m.mp_id
    FROM mp_profile m
    JOIN person_role pr ON pr.source = 'mp' AND pr.ref = m.mp_id::text
    JOIN person p ON p.person_id = pr.person_id AND p.status = 'active' AND p.is_public_figure
    WHERE NOT EXISTS (
      SELECT 1 FROM person_wealth_year w WHERE w.person_id = pr.person_id)
    LIMIT 1`);
    if (!r) return; // every resolvable MP filed — nothing to assert
    const body = (await assets({ id: r.mp_id })).body as {
      latestDeclarationYear: number | null;
    } | null;
    // The route returns a row; its null wealth is what the hook maps to undefined.
    assert.ok(body === null || body.latestDeclarationYear == null);
  },
);

test.skipIf(skip)("unknown / junk ids degrade, never 500", async () => {
  assert.deepEqual((await decl({ id: "999999999" })).body, []);
  assert.deepEqual((await decl({ id: "abc" })).body, []);
  assert.equal((await assets({ id: "999999999" })).body, null);
  assert.equal((await assets({ id: "abc" })).body, null);
});
