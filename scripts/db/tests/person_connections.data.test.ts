// Gate for person_connections (084) — the person↔person company graph behind the Connections
// component on /person/{slug} and the personConnections AI tool.
//
//   npm run test:data
//
// Requires the Postgres store + `db:resolve:persons` + the tr/ngo bridge; auto-skips when
// Postgres or the person layer is absent — like the other *.data.test.ts gates.
//
// IT SKIPS ON THE SOURCE, NEVER ON THE TARGET. `reachable()` probes person / person_role —
// the inputs — and the function's existence. It deliberately does NOT skip on "the graph came
// back empty", because an empty graph is one of the states this file exists to catch.
//
// WHY THE PLAN TEST IS THE ONE THAT EARNS ITS PLACE — the same reason person_by_name.data.test.ts
// gives, and the same defect class. Every behavioural case below passed against the OLD body
// too, the one that rebuilt the whole-corpus officer-count map on every request and drove the
// route to 8.2-10.1 s on prod, one request already over the 10 s statement_timeout
// (docs/plans/db-route-timeouts-v1.md §9.1). Correct-but-quadratic is exactly what a
// behavioural suite cannot see, so the last test asserts the buffer count and proves the
// assertion still discriminates by restoring the old body in a rolled-back transaction.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { allRows, withClient, end } from "../lib/pg";

type Edge = {
  slug: string;
  name: string;
  sharedCount?: number;
  companies?: { eik: string; name: string | null }[];
  partnerSlug?: string;
  c1?: { eik: string };
  c2?: { eik: string };
};
type Payload = {
  subject: { slug: string; name: string };
  related: Edge[];
  indirect: Edge[];
  disclaimer: string;
} | null;

const connections = (slug: string): Promise<Payload> =>
  allRows<{ r: Payload }>("SELECT person_connections($1) AS r", [slug]).then(
    (x) => x[0]?.r ?? null,
  );

// SOURCE-side probe: the person layer and the tr/ngo bridge that person_connections reads.
const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regprocedure('person_connections(text)') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person_role r JOIN person p USING (person_id)
        WHERE r.source IN ('tr','ngo') AND p.is_public_figure AND p.status = 'active'`,
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / person layer or tr-ngo bridge empty";

afterAll(async () => {
  await end();
});

// Every fixture below self-selects from the live corpus with a deterministic ORDER BY, so
// nothing here hardcodes a slug that could later leave the data.
// Takes params — person_role.ref is unconstrained text written by the TR/NGO bridge from
// registry payloads, so interpolating one would break this file the day a ref carries an
// apostrophe, and the syntax error would point at person_connections rather than at the test.
const pickSlug = (sql: string, params?: unknown[]): Promise<string | null> =>
  allRows<{ slug: string }>(sql, params).then((r) => r[0]?.slug ?? null);

// ── Behaviour ────────────────────────────────────────────────────────────────

test.skipIf(skip)(
  "a subject with a shared company gets direct edges",
  async () => {
    const slug = await pickSlug(`
    WITH oc AS (
      SELECT r.ref, count(DISTINCT r.person_id) AS n
        FROM person_role r JOIN person p USING (person_id)
       WHERE r.source IN ('tr','ngo') AND p.is_public_figure AND p.status = 'active'
       GROUP BY r.ref HAVING count(DISTINCT r.person_id) BETWEEN 2 AND 6)
    SELECT p.slug FROM person p JOIN person_role r USING (person_id) JOIN oc ON oc.ref = r.ref
     WHERE r.source IN ('tr','ngo') AND p.is_public_figure AND p.status = 'active'
     ORDER BY p.slug LIMIT 1`);
    assert.ok(
      slug,
      "no subject with a 2-6 officer company — fixture pool is empty",
    );

    const r = await connections(slug);
    assert.ok(r, `person_connections returned null for ${slug}`);
    assert.equal(r.subject.slug, slug);
    assert.ok(
      r.related.length > 0,
      `${slug} shares a <=6-officer company but got no direct edges`,
    );
    for (const e of r.related) {
      assert.ok(e.slug && e.name, "a direct edge is missing slug/name");
      assert.ok(
        (e.companies ?? []).length > 0,
        `direct edge ${e.slug} carries no bridge company`,
      );
      assert.equal(
        e.sharedCount,
        new Set((e.companies ?? []).map((c) => c.eik)).size,
        `sharedCount disagrees with the bridge-company list for ${e.slug}`,
      );
    }
  },
);

test.skipIf(skip)(
  "the association-noise guard excludes mass-membership orgs",
  async (ctx) => {
    // A company with > 6 public officers is a board / professional association, not a business
    // tie. Pick the biggest one and assert it never appears as a bridge for its own members.
    const [big] = await allRows<{ ref: string; n: string }>(`
    SELECT r.ref, count(DISTINCT r.person_id) AS n
      FROM person_role r JOIN person p USING (person_id)
     WHERE r.source IN ('tr','ngo') AND p.is_public_figure AND p.status = 'active'
     GROUP BY r.ref ORDER BY count(DISTINCT r.person_id) DESC, r.ref LIMIT 1`);
    if (!big || Number(big.n) <= 6) {
      // Stated, not silent: assert.ok(true) would report as a plain pass and print nothing.
      ctx.skip("no company exceeds 6 public officers — guard not exercisable");
      return;
    }
    const slug = await pickSlug(
      `SELECT p.slug FROM person p JOIN person_role r USING (person_id)
        WHERE r.ref = $1 AND r.source IN ('tr','ngo')
          AND p.is_public_figure AND p.status = 'active'
        ORDER BY p.slug LIMIT 1`,
      [big.ref],
    );
    assert.ok(
      slug,
      "the mass-membership org has no public member to test with",
    );

    const r = await connections(slug);
    const bridges = [
      ...(r?.related ?? []).flatMap((e) =>
        (e.companies ?? []).map((c) => c.eik),
      ),
      ...(r?.indirect ?? []).flatMap((e) => [e.c1?.eik, e.c2?.eik]),
    ].filter(Boolean);
    assert.ok(
      !bridges.includes(big.ref),
      `${big.ref} has ${big.n} public officers but still bridged an edge for ${slug} — ` +
        `the association-noise guard is not being applied`,
    );
  },
);

test.skipIf(skip)(
  "indirect edges are second-degree only, never direct or self",
  async () => {
    const slug = await pickSlug(`
    WITH oc AS (
      SELECT r.ref, count(DISTINCT r.person_id) AS n
        FROM person_role r JOIN person p USING (person_id)
       WHERE r.source IN ('tr','ngo') AND p.is_public_figure AND p.status = 'active'
       GROUP BY r.ref HAVING count(DISTINCT r.person_id) BETWEEN 2 AND 6)
    SELECT p.slug FROM person p JOIN person_role r USING (person_id) JOIN oc ON oc.ref = r.ref
     WHERE r.source IN ('tr','ngo') AND p.is_public_figure AND p.status = 'active'
     GROUP BY p.slug ORDER BY count(*) DESC, p.slug LIMIT 1`);
    assert.ok(slug, "no fixture subject available");

    const r = await connections(slug);
    assert.ok(r, `person_connections returned null for ${slug}`);
    const direct = new Set(r.related.map((e) => e.slug));
    for (const e of r.indirect) {
      assert.ok(
        !direct.has(e.slug),
        `${e.slug} is both a direct and an indirect edge`,
      );
      assert.notEqual(
        e.slug,
        slug,
        "the subject appears as its own indirect edge",
      );
      assert.ok(e.partnerSlug, `indirect edge ${e.slug} has no partner`);
      assert.notEqual(
        e.slug,
        e.partnerSlug,
        "an indirect edge is its own partner",
      );
      assert.ok(
        e.c1?.eik && e.c2?.eik,
        `indirect edge ${e.slug} is missing a hop company`,
      );
      assert.notEqual(
        e.c1.eik,
        e.c2.eik,
        `indirect edge ${e.slug} hops the same company twice`,
      );
    }
  },
);

test.skipIf(skip)("the privacy gate holds on both endpoints", async () => {
  // §6: never surface a private co-owner, and never a review-status person. All local person
  // rows may be status='active', so the non-public half is the one with a natural fixture;
  // the status half is created in a rolled-back transaction below.
  const slug = await pickSlug(`
    WITH oc AS (
      SELECT r.ref, count(DISTINCT r.person_id) AS n
        FROM person_role r JOIN person p USING (person_id)
       WHERE r.source IN ('tr','ngo') AND p.is_public_figure AND p.status = 'active'
       GROUP BY r.ref HAVING count(DISTINCT r.person_id) BETWEEN 2 AND 6)
    SELECT p.slug FROM person p JOIN person_role r USING (person_id) JOIN oc ON oc.ref = r.ref
     WHERE r.source IN ('tr','ngo') AND p.is_public_figure AND p.status = 'active'
     ORDER BY p.slug LIMIT 1`);
  assert.ok(slug, "no fixture subject available");

  const r = await connections(slug);
  const reached = [...(r?.related ?? []), ...(r?.indirect ?? [])].map(
    (e) => e.slug,
  );
  if (reached.length) {
    const bad = await allRows<{ slug: string }>(
      `SELECT slug FROM person WHERE slug = ANY($1)
        AND (NOT is_public_figure OR status <> 'active')`,
      [reached],
    );
    assert.equal(
      bad.length,
      0,
      `surfaced non-public / non-active persons: ${bad.map((b) => b.slug).join(", ")}`,
    );
  }

  // A review-status subject is not servable at all.
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query("UPDATE person SET status = 'review' WHERE slug = $1", [
        slug,
      ]);
      const { rows } = await c.query<{ r: Payload }>(
        "SELECT person_connections($1) AS r",
        [slug],
      );
      assert.equal(
        rows[0]?.r ?? null,
        null,
        "a review-status subject still returned a connections payload",
      );
    } finally {
      await c.query("ROLLBACK").catch(() => {});
    }
  });
});

test.skipIf(skip)(
  "an unknown slug returns null, and the disclaimer is never droppable",
  async () => {
    assert.equal(await connections("no-such-person-slug-xyz"), null);

    const slug = await pickSlug(
      `SELECT slug FROM person WHERE status = 'active' AND is_public_figure ORDER BY slug LIMIT 1`,
    );
    assert.ok(slug, "no active public figure in the corpus");
    const r = await connections(slug);
    assert.ok(
      r?.disclaimer?.length,
      "the identity disclaimer is missing from the payload",
    );
  },
);

// ── The plan test ────────────────────────────────────────────────────────────
//
// The whole point of the fix. The old body materialized a `co` CTE — one GROUP BY over every
// tr/ngo person_role row joined to every person — on EVERY request, independent of the
// subject.
//
// The subject deliberately has no companies: that is the crawler's common case (prod traffic
// is a bot walking /person/{slug} alphabetically) and the one where the old body's cost was
// PURELY waste.
//
// CALIBRATED WITH bufferCost BELOW, not with the plan doc's numbers. Those (560 new / 7,294
// old) are `force_generic_plan` measurements of the function BODY; this reads the shipped path
// through the pool and gets **38 new / 6,760 old**. Mixing the two methods is how this ceiling
// was first set to 1200 — 31× above what it measures, which still passes a TOTAL regression
// back to the whole-corpus scan but sails past a PARTIAL one. That is the likelier failure:
// lose just the `person_pkey` seek inside public_officer_count and the cost lands near
// 900-3,000, silently green at 1200 while the route has regressed ~24×.
//
// 200 sits ~5× above the measured cost and ~34× below the control. Matches the ceiling the
// sibling person_by_name.data.test.ts:220 chose by the same reasoning.
const BUFFER_CEILING = 200;

const bufferCost = async (c: PoolClient, slug: string): Promise<number> => {
  // Warm this backend's catalog/syscache first — the first call on a fresh connection carries
  // one-time planning warm-up that scales with the schema, not with how this function plans.
  await c.query("SELECT person_connections($1)", [slug]);
  const { rows } = await c.query<{ "QUERY PLAN": string }>(
    "EXPLAIN (ANALYZE, BUFFERS) SELECT person_connections($1)",
    [slug],
  );
  const lines = rows
    .map((r) => r["QUERY PLAN"])
    .join("\n")
    .split("\n")
    .filter((l) => l.includes("Buffers:"));
  // Fail loudly rather than scoring 0 if EXPLAIN's format ever changes — a silent 0 would sail
  // under the ceiling, which is the dangerous direction.
  assert.ok(
    lines.length,
    "EXPLAIN reported no Buffers: line — parser needs updating",
  );
  // Each counter parsed on its own: Postgres OMITS zero-valued counters, so a plan read
  // entirely from disk prints "Buffers: shared read=4461" with no hit= at all.
  return lines
    .flatMap((l) => [...l.matchAll(/shared (?:hit|read)=(\d+)/g)])
    .reduce((n, m) => n + Number(m[1]), 0);
};

test.skipIf(skip)("costs nothing for a subject with no companies", async () => {
  const slug = await pickSlug(`
    SELECT p.slug FROM person p
     WHERE p.status = 'active' AND p.is_public_figure
       AND NOT EXISTS (SELECT 1 FROM person_role r
                        WHERE r.person_id = p.person_id AND r.source IN ('tr','ngo'))
     ORDER BY p.slug LIMIT 1`);
  assert.ok(
    slug,
    "every public person has a tr/ngo role — no fixture for the empty case",
  );

  const current = await withClient((c) => bufferCost(c, slug));
  assert.ok(
    current < BUFFER_CEILING,
    `person_connections read ${current} buffers for a subject with NO companies ` +
      `(ceiling ${BUFFER_CEILING}). It is rebuilding the whole-corpus officer-count map ` +
      `instead of looking up the handful of companies it needs — see ` +
      `scripts/db/schema/pg/084_person_connections.sql and docs/plans/db-route-timeouts-v1.md §9.1.`,
  );

  // Control: restore the expensive half of the pre-fix body and confirm this assertion would
  // have caught it.
  //
  // NOT the whole old body — it keeps `co` and its subj_co consumer and drops rel/agg/p_c1/
  // p_co/indirect and the payload builder, so it reads ~6,760 buffers against the real old
  // body's ~7,294. That is deliberate and conservative: it is a LOWER BOUND on what the ceiling
  // must reject, so calibrate against 6,760, not against the plan doc's 7,294.
  //
  // Holds an ExclusiveLock on the person_connections object for the duration. Concurrent
  // CALLERS are unaffected — they read the committed body without blocking — but a concurrent
  // `apply_functions.ts 084_person_connections.sql` or `db:resolve:persons` against the same
  // database would block on the lock. db:refresh sequences the loaders before test:data, so
  // the collision needs a hand-run loader during a test run.
  const regressed = await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`
        CREATE OR REPLACE FUNCTION person_connections(p_slug text)
        RETURNS jsonb LANGUAGE sql STABLE AS $fn$
          WITH subj AS (
            SELECT person_id, slug, display_name FROM person
             WHERE slug = p_slug AND status = 'active' AND is_public_figure LIMIT 1
          ),
          co AS (
            SELECT r.ref AS eik, count(DISTINCT r.person_id) AS officers
              FROM person_role r JOIN person p USING (person_id)
             WHERE r.source IN ('tr','ngo') AND p.is_public_figure AND p.status = 'active'
             GROUP BY r.ref
          ),
          subj_co AS (
            SELECT DISTINCT r.ref AS eik
              FROM person_role r
              JOIN subj ON subj.person_id = r.person_id
              JOIN co ON co.eik = r.ref AND co.officers <= 6
             WHERE r.source IN ('tr','ngo')
          )
          SELECT jsonb_build_object('n', (SELECT count(*) FROM subj_co),
                                    'm', (SELECT count(*) FROM co))
          FROM subj;
        $fn$;`);
      return await bufferCost(c, slug);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
    }
  });
  assert.ok(
    regressed >= BUFFER_CEILING,
    `the ceiling no longer discriminates: the pre-fix body read only ${regressed} buffers, ` +
      `under the ${BUFFER_CEILING} ceiling. This test has stopped measuring anything.`,
  );
});

// The ceiling above cannot see this property: its subject has ZERO roles of any kind, so it
// never exercises qual ordering at all.
//
// public_officer_count is only cheap because the planner evaluates `source IN ('tr','ngo')`
// FIRST and never calls it for a non-TR role. That ordering is not written anywhere in the
// query — order_qual_clauses() derives it from the function's COST, which 084 sets to 500 for
// exactly this reason. Drop that COST (or reimplement the function in C, where the default is
// 1) and every non-TR role on every subject buys a per-eik lookup, with nothing failing.
//
// Measured with bufferCost on the corpus's worst case for this — the person with the most
// non-tr/ngo roles (24, of which 0 are tr/ngo): 38 buffers, identical to a person with no
// roles at all, i.e. the function is never called. The ceiling is generous because the point
// is to catch one lookup PER ROLE (~24× this) rather than to pin an exact number.
const NON_TR_CEILING = 100;

test.skipIf(skip)("does not pay per non-TR role", async () => {
  const slug = await pickSlug(`
    SELECT p.slug FROM person p JOIN person_role r USING (person_id)
     WHERE p.status = 'active' AND p.is_public_figure
     GROUP BY p.slug
    HAVING count(*) FILTER (WHERE r.source IN ('tr','ngo')) = 0
     ORDER BY count(*) DESC, p.slug LIMIT 1`);
  assert.ok(slug, "no public person with roles but none of them tr/ngo");

  const [n] = await allRows<{ roles: string }>(
    `SELECT count(*) AS roles FROM person_role r JOIN person p USING (person_id)
      WHERE p.slug = $1`,
    [slug],
  );
  const cost = await withClient((c) => bufferCost(c, slug));
  assert.ok(
    cost < NON_TR_CEILING,
    `person_connections read ${cost} buffers for ${slug}, who has ${n.roles} roles and NONE ` +
      `of them tr/ngo (ceiling ${NON_TR_CEILING}). public_officer_count is being evaluated ` +
      `before the source filter — check that 084 still declares COST 500 on it.`,
  );
});
