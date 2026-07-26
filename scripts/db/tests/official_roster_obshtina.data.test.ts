// The obshtina code on a municipal official's roster row and person_role (T0.2a).
// Plan: docs/plans/persons-pg-retirement-v1.md.
//
// WHY THIS IS CARRIED RATHER THAN DERIVED. The Court-of-Audit register names a
// municipality in prose ("Гоце Делчев"); the app keys municipal pages on an obshtina code
// ("BLG11"). The join between them lives in scripts/officials/municipality_join.ts and
// needs an alias file, four fallback strategies and synthetic codes for Sofia's 24
// district councils — it is not reproducible in SQL, and re-implementing it there would
// be a second source of truth. So the municipal shard build resolves it once, the roster
// loader reads the answer out of the emitted by_obshtina shards, and the resolver copies
// it to person_role.place. These tests pin that chain end to end, because every link in it
// fails silently: a missing code just leaves place NULL and the municipal roster
// unservable from Postgres, which is the state this replaced.
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
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM official_roster WHERE tier = 'municipal'",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / official_roster empty";
const haveShards = existsSync(SHARD_DIR);

afterAll(async () => {
  await end();
});

// Every municipal official has a code. A partial fill is the dangerous state: the roster
// still loads, the resolver still runs, and only the officials in the un-coded obshtini
// quietly vanish from a code-scoped query.
test.skipIf(skip)(
  "every municipal roster row carries an obshtina code",
  async () => {
    const [row] = await allRows<{ total: string; coded: string }>(
      `SELECT count(*) AS total,
            count(*) FILTER (WHERE obshtina IS NOT NULL) AS coded
       FROM official_roster WHERE tier = 'municipal'`,
    );
    assert.equal(
      row.coded,
      row.total,
      `${Number(row.total) - Number(row.coded)} municipal roster row(s) have no obshtina — the by_obshtina shards were missing or unreadable when db:load:ngo-board-links ran`,
    );
  },
);

// The resolver leg. official_roster having the code is useless if person_role does not,
// since that is what a served municipal roster would actually be keyed on.
test.skipIf(skip)(
  "person_role.place carries the code for municipal roles",
  async () => {
    const [row] = await allRows<{ total: string; placed: string }>(
      `SELECT count(*) AS total,
            count(*) FILTER (WHERE place IS NOT NULL) AS placed
       FROM person_role WHERE source = 'official_muni'`,
    );
    assert.equal(
      row.placed,
      row.total,
      `${Number(row.total) - Number(row.placed)} official_muni role(s) have a NULL place — db:resolve:persons ran against a roster without obshtina, or the place is no longer being set`,
    );
  },
);

// Codes must be the app's own, not invented. Anything not matching a shard filename would
//404 the municipal page it keys.
test.skipIf(skip || !haveShards)(
  "every code in person_role matches a real obshtina shard",
  async () => {
    const known = new Set(
      readdirSync(SHARD_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, "")),
    );
    const rows = await allRows<{ place: string }>(
      `SELECT DISTINCT place FROM person_role
        WHERE source = 'official_muni' AND place IS NOT NULL`,
    );
    for (const { place } of rows)
      assert.ok(
        known.has(place),
        `person_role.place '${place}' is not an obshtina shard`,
      );
  },
);

// Full set parity against the shards, both directions. This is the assertion that would
// have caught a name→code join regression: an official silently filed under the wrong
// municipality shows up here as one missing and one extra.
test.skipIf(skip || !haveShards)(
  "the per-obshtina membership matches the shards exactly",
  async () => {
    const rows = await allRows<{ place: string; ref: string }>(
      `SELECT place, ref FROM person_role
        WHERE source = 'official_muni' AND place IS NOT NULL`,
    );
    const pg = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!pg.has(r.place)) pg.set(r.place, new Set());
      pg.get(r.place)!.add(r.ref);
    }

    let jsonSlugs = 0;
    const missing: string[] = [];
    const extra: string[] = [];
    for (const f of readdirSync(SHARD_DIR)) {
      if (!f.endsWith(".json")) continue;
      const shard = JSON.parse(
        readFileSync(path.join(SHARD_DIR, f), "utf8"),
      ) as { obshtina?: string; entries?: { slug?: string }[] };
      const code = shard.obshtina ?? f.replace(/\.json$/, "");
      const js = new Set(
        (shard.entries ?? []).map((e) => e.slug).filter(Boolean) as string[],
      );
      jsonSlugs += js.size;
      const ps = pg.get(code) ?? new Set<string>();
      for (const s of js) if (!ps.has(s)) missing.push(`${code}/${s}`);
      for (const s of ps) if (!js.has(s)) extra.push(`${code}/${s}`);
    }

    assert.ok(
      jsonSlugs > 5_000,
      `only ${jsonSlugs} shard slugs — shards look truncated`,
    );
    assert.deepEqual(
      { missing: missing.slice(0, 5), extra: extra.slice(0, 5) },
      { missing: [], extra: [] },
      `obshtina membership drifted from the shards (${missing.length} missing, ${extra.length} extra)`,
    );
  },
);
