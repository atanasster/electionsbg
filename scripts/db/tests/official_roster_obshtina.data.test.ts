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
// it to person_role.place_code (migration 115, place_kind='obshtina'). These tests pin that
// chain end to end, because every link in it fails silently: a missing code just leaves the
// typed place NULL and the municipal roster
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
const INDEX_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../data/officials/municipal/index.json",
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
  "person_role carries a typed obshtina place for municipal roles",
  async () => {
    const [row] = await allRows<{ total: string; placed: string }>(
      `SELECT count(*) AS total,
            count(*) FILTER (
              WHERE place_kind = 'obshtina' AND place_code IS NOT NULL
            ) AS placed
       FROM person_role WHERE source = 'official_muni'`,
    );
    assert.equal(
      row.placed,
      row.total,
      `${Number(row.total) - Number(row.placed)} official_muni role(s) have no typed obshtina place — db:resolve:persons ran against a roster without obshtina codes, or the fill regressed`,
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
    const rows = await allRows<{ place_code: string }>(
      `SELECT DISTINCT place_code FROM person_role
        WHERE source = 'official_muni' AND place_kind = 'obshtina'`,
    );
    for (const { place_code } of rows)
      assert.ok(
        known.has(place_code),
        `person_role.place_code '${place_code}' is not an obshtina shard`,
      );
  },
);

// Set parity against the shards. This is the assertion that would have caught a name→code
// join regression: an official silently filed under the wrong municipality shows up here as
// one missing AND one extra, and both halves are still checked.
//
// ⚠️ IT IS NO LONGER SYMMETRIC, and the asymmetry is the point. The roster index accumulates
// while the shards carry only the sitting bench (scripts/officials/build_municipal_shards.ts
// `currentBench`), so `person_role` legitimately holds a municipal role for every official
// who has left since the register's first municipal year. Asserting equality would force the
// roster back to a snapshot — the state that, on the 2025→2026 rollover, dropped 334
// officials, orphaned 408 filings and 404'd their /person URLs.
//
// So: `missing` must still be EMPTY (a shard row absent from PG, or filed under another
// code, is the original defect), and every `extra` must be a departed official — present in
// the municipal index, absent from the bench. An extra that is in NO index at all is a real
// failure, and so is a count that drifts from the index's own retained figure.
test.skipIf(skip || !haveShards)(
  "every shard row is in Postgres under the same code, and the extras are exactly the departed",
  async () => {
    const rows = await allRows<{ place_code: string; ref: string }>(
      `SELECT place_code, ref FROM person_role
        WHERE source = 'official_muni' AND place_kind = 'obshtina'`,
    );
    const pg = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!pg.has(r.place_code)) pg.set(r.place_code, new Set());
      pg.get(r.place_code)!.add(r.ref);
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
      missing.slice(0, 5),
      [],
      `${missing.length} shard row(s) are absent from person_role, or filed under a different obshtina — the name→code join regressed`,
    );

    // Every extra must be an official the register's newest listing no longer names.
    const index = JSON.parse(readFileSync(INDEX_PATH, "utf8")) as {
      total: number;
      current?: { total: number };
      entries: { slug: string; descriptorYear?: number }[];
    };
    const benchYear = Math.max(
      0,
      ...index.entries.map((e) => e.descriptorYear ?? 0),
    );
    const departed = new Set(
      index.entries
        .filter((e) => (e.descriptorYear ?? 0) !== benchYear)
        .map((e) => e.slug),
    );
    const unexplained = extra.filter((s) => !departed.has(s.split("/")[1]));
    assert.deepEqual(
      unexplained.slice(0, 5),
      [],
      `${unexplained.length} person_role municipal row(s) are in no shard AND not a departed official — the roster gained someone from nowhere`,
    );
    // Pinned against the index's own figure so a roster that quietly stops accumulating —
    // or one that starts retaining people the index does not — fails here rather than
    // silently shrinking the person layer again.
    const retained = index.total - (index.current?.total ?? index.total);
    assert.equal(
      extra.length,
      retained,
      `${extra.length} departed official(s) in person_role but ${retained} retained in the index — the two disagree about who has left`,
    );
  },
);
