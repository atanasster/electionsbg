// The MP serving surfaces (104_mp_roster.sql + 105_mp_serving.sql) that replace
// data/parliament/{index,assets-rankings,mp-cars}.json and the by-id / declarations /
// mp-assets shard trees. Plan: docs/plans/persons-pg-retirement-v1.md (Tier 0.3).
//
// These pin the things that were measurably wrong or measurably surprising while
// building it — each silent, each leaving a populated matview and a rendering page:
//
//   1. THE FIGURES DO NOT MATCH THE JSON, and must not be "fixed" into matching.
//      build_assets_rankings.ts folds company shares (declaration table 10) into
//      totalAssetsEur; person_wealth_year sums declaration_asset only. Measured on this
//      corpus: for all 580 MPs where PG's representative filing is also present in the
//      JSON shard, the assets-only totals reconcile EXACTLY, and 154 of them declare
//      table-10 stakes the JSON would have added. Test (1) re-derives that reconciliation
//      from the shards, so a NEW divergence (a parser change, a category remap) fails
//      while this known and documented one does not.
//   2. TWO YEAR COLUMNS. latest_declaration_year is when a filing was LODGED,
//      period_year is what it COVERS, and they disagree for 421 of the 767 MPs the JSON
//      ranks. The first draft used period_year under the "declaration year" name, which
//      silently shifted every annual filing's label by a year.
//   3. THE ns FAN-OUT. Every rollup is emitted once per parliament plus a literal 'all'
//      bucket, because the registry scopes with a plain equality. An unscoped query
//      counts each MP once per parliament they sat in — tests (3) and (4) pin the
//      partition so a lost 'all' row or a duplicated bucket is caught here rather than
//      as a wrong number on a dashboard.
//
// Counts quoted are snapshots as of 2026-07; the assertions are invariants or ceilings
// so a ±1 drift does not fail the suite.
//
// Auto-skips when Postgres is down or unloaded — like the other *.data.test.ts gates.
//
//   npm run test:data

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.mp_assets_rankings_table') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM mp_assets_rankings_table",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / mp_assets_rankings empty";

afterAll(async () => {
  await end();
});

interface JsonAsset {
  category: string;
  valueEur: number | null;
}
interface JsonStake {
  table: string;
  valueEur: number | null;
}
interface JsonDeclaration {
  sourceUrl: string;
  assets?: JsonAsset[];
  ownershipStakes?: JsonStake[];
}

// (1) The wealth figures reconcile to the SAME filing in the JSON shard once company
// shares are excluded — i.e. the only difference between PG and the retiring JSON is the
// documented table-10 fold, not an arithmetic or currency error.
test.skipIf(skip)(
  "leaderboard figures reconcile to the source filing, minus the table-10 stake fold",
  async () => {
    const rows = await allRows<{
      mp_id: number;
      source_url: string;
      assets_eur: string;
      debts_eur: string;
      net_eur: string;
    }>(
      `SELECT r.ref::integer AS mp_id, d.source_url,
              round(w.assets_eur) AS assets_eur,
              round(w.debts_eur)  AS debts_eur,
              round(w.net_eur)    AS net_eur
         FROM person_role r
         JOIN person p ON p.person_id = r.person_id
                      AND p.status = 'active' AND p.is_public_figure
         JOIN LATERAL (
                SELECT * FROM person_wealth_year w
                 WHERE w.person_id = p.person_id
                 ORDER BY w.period_year DESC, w.declaration_id DESC
                 LIMIT 1) w ON true
         JOIN declaration d ON d.declaration_id = w.declaration_id
        WHERE r.source = 'mp' AND r.ref ~ '^[0-9]+$'`,
    );
    assert.ok(rows.length > 500, `only ${rows.length} MPs carry a wealth row`);

    let checked = 0;
    let stakeBearing = 0;
    const mismatches: string[] = [];
    for (const row of rows) {
      const file = path.join(
        ROOT,
        "data/parliament/declarations",
        `${row.mp_id}.json`,
      );
      // The representative filing may live in the exec/muni tier, whose shards are not
      // in this tree — those MPs simply are not part of this reconciliation.
      if (!existsSync(file)) continue;
      const decls = JSON.parse(readFileSync(file, "utf8")) as JsonDeclaration[];
      const d = decls.find((x) => x.sourceUrl === row.source_url);
      if (!d) continue;
      checked++;

      const assets = (d.assets ?? [])
        .filter((a) => a.category !== "debt")
        .reduce((s, a) => s + (a.valueEur ?? 0), 0);
      const debts = (d.assets ?? [])
        .filter((a) => a.category === "debt")
        .reduce((s, a) => s + (a.valueEur ?? 0), 0);
      if ((d.ownershipStakes ?? []).some((x) => x.table === "10")) {
        stakeBearing++;
      }
      // Both sides rounded to whole euros; allow 1 for the rounding itself.
      if (Math.abs(assets - debts - Number(row.net_eur)) > 1) {
        mismatches.push(
          `mp ${row.mp_id}: shard net ${Math.round(assets - debts)} vs PG ${row.net_eur} (${row.source_url})`,
        );
      }
    }

    assert.ok(checked > 400, `only ${checked} filings were cross-checkable`);
    assert.deepEqual(
      mismatches.slice(0, 5),
      [],
      `${mismatches.length}/${checked} filings do not reconcile against their own shard — ` +
        `this is NOT the known stake fold (that one is excluded from both sides here)`,
    );
    // The fold is real and material: if this ever hits zero, either the parser stopped
    // emitting table-10 stakes or the shards were regenerated, and the header's
    // explanation of why the leaderboard differs from the JSON is stale.
    assert.ok(
      stakeBearing > 50,
      `only ${stakeBearing} reconciled MPs declare table-10 stakes — the documented ` +
        `divergence from assets-rankings.json may no longer exist`,
    );
  },
);

// (2) The two year columns are different facts. Conflating them shifts every annual
// filing's label by a year, which is exactly what the first draft did.
test.skipIf(skip)(
  "latest_declaration_year is the filing year, period_year is the covered period",
  async () => {
    const [r] = await allRows<{ differing: string; inverted: string }>(
      `SELECT count(*) FILTER (WHERE latest_declaration_year <> period_year) AS differing,
              count(*) FILTER (WHERE latest_declaration_year < period_year)  AS inverted
         FROM mp_assets_rankings_table
        WHERE ns = 'all' AND latest_declaration_year IS NOT NULL`,
    );
    assert.ok(
      Number(r.differing) > 100,
      `only ${r.differing} MPs have a filing year different from their covered period — ` +
        `the two columns have probably collapsed onto one source`,
    );
    // A filing is lodged in or after the period it covers, never before it.
    assert.equal(
      Number(r.inverted),
      0,
      "some rows report a filing year EARLIER than the period they cover",
    );
  },
);

// (3) The ns fan-out partitions cleanly: 'all' is one row per MP, and it is the roster.
test.skipIf(skip)(
  "ns='all' holds exactly one row per rostered MP",
  async () => {
    const [r] = await allRows<{ rows: string; mps: string; roster: string }>(
      `SELECT (SELECT count(*) FROM mp_assets_rankings_table WHERE ns = 'all')          AS rows,
            (SELECT count(DISTINCT mp_id) FROM mp_assets_rankings_table WHERE ns='all') AS mps,
            (SELECT count(*) FROM mp_profile)                                        AS roster`,
    );
    assert.equal(
      r.rows,
      r.mps,
      "ns='all' contains duplicate mp_id rows — the fan-out is leaking into the national bucket",
    );
    assert.equal(
      r.rows,
      r.roster,
      "the national bucket does not cover the whole roster; an MP without declarations " +
        "must still appear (with NULL figures), the way the JSON could not express",
    );
  },
);

// (4) Every non-'all' bucket is exactly the MPs whose ns_folders contain it. A drift here
// makes a per-parliament leaderboard quietly list the wrong people.
test.skipIf(skip)(
  "per-parliament buckets match ns_folders membership",
  async () => {
    const [r] = await allRows<{ missing: string; extra: string }>(
      `WITH expected AS (
       SELECT m.mp_id, f AS ns FROM mp_profile m CROSS JOIN LATERAL unnest(m.ns_folders) AS f
     ),
     actual AS (
       SELECT mp_id, ns FROM mp_assets_rankings_table WHERE ns <> 'all'
     )
     SELECT (SELECT count(*) FROM expected e
              WHERE NOT EXISTS (SELECT 1 FROM actual a
                                 WHERE a.mp_id = e.mp_id AND a.ns = e.ns)) AS missing,
            (SELECT count(*) FROM actual a
              WHERE NOT EXISTS (SELECT 1 FROM expected e
                                 WHERE e.mp_id = a.mp_id AND e.ns = a.ns)) AS extra`,
    );
    assert.equal(
      Number(r.missing),
      0,
      "MPs missing from a parliament they sat in",
    );
    assert.equal(
      Number(r.extra),
      0,
      "MPs listed under a parliament they never sat in",
    );
  },
);

// (5) No declared vehicle is silently dropped. mp_cars_table inner-joins mp_profile, so a
// car whose mp_id is absent from the roster vanishes without an error — the loader warns,
// this fails.
test.skipIf(skip)(
  "every mp_car row reaches the national cars bucket",
  async () => {
    const [r] = await allRows<{ src: string; served: string }>(
      `SELECT (SELECT count(*) FROM mp_car) AS src,
            (SELECT count(*) FROM mp_cars_table WHERE ns = 'all') AS served`,
    );
    assert.equal(
      r.src,
      r.served,
      "car rows were dropped by the join to mp_profile — mp-cars.json and index.json " +
        "were built from different scrapes",
    );
  },
);

// (5b) The cars fan-out is the one that replaces a CLIENT-side filter
// (MpCarsScreen.tsx:49) and carries the higher inflation factor (3.2×), so its
// per-parliament membership gets the same anti-join as the leaderboard's.
test.skipIf(skip)(
  "cars per-parliament buckets match the owning MP's ns_folders",
  async () => {
    const [r] = await allRows<{ missing: string; extra: string }>(
      `WITH expected AS (
         SELECT c.car_id, f AS ns
           FROM mp_car c
           JOIN mp_profile m ON m.mp_id = c.mp_id
           CROSS JOIN LATERAL unnest(m.ns_folders) AS f
       ),
       actual AS (SELECT car_id, ns FROM mp_cars_table WHERE ns <> 'all')
       SELECT (SELECT count(*) FROM expected e
                WHERE NOT EXISTS (SELECT 1 FROM actual a
                                   WHERE a.car_id = e.car_id AND a.ns = e.ns)) AS missing,
              (SELECT count(*) FROM actual a
                WHERE NOT EXISTS (SELECT 1 FROM expected e
                                   WHERE e.car_id = a.car_id AND e.ns = a.ns)) AS extra`,
    );
    assert.equal(
      Number(r.missing),
      0,
      "cars missing from a parliament their owner sat in",
    );
    assert.equal(
      Number(r.extra),
      0,
      "cars listed under a parliament their owner never sat in",
    );
  },
);

// (6) mp_entry answers the same for both key spaces. The whole reason it takes two keys
// is that /person holds a slug and the roster holds parliament.bg's id; if they diverge,
// PersonDashboard and the legacy shard render different MPs.
test.skipIf(skip)("mp_entry(id) and mp_entry(slug) agree", async () => {
  const rows = await allRows<{ by_id: unknown; by_slug: unknown }>(
    `SELECT mp_entry(m.mp_id, NULL) AS by_id, mp_entry(NULL, p.slug) AS by_slug
       FROM mp_profile m
       JOIN person_role r ON r.source = 'mp' AND r.ref = m.mp_id::text
       JOIN person p ON p.person_id = r.person_id
                    AND p.status = 'active' AND p.is_public_figure
      -- The two MPs who hold a second parliament.bg id are excluded: a slug lookup
      -- deliberately returns their sitting/newest entry, so the two keys cannot agree
      -- for them and that is documented behaviour, not a defect.
      WHERE (SELECT count(*) FROM person_role r2
              WHERE r2.person_id = p.person_id AND r2.source = 'mp') = 1
      ORDER BY m.mp_id
      LIMIT 200`,
  );
  assert.ok(
    rows.length > 100,
    "too few MPs resolved to a person to be meaningful",
  );
  for (const row of rows) {
    assert.deepEqual(row.by_slug, row.by_id);
  }

  const [absent] = await allRows<{ r: unknown }>(
    "SELECT mp_entry(999999999, NULL) AS r",
  );
  assert.equal(
    absent.r,
    null,
    "an unknown mp id must return NULL, not an empty object",
  );
});

// (7) mp_declarations is the merge the client used to do by hand: one row per filing,
// deduped by sourceUrl, newest first.
test.skipIf(skip)(
  "mp_declarations returns each filing once, newest first",
  async () => {
    const [row] = await allRows<{ slug: string }>(
      `SELECT p.slug
       FROM person p
       JOIN declaration d ON d.person_id = p.person_id
      WHERE p.status = 'active' AND p.is_public_figure
      GROUP BY p.slug
     HAVING count(*) >= 3
      ORDER BY count(*) DESC
      LIMIT 1`,
    );
    const [r] = await allRows<{ filings: unknown[] }>(
      "SELECT mp_declarations($1) AS filings",
      [row.slug],
    );
    const filings = r.filings as Array<{
      sourceUrl: string;
      year: number;
      fiscalYear: number | null;
    }>;
    assert.ok(
      filings.length >= 3,
      "expected the multi-filing person's whole timeline",
    );

    const urls = filings.map((f) => f.sourceUrl);
    assert.equal(
      new Set(urls).size,
      urls.length,
      "a filing appears twice — source_url is UNIQUE in `declaration`, so this can only " +
        "be a join fanning out",
    );

    const periods = filings.map((f) => f.fiscalYear ?? f.year);
    assert.deepEqual(
      periods,
      [...periods].sort((a, b) => b - a),
      "filings are not ordered newest-covered-period first",
    );
  },
);

// (8) mp_assets agrees with the leaderboard for the same human, and always emits all
// eight categories. A missing key and a zero read the same to a person and differently
// to a chart.
test.skipIf(skip)(
  "mp_assets matches the leaderboard row and zero-fills categories",
  async () => {
    const rows = await allRows<{ slug: string; net_worth_eur: string }>(
      `SELECT person_slug AS slug, net_worth_eur
       FROM mp_assets_rankings_table
      WHERE ns = 'all' AND person_slug IS NOT NULL AND net_worth_eur IS NOT NULL
      ORDER BY net_worth_eur DESC
      LIMIT 25`,
    );
    assert.ok(
      rows.length > 10,
      "leaderboard has too few resolved rows to check",
    );

    const CATEGORIES = [
      "real_estate",
      "vehicle",
      "cash",
      "bank",
      "receivable",
      "debt",
      "investment",
      "security",
    ];
    for (const row of rows) {
      const [r] = await allRows<{ rollup: Record<string, unknown> }>(
        "SELECT mp_assets($1) AS rollup",
        [row.slug],
      );
      const rollup = r.rollup as {
        netWorthEur: number;
        byCategory: Record<string, { count: number; totalEur: number }>;
      };
      assert.equal(
        Number(rollup.netWorthEur),
        Number(row.net_worth_eur),
        `mp_assets and the leaderboard disagree for ${row.slug} — both read ` +
          `person_wealth_year, so they cannot`,
      );
      assert.deepEqual(
        Object.keys(rollup.byCategory).sort(),
        [...CATEGORIES].sort(),
        `${row.slug} is missing a byCategory bucket`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Shard parity. The plan (persons-pg-retirement-v1.md:168-171) asks for a parity check
// per family, and the tests above are internal-consistency checks — they compare a fn to
// another PG surface reading the same rows, so a field that silently renames, drops or
// reformats passes all of them. These compare each fn to the artifact it retires.

// (9) mp_entry vs data/parliament/by-id/<id>.json, field by field, in both directions.
test.skipIf(skip)("mp_entry reproduces the by-id shard", async () => {
  const rows = await allRows<{
    mp_id: number;
    entry: Record<string, unknown> | null;
  }>(
    "SELECT mp_id, mp_entry(mp_id, NULL) AS entry FROM mp_profile ORDER BY mp_id",
  );

  // personSlug is additive (the shard predates the person layer). scrapedAt is compared
  // as an INSTANT below, not as text: Postgres renders "+00:00" where the shard wrote
  // "Z" — same moment, different spelling, and 105 documents the choice.
  const IGNORED = new Set(["personSlug", "scrapedAt"]);
  const diffs: string[] = [];
  let compared = 0;

  for (const { mp_id, entry } of rows) {
    const file = path.join(ROOT, "data/parliament/by-id", `${mp_id}.json`);
    if (!existsSync(file)) continue;
    assert.ok(entry, `mp ${mp_id}: shard exists but mp_entry returned NULL`);
    const shard = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    compared++;
    for (const k of Object.keys(shard)) {
      if (!(k in entry)) {
        diffs.push(`mp ${mp_id}: shard key '${k}' missing from mp_entry`);
        continue;
      }
      if (IGNORED.has(k)) continue;
      // The ONE deliberate value difference: parliament.bg publishes an unknown date of
      // birth as the zero date "0000-00-00", which Postgres rejects outright, so the
      // loader stores NULL. Accepted only for a shard value that is genuinely not a
      // date — a real date turning into NULL is still a failure.
      if (k === "birthDate" && typeof shard[k] === "string") {
        const raw = shard[k] as string;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw.startsWith("0000")) {
          if (entry[k] !== null) {
            diffs.push(
              `mp ${mp_id}.birthDate: unparsable shard value ${JSON.stringify(raw)} was not stored as NULL`,
            );
          }
          continue;
        }
      }
      if (JSON.stringify(entry[k]) !== JSON.stringify(shard[k])) {
        diffs.push(
          `mp ${mp_id}.${k}: shard ${JSON.stringify(shard[k])} vs fn ${JSON.stringify(entry[k])}`,
        );
      }
    }
    const shardAt = shard.scrapedAt as string | null;
    const fnAt = entry.scrapedAt as string | null;
    if (shardAt && +new Date(fnAt as string) !== +new Date(shardAt)) {
      diffs.push(`mp ${mp_id}.scrapedAt is a different instant`);
    }
  }

  assert.ok(compared > 2000, `only ${compared} shards were compared`);
  assert.deepEqual(
    diffs.slice(0, 5),
    [],
    `${diffs.length}/${compared} roster entries diverge from their shard`,
  );
});

// (10) mp_declarations vs data/parliament/declarations/<id>.json. The fn spans tiers by
// design, so the shard's filings must be a SUBSET of what it returns — each appearing
// exactly once. A dropped filing is the failure this catches.
test.skipIf(skip)(
  "mp_declarations covers every filing in the shard",
  async () => {
    const rows = await allRows<{ mp_id: number; slug: string }>(
      `SELECT l.mp_id, l.person_slug AS slug FROM mp_person_link l ORDER BY l.mp_id`,
    );
    const diffs: string[] = [];
    let compared = 0;

    for (const { mp_id, slug } of rows) {
      const file = path.join(
        ROOT,
        "data/parliament/declarations",
        `${mp_id}.json`,
      );
      if (!existsSync(file)) continue;
      const shard = JSON.parse(readFileSync(file, "utf8")) as JsonDeclaration[];
      if (!shard.length) continue;
      compared++;
      const [r] = await allRows<{ filings: Array<{ sourceUrl: string }> }>(
        "SELECT mp_declarations($1) AS filings",
        [slug],
      );
      const served = r.filings.map((f) => f.sourceUrl);
      const servedSet = new Set(served);
      assert.equal(
        servedSet.size,
        served.length,
        `mp ${mp_id}: mp_declarations returned a duplicate sourceUrl`,
      );
      for (const d of shard) {
        if (!servedSet.has(d.sourceUrl)) {
          diffs.push(`mp ${mp_id}: shard filing ${d.sourceUrl} is not served`);
        }
      }
    }

    assert.ok(
      compared > 500,
      `only ${compared} declaration shards were compared`,
    );
    assert.deepEqual(
      diffs.slice(0, 5),
      [],
      `${diffs.length} shard filings are missing from mp_declarations`,
    );
  },
);

// (11) mp_assets vs data/parliament/mp-assets/<id>.json. Counts must match exactly; the
// euro totals may differ ONLY by the documented table-10 stake fold, which lands in the
// `security` bucket — so every OTHER bucket has to reconcile within the rounding
// tolerance, and that is what pins the divergence to one place.
test.skipIf(skip)(
  "mp_assets reproduces the shard's byCategory, modulo the stake fold",
  async () => {
    const rows = await allRows<{ mp_id: number; slug: string }>(
      `SELECT l.mp_id, l.person_slug AS slug FROM mp_person_link l ORDER BY l.mp_id`,
    );
    const diffs: string[] = [];
    let compared = 0;

    for (const { mp_id, slug } of rows) {
      const file = path.join(
        ROOT,
        "data/parliament/mp-assets",
        `${mp_id}.json`,
      );
      if (!existsSync(file)) continue;
      const shard = JSON.parse(readFileSync(file, "utf8")) as {
        sourceUrl: string;
        byCategory: Record<
          string,
          { count: number; valuedCount: number; totalEur: number }
        >;
      };
      const [r] = await allRows<{
        rollup: {
          sourceUrl: string | null;
          byCategory: Record<
            string,
            { count: number; valuedCount: number; totalEur: number }
          >;
        } | null;
      }>("SELECT mp_assets($1) AS rollup", [slug]);
      const rollup = r.rollup;
      if (!rollup) continue;
      // Only comparable when both picked the SAME filing: person_wealth_year ranks by the
      // period covered and spans tiers, so it legitimately prefers a different one for
      // ~40% of MPs. Those are covered by test (1), which reconciles against whichever
      // filing PG chose.
      if (rollup.sourceUrl !== shard.sourceUrl) continue;
      compared++;

      for (const [cat, want] of Object.entries(shard.byCategory)) {
        const got = rollup.byCategory[cat];
        if (!got) {
          diffs.push(`mp ${mp_id}: category '${cat}' missing from mp_assets`);
          continue;
        }
        // `security` is where build_assets_rankings.ts folded table-10 company shares, so
        // its count and total legitimately differ. Everything else must match.
        if (cat === "security") continue;
        if (got.count !== want.count || got.valuedCount !== want.valuedCount) {
          diffs.push(
            `mp ${mp_id}.${cat}: shard ${want.count}/${want.valuedCount} items vs fn ${got.count}/${got.valuedCount}`,
          );
        }
        if (Math.abs(Number(got.totalEur) - want.totalEur) > 1) {
          diffs.push(
            `mp ${mp_id}.${cat}: shard €${Math.round(want.totalEur)} vs fn €${got.totalEur}`,
          );
        }
      }
    }

    assert.ok(
      compared > 200,
      `only ${compared} mp-assets shards were comparable`,
    );
    assert.deepEqual(
      diffs.slice(0, 5),
      [],
      `${diffs.length} category rollups diverge from their shard outside the stake fold`,
    );
  },
);

// (12) The REGISTRY names real columns. functions/db_table.test.js validates the registry
// against itself and says so — "Validating projection names needs the live schema, not
// the registry" — so a typo in a `columns` key or a `select` entry surfaces only as a
// 42703 at request time. This is the gate that needs a database, so it lives here.
test.skipIf(skip)("REGISTRY columns exist on the mp matviews", async () => {
  const { REGISTRY } = await import("../../../functions/db_table.js");

  for (const name of ["mp_assets_rankings", "mp_cars"]) {
    const r = REGISTRY[name];
    assert.ok(r, `${name} is no longer a registry resource`);
    const cols = await allRows<{ attname: string }>(
      `SELECT attname FROM pg_attribute
        WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped`,
      [r.base],
    );
    const have = new Set(cols.map((c) => c.attname));
    for (const [id, def] of Object.entries(r.columns)) {
      assert.ok(
        have.has(def.col ?? id),
        `${name}: column '${id}' is not on ${r.base}`,
      );
    }
    for (const id of r.select) {
      assert.ok(have.has(id), `${name}: select '${id}' is not on ${r.base}`);
    }

    // Every search:true column needs its own trigram index. buildWhere ORs them into one
    // predicate, so a single unindexed arm forces a seq scan over the whole OR — which
    // does not merely slow that column down, it stops the OTHERS' indexes being used
    // (measured in 100_officials_rankings.sql). Adding a search column without an index
    // is therefore a silent regression for the columns that already had one.
    for (const [id, def] of Object.entries(r.columns)) {
      if (!def.search) continue;
      const physical = def.col ?? id;
      const [idx] = await allRows<{ n: string }>(
        `SELECT count(*) n FROM pg_index i
           JOIN pg_class c ON c.oid = i.indexrelid
           JOIN pg_am am ON am.oid = c.relam
          WHERE i.indrelid = $1::regclass
            AND am.amname = 'gin'
            AND pg_get_indexdef(i.indexrelid) LIKE '%' || $2 || ' gin_trgm_ops%'`,
        [r.base, physical],
      );
      assert.ok(
        Number(idx.n) > 0,
        `${name}: search column '${id}' has no gin_trgm_ops index on ${r.base}.${physical}`,
      );
    }
  }
});

// mp-networth-rank route SQL (persons-pg-retirement-v1 T2.2): the MP's rank + cohort size +
// median within one parliament's assets slice, which replaced the client rankIn/medianOf over
// the retired assets-rankings.json. Pins that the top MP ranks 1, cohortSize is the ns's
// non-null count, an out-of-slice id gets a null rank (cohort/median still present), and that
// numeric-in-jsonb deserialises as a JS number (not a node-pg numeric string).
test.skipIf(skip)(
  "mp-networth-rank: top MP ranks 1; cohort/median/typeof pinned",
  async () => {
    const ns = "52";
    const runRank = async (
      mpId: number,
    ): Promise<{
      rank: number | null;
      cohortSize: number;
      median: number | null;
    }> => {
      const [row] = await allRows<{
        r: { rank: number | null; cohortSize: number; median: number | null };
      }>(
        `WITH slice AS (
           SELECT mp_id, net_worth_eur FROM mp_assets_rankings_table
           WHERE ns = $2 AND net_worth_eur IS NOT NULL
         ),
         me AS (SELECT net_worth_eur AS v FROM slice WHERE mp_id = $1)
         SELECT jsonb_build_object(
           'rank', CASE WHEN (SELECT v FROM me) IS NULL THEN NULL
                        ELSE (SELECT count(*) FROM slice
                               WHERE net_worth_eur > (SELECT v FROM me)) + 1 END,
           'cohortSize', (SELECT count(*) FROM slice),
           'median', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY net_worth_eur)
                      FROM slice)
         ) AS r`,
        [mpId, ns],
      );
      return row.r;
    };

    const [top] = await allRows<{ mp_id: number }>(
      `SELECT mp_id FROM mp_assets_rankings_table
        WHERE ns = $1 AND net_worth_eur IS NOT NULL
        ORDER BY net_worth_eur DESC LIMIT 1`,
      [ns],
    );
    assert.ok(top?.mp_id, `no ranked MP in ns ${ns}`);

    const topRank = await runRank(top.mp_id);
    assert.equal(topRank.rank, 1, "the top-net-worth MP must rank 1");

    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM mp_assets_rankings_table WHERE ns=$1 AND net_worth_eur IS NOT NULL",
      [ns],
    );
    assert.equal(
      topRank.cohortSize,
      Number(c.n),
      "cohortSize must equal the ns non-null count",
    );
    assert.equal(
      typeof topRank.median,
      "number",
      "median must deserialise as a number, not a node-pg numeric string",
    );

    const absent = await runRank(-1);
    assert.equal(absent.rank, null, "an out-of-slice mp_id has a null rank");
    assert.equal(
      absent.cohortSize,
      Number(c.n),
      "cohort still present for a null rank",
    );
  },
);
