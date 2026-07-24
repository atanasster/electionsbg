// Correctness gate for the peer benchmark (097).
//
// This publishes "declared more than N% of peers" against a named person, so the controls
// are about the comparison being fair: same year, enough peers, one cohort per person.
//
// TESTING DISCIPLINE (inherited from stake_procurement.data.test.ts, which learned it the
// hard way): expectations are computed INDEPENDENTLY in TypeScript from raw rows — never by
// re-running the SQL under test. A test that calls person_cohort_key to check
// person_cohort_key is not a test.
//
// Auto-skips when Postgres is down or the benchmark is not built.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person_cohort_wealth') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_cohort_wealth",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / no cohort wealth";

afterAll(async () => {
  await end();
});

// THE PERCENTILE, recomputed in TypeScript from the raw distribution. This is the assertion
// that would catch an off-by-one in the rank, a peer set drawn from the wrong year, or a
// median taken over the wrong slice.
test.skipIf(skip)(
  "the published percentile matches an independent rank over the same-year peers",
  async () => {
    const served = await allRows<{
      slug: string;
      cohort: string;
      year: string;
      net: string;
      peers: string;
      median: string;
      pct: string | null;
    }>(`
      WITH target AS MATERIALIZED (
        SELECT DISTINCT p.slug
          FROM person_cohort_wealth cw
          JOIN person p ON p.person_id = cw.person_id
         WHERE p.status = 'active' AND p.is_public_figure
         LIMIT 300
      )
      SELECT t.slug,
             b ->> 'cohort' AS cohort,
             b ->> 'year' AS year,
             b ->> 'netEur' AS net,
             b ->> 'peers' AS peers,
             b ->> 'medianEur' AS median,
             b ->> 'percentile' AS pct
        FROM target t
        CROSS JOIN LATERAL (SELECT person_cohort_benchmark(t.slug) AS b) x
       WHERE b IS NOT NULL AND b <> 'null'::jsonb
    `);
    assert.ok(served.length > 0, "nothing served — fixture is empty");

    // The raw distribution, unaggregated.
    const all = await allRows<{
      cohort: string;
      period_year: number;
      net_eur: string;
    }>("SELECT cohort, period_year, net_eur FROM person_cohort_wealth");
    const bucket = new Map<string, number[]>();
    for (const r of all) {
      const k = `${r.cohort}\t${r.period_year}`;
      if (!bucket.has(k)) bucket.set(k, []);
      bucket.get(k)!.push(Number(r.net_eur));
    }

    for (const s of served) {
      const peers = bucket.get(`${s.cohort}\t${s.year}`) ?? [];
      const where = `${s.slug} (${s.cohort} ${s.year})`;
      assert.equal(
        Number(s.peers),
        peers.length,
        `peer count wrong for ${where}`,
      );

      // Percentile: share of peers strictly below, over peers-minus-self.
      const net = Number(s.net);
      if (peers.length >= 20) {
        const below = peers.filter((v) => v < net).length;
        const expected = Math.round((100 * below) / (peers.length - 1));
        assert.equal(Number(s.pct), expected, `percentile wrong for ${where}`);
      } else {
        assert.equal(
          s.pct,
          null,
          `percentile published below the floor for ${where}`,
        );
      }
    }
  },
);

// THE FLOOR is the safeguard: on a handful of peers a percentile is one person's filing.
test.skipIf(skip)("no percentile is published below 20 peers", async () => {
  const rows = await allRows<{ slug: string; peers: string; pct: string }>(`
    WITH target AS MATERIALIZED (
      SELECT DISTINCT p.slug
        FROM person_cohort_wealth cw
        JOIN person p ON p.person_id = cw.person_id
       WHERE p.status = 'active' AND p.is_public_figure
    )
    SELECT t.slug, b ->> 'peers' AS peers, b ->> 'percentile' AS pct
      FROM target t
      CROSS JOIN LATERAL (SELECT person_cohort_benchmark(t.slug) AS b) x
     WHERE b IS NOT NULL AND b <> 'null'::jsonb
       AND (b ->> 'percentile') IS NOT NULL
       AND (b ->> 'peers')::int < 20
  `);
  assert.deepEqual(
    rows.map((r) => `${r.slug}: ${r.pct}% off ${r.peers} peers`),
    [],
    "a percentile was published on too small a peer group",
  );
});

// ONE COHORT PER PERSON, and it must be the precedence winner — not whichever role the
// planner reached first. Computed here from person_role with the precedence written out.
test.skipIf(skip)(
  "each person lands in their highest-precedence cohort",
  async () => {
    const rows = await allRows<{
      person_id: string;
      assigned: string;
      roles: string[];
    }>(`
    SELECT cw.person_id::text,
           min(cw.cohort) AS assigned,
           (SELECT array_agg(DISTINCT r.source || ':' || r.role)
              FROM person_role r WHERE r.person_id = cw.person_id) AS roles
      FROM person_cohort_wealth cw
     GROUP BY cw.person_id
     LIMIT 4000
  `);
    const PREC: [string, string][] = [
      ["official_exec:cabinet", "cabinet"],
      ["official_exec:deputy_minister", "deputy_minister"],
      ["mp:mp", "mp"],
      ["official_exec:regional_governor", "regional_governor"],
      ["official_exec:agency_head", "agency_head"],
      ["official_muni:mayor", "mayor"],
      ["official_muni:councillor", "councillor"],
    ];
    const wrong = rows.filter((r) => {
      const roles = new Set(r.roles ?? []);
      // magistrate uses a source-only rule, so skip rows whose winner would be it.
      if ([...roles].some((x) => x.startsWith("magistrate:"))) return false;
      const expected = PREC.find(([k]) => roles.has(k))?.[1];
      return expected != null && expected !== r.assigned;
    });
    assert.deepEqual(
      wrong.slice(0, 10).map((w) => `${w.person_id}: got ${w.assigned}`),
      [],
      "a person was benchmarked outside their highest-precedence cohort",
    );
  },
);

// A person must never be compared across years — that would read inflation as wealth.
test.skipIf(skip)(
  "peers are drawn from the person's own year only",
  async () => {
    const [r] = await allRows<{ bad: string }>(`
    WITH target AS MATERIALIZED (
      SELECT DISTINCT p.slug
        FROM person_cohort_wealth cw
        JOIN person p ON p.person_id = cw.person_id
       WHERE p.status = 'active' AND p.is_public_figure
       LIMIT 200
    ),
    served AS (
      SELECT b ->> 'cohort' AS cohort, (b ->> 'year')::int AS yr,
             (b ->> 'peers')::int AS peers
        FROM target t
        CROSS JOIN LATERAL (SELECT person_cohort_benchmark(t.slug) AS b) x
       WHERE b IS NOT NULL AND b <> 'null'::jsonb
    )
    SELECT count(*)::text AS bad FROM served s
     WHERE s.peers <> (SELECT count(*) FROM person_cohort_wealth cw
                        WHERE cw.cohort = s.cohort AND cw.period_year = s.yr)
  `);
    assert.equal(
      Number(r.bad),
      0,
      "the peer set is not the person's own cohort-year",
    );
  },
);

// §6 PRIVACY GATE.
test.skipIf(skip)(
  "the serving function enforces the privacy gate",
  async () => {
    const hidden = await allRows<{ slug: string; r: unknown }>(`
    WITH target AS MATERIALIZED (
      SELECT DISTINCT p.slug
        FROM person_cohort_wealth cw
        JOIN person p ON p.person_id = cw.person_id
       WHERE p.status <> 'active' OR NOT p.is_public_figure
       LIMIT 50
    )
    SELECT t.slug, person_cohort_benchmark(t.slug) AS r FROM target t
  `);
    const leaked = hidden.filter((h) => h.r != null);
    assert.deepEqual(
      leaked.map((l) => l.slug),
      [],
      "a non-public / non-active person was served a benchmark",
    );
  },
);
