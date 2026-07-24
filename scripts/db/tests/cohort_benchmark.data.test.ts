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
import { allRows, end, withClient } from "../lib/pg";

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

    // The distribution rebuilt from SOURCE tables — person_wealth_year + person_role — not
    // from person_cohort_wealth, which is the artifact under test. Reading the matview here
    // would leave its rounding, its assets>0 rule, its tier gate and its cohort assignment
    // completely unchecked, which is the trap the two preceding steps fell into.
    //
    // ONE query returning every field: correlating two result sets by array index assumes an
    // ordering neither query promises, which silently mismatched rows on the first attempt.
    const all = await allRows<{
      person_id: string;
      cohort: string | null;
      period_year: number;
      tier: string;
      net_eur: string;
    }>(`
      SELECT w.person_id::text,
             w.period_year,
             w.tier,
             round(w.net_eur)::text AS net_eur,
             (SELECT CASE
                WHEN bool_or(r.source='official_exec' AND r.role='cabinet') THEN 'cabinet'
                WHEN bool_or(r.source='official_exec' AND r.role='deputy_minister') THEN 'deputy_minister'
                WHEN bool_or(r.source='mp') THEN 'mp'
                WHEN bool_or(r.source='official_exec' AND r.role='regional_governor') THEN 'regional_governor'
                WHEN bool_or(r.source='official_exec' AND r.role='agency_head') THEN 'agency_head'
                WHEN bool_or(r.source='official_muni' AND r.role='mayor') THEN 'mayor'
                WHEN bool_or(r.source='official_muni' AND r.role='councillor') THEN 'councillor'
              END FROM person_role r WHERE r.person_id = w.person_id) AS cohort
        FROM person_wealth_year w
       WHERE w.assets_eur > 0
    `);

    // Apply the tier gate independently (rule 0b): a filing counts toward a cohort only when
    // its own tier matches that cohort's office class.
    const TIER: Record<string, string> = {
      mp: "mp",
      mayor: "muni",
      councillor: "muni",
    };
    const bucket = new Map<string, { id: string; net: number }[]>();
    for (const r of all) {
      if (!r.cohort) continue;
      if (r.tier !== (TIER[r.cohort] ?? "exec")) continue;
      const k = `${r.cohort}\t${r.period_year}`;
      if (!bucket.has(k)) bucket.set(k, []);
      bucket.get(k)!.push({ id: r.person_id, net: Number(r.net_eur) });
    }

    // slug -> person_id, so self can be excluded by IDENTITY rather than by value.
    const ids = await allRows<{ slug: string; person_id: string }>(
      "SELECT slug, person_id::text FROM person WHERE slug = ANY($1)",
      [served.map((x) => x.slug)],
    );
    const idOf = new Map(ids.map((i) => [i.slug, i.person_id]));

    for (const s of served) {
      const slice = bucket.get(`${s.cohort}\t${s.year}`) ?? [];
      const me = idOf.get(s.slug);
      const peers = slice.filter((p) => p.id !== me).map((p) => p.net);
      const net = Number(s.net);
      const where = `${s.slug} (${s.cohort} ${s.year})`;
      assert.equal(
        Number(s.peers),
        peers.length,
        `peer count wrong for ${where}`,
      );

      if (peers.length >= 20) {
        const below = peers.filter((v) => v < net).length;
        const expected = Math.round((100 * below) / peers.length);
        // Compare as STRINGS: Number(null) is 0, so a withheld percentile would silently
        // satisfy an expected 0 and let a broken floor through.
        assert.equal(s.pct, String(expected), `percentile wrong for ${where}`);
        assert.notEqual(
          s.median,
          null,
          `median withheld above the floor for ${where}`,
        );
      } else {
        assert.equal(
          s.pct,
          null,
          `percentile published below the floor for ${where}`,
        );
        assert.equal(
          s.median,
          null,
          `median published below the floor for ${where} — one peer's exact figure`,
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
     -- minus one: the person themselves is not their own peer.
     WHERE s.peers <> (SELECT count(*) - 1 FROM person_cohort_wealth cw
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

    // The assertion above is [] === [] whenever no gated-out person has cohort wealth —
    // which is the case on this corpus, so deleting the gate from the SQL would leave it
    // green. Construct the condition instead: flip a real person non-public inside a
    // transaction and require them to disappear.
    //
    // One CLIENT, statement by statement: a multi-statement string returns only the FIRST
    // result set, so a single allRows() call would read BEGIN's empty result and pass
    // without testing anything.
    const served = await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(
          `UPDATE person SET is_public_figure = false
            WHERE person_id = (SELECT person_id FROM person_cohort_wealth LIMIT 1)`,
        );
        const r = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM person p
             JOIN person_cohort_wealth cw ON cw.person_id = p.person_id
            WHERE NOT p.is_public_figure
              AND person_cohort_benchmark(p.slug) <> 'null'::jsonb`,
        );
        return Number(r.rows[0].n);
      } finally {
        await c.query("ROLLBACK");
      }
    });
    assert.equal(
      served,
      0,
      "a person flipped to non-public was still served — the gate is not enforced",
    );
  },
);
