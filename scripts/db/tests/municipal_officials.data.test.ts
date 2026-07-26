// The per-obshtina municipal roster (102_municipal_officials.sql) that replaces the
// data/officials/municipal/by_obshtina/<code>.json shards on a municipality page.
// Plan: docs/plans/persons-pg-retirement-v1.md (Tier 0.2).
//
// The grain is the thing to protect here. officials_rankings_table is person-keyed with a
// UNIQUE slug because a leaderboard ranks humans; this is a ROSTER, and 46 people sit on
// more than one municipal body. Re-keying it on the person would silently drop one of their
// seats and make two municipalities disagree about their own council — so these pin the
// listing grain, the obshtina scoping, and full membership parity against the shards.
//
// Auto-skips when Postgres is down or unloaded — like the other *.data.test.ts gates.
//
//   npm run test:data

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const SHARD_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../data/officials/municipal/by_obshtina",
);

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.municipal_officials_table') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM municipal_officials_table",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / municipal_officials empty";
const haveShards = existsSync(SHARD_DIR);

afterAll(async () => {
  await end();
});

// The grain. official_slug is one per roster listing and is the paging tiebreak, so it
// must be unique; person_slug must NOT be, or the multi-seat councillors have been lost.
test.skipIf(skip)(
  "the grain is the roster listing, not the person",
  async () => {
    const [dupeSlug] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM (
       SELECT official_slug FROM municipal_officials_table
        GROUP BY official_slug HAVING count(*) > 1) x`,
    );
    assert.equal(
      Number(dupeSlug.n),
      0,
      "duplicate official_slug breaks deterministic pagination",
    );

    const [multiSeat] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM (
       SELECT person_slug FROM municipal_officials_table
        GROUP BY person_slug HAVING count(DISTINCT obshtina) > 1) x`,
    );
    assert.ok(
      Number(multiSeat.n) > 0,
      "nobody holds seats in two obshtini — the matview has collapsed to one row per person and dropped the second seat",
    );
  },
);

// Every row is scoped. A NULL obshtina is unreachable from the municipality page that is
// the only consumer, so it is the same as being missing.
test.skipIf(skip)("every listing carries an obshtina code", async () => {
  const [n] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM municipal_officials_table WHERE obshtina IS NULL",
  );
  assert.equal(Number(n.n), 0, "listings with no obshtina are unreachable");
});

// §6 privacy gate, same as 100 and every serving fn in 082.
test.skipIf(skip)("the §6 privacy gate is applied", async () => {
  const [n] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM municipal_officials_table m
       JOIN person p ON p.slug = m.person_slug
      WHERE p.status <> 'active' OR NOT p.is_public_figure`,
  );
  assert.equal(
    Number(n.n),
    0,
    "non-public / in-review persons reached the municipal roster",
  );
});

// Full membership + role parity against the shards, both directions. This is what would
// catch an obshtina mis-assignment: one official filed under the wrong municipality shows
// up as one missing and one extra.
test.skipIf(skip || !haveShards)(
  "per-obshtina membership and roles match the shards exactly",
  async () => {
    const rows = await allRows<{
      obshtina: string;
      official_slug: string;
      role: string;
    }>("SELECT obshtina, official_slug, role FROM municipal_officials_table");
    const pg = new Map<string, Map<string, string>>();
    for (const r of rows) {
      if (!pg.has(r.obshtina)) pg.set(r.obshtina, new Map());
      pg.get(r.obshtina)!.set(r.official_slug, r.role);
    }

    let jsonEntries = 0;
    const missing: string[] = [];
    const extra: string[] = [];
    const roleDiff: string[] = [];
    for (const f of readdirSync(SHARD_DIR)) {
      if (!f.endsWith(".json")) continue;
      const shard = JSON.parse(
        readFileSync(path.join(SHARD_DIR, f), "utf8"),
      ) as {
        obshtina?: string;
        entries?: { slug?: string; role?: string }[];
      };
      const code = shard.obshtina ?? f.replace(/\.json$/, "");
      const pm = pg.get(code) ?? new Map<string, string>();
      const seen = new Set<string>();
      for (const e of shard.entries ?? []) {
        if (!e.slug) continue;
        jsonEntries++;
        seen.add(e.slug);
        if (!pm.has(e.slug)) missing.push(`${code}/${e.slug}`);
        else if (pm.get(e.slug) !== e.role)
          roleDiff.push(`${e.slug}: json=${e.role} pg=${pm.get(e.slug)}`);
      }
      for (const s of pm.keys()) if (!seen.has(s)) extra.push(`${code}/${s}`);
    }

    assert.ok(
      jsonEntries > 5_000,
      `only ${jsonEntries} shard entries — shards look truncated`,
    );
    assert.deepEqual(
      {
        missing: missing.slice(0, 5),
        extra: extra.slice(0, 5),
        roleDiff: roleDiff.slice(0, 5),
      },
      { missing: [], extra: [], roleDiff: [] },
      `roster drifted from the shards (${missing.length} missing, ${extra.length} extra, ${roleDiff.length} role mismatches)`,
    );
  },
);
