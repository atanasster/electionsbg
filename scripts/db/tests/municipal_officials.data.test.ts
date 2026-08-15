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

// Deliberately gated on the table EXISTING, not on it having rows. Folding "0 rows" into
// the skip condition — the obvious shape, and the one the sibling gates use — means a
// matview that silently produced nothing makes every test below skip GREEN, which is the
// one failure this file most needs to report. Emptiness is asserted as a real test instead.
const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.municipal_officials_table') IS NOT NULL AS ok",
    );
    return Boolean(t?.ok);
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / matview absent";
const haveShards = existsSync(SHARD_DIR);

afterAll(async () => {
  await end();
});

// An empty matview is a silent total failure, so it is an assertion, not a skip.
test.skipIf(skip)("the roster is not empty", async () => {
  const [c] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM municipal_officials_table",
  );
  assert.ok(
    Number(c.n) > 5_000,
    `municipal_officials_table has ${c.n} rows — the matview produced (almost) nothing`,
  );
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
//
// AGAINST THE BENCH VIEW, NOT THE MATVIEW, and the distinction is the point rather than a
// convenience. The matview is the whole ACCUMULATED roster — the person layer, the
// council-vote join and the two municipal-officials-*-index routes all need an official who
// has left — while the shards carry only the sitting bench
// (build_municipal_shards.currentBench) and `municipal_officials_current` is the half the
// municipality page serves. So the shards' counterpart is the view.
//
// This test read the matview until the 2025→2026 rollover landed, when it reported 334
// extra / 0 missing / 0 field mismatches. That was not a stale database: the roster had
// just started accumulating and nothing on the serving side could tell the two cohorts
// apart, so all 6,647 were published as sitting. Re-pointing it at the view is what makes
// the assertion mean "the page shows the bench"; the retained cohort is asserted below
// rather than dropped from the file, so neither half can go missing unnoticed.
test.skipIf(skip || !haveShards)(
  "per-obshtina membership and roles match the shards exactly",
  async () => {
    // EVERY published field, not just the key columns. The first cut of this test
    // compared obshtina/official_slug/role only — the three that happened to be correct —
    // and so reported "exact parity" while latest_declaration_year was a year behind on
    // 98% of rows, role_raw/municipality were stamped from the wrong seat for anyone
    // holding two, and district was missing entirely. Set membership is not parity.
    type Row = {
      obshtina: string;
      official_slug: string;
      role: string;
      role_raw: string | null;
      municipality: string | null;
      latest_declaration_year: number | null;
      district: string | null;
    };
    const rows = await allRows<Row>(
      `SELECT obshtina, official_slug, role, role_raw, municipality,
              latest_declaration_year, district
         FROM municipal_officials_current`,
    );
    const pg = new Map<string, Map<string, Row>>();
    for (const r of rows) {
      if (!pg.has(r.obshtina)) pg.set(r.obshtina, new Map());
      pg.get(r.obshtina)!.set(r.official_slug, r);
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
        entries?: {
          slug?: string;
          role?: string;
          roleRaw?: string;
          municipality?: string;
          latestDeclarationYear?: number;
          district?: string;
        }[];
      };
      const code = shard.obshtina ?? f.replace(/\.json$/, "");
      const pm = pg.get(code) ?? new Map<string, Row>();
      const seen = new Set<string>();
      for (const e of shard.entries ?? []) {
        if (!e.slug) continue;
        jsonEntries++;
        seen.add(e.slug);
        const got = pm.get(e.slug);
        if (!got) {
          missing.push(`${code}/${e.slug}`);
          continue;
        }
        const cmp: [string, unknown, unknown][] = [
          ["role", e.role, got.role],
          ["roleRaw", e.roleRaw ?? null, got.role_raw],
          ["municipality", e.municipality ?? null, got.municipality],
          [
            "year",
            e.latestDeclarationYear ?? null,
            got.latest_declaration_year,
          ],
          ["district", e.district ?? null, got.district],
        ];
        for (const [field, want, have] of cmp)
          if (want !== have)
            roleDiff.push(`${e.slug}.${field}: json=${want} pg=${have}`);
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
      `roster drifted from the shards (${missing.length} missing, ${extra.length} extra, ${roleDiff.length} field mismatches)`,
    );
  },
);

// The other half of the split. The bench view is what a municipality page serves; the
// matview is what the header search, the ChmiFeed name lookup and the person layer read,
// and it must keep the officials the newest register listing no longer names.
//
// Without this, the parity test above is satisfiable by throwing the retention away —
// `sitting = true` for the bench and the retained cohort simply deleted from the roster
// would pass it. That is the exact defect the roster's accumulation exists to prevent
// (scripts/officials/municipal_roster_retention.test.ts): on the 2025→2026 rollover the
// single-year snapshot dropped 334 councillors, orphaned 408 of their filings with a NULL
// person_id and 404'd 321 /person URLs that had been served. So both cohorts are asserted.
test.skipIf(skip)("the retained cohort is excluded, not deleted", async () => {
  const [c] = await allRows<{ total: string; bench: string }>(
    `SELECT count(*) AS total, count(*) FILTER (WHERE is_sitting) AS bench
       FROM municipal_officials_table`,
  );
  const total = Number(c.total);
  const bench = Number(c.bench);

  assert.ok(
    bench > 5_000,
    `only ${bench} sitting listings — the bench looks truncated`,
  );

  // A retained cohort of zero is legitimate ONLY before the first rollover: every entry
  // carries the current descriptorYear, so currentBench returns all of them. Once the
  // roster spans two register years the two counts must differ, or `sitting` is being
  // written from something that cannot discriminate.
  const [y] = await allRows<{ n: string }>(
    `SELECT count(DISTINCT latest_declaration_year) n
       FROM municipal_officials_table WHERE latest_declaration_year IS NOT NULL`,
  );
  if (Number(y.n) > 1) {
    assert.ok(
      total > bench,
      `the roster spans ${y.n} declaration years but every one of its ${total} listings is ` +
        `sitting — official_roster.sitting is not discriminating (did the loader run?)`,
    );
  }

  // And the retained are REACHABLE: a person the bench excludes must still resolve, or the
  // header search and the /person link that made retention worth doing are gone with them.
  const [orphan] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM municipal_officials_table
      WHERE NOT is_sitting AND person_slug IS NULL`,
  );
  assert.equal(
    Number(orphan.n),
    0,
    "a retained listing has no person_slug — it is in the roster but reaches no /person page",
  );
});
