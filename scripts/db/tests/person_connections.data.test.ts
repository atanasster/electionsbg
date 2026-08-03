// Gate for person_connections (084) — the person↔person company graph behind the Connections
// component on /person/{slug}, the /api/db/person-connections + graph-ego routes, and the
// personConnections AI tool.
//
//   npm run test:data
//
// RE-POINTED ONTO graph_* (connections-engine-v1 §P3.5): the traversal reads graph_edge (co-ownership
// kinds), the association-noise guard is the precomputed graph_company_node.public_officer_count column,
// and company nodes now carry money. ENDPOINT ELIGIBILITY is still gated LIVE on person (status +
// is_public_figure / verified), so the privacy contract is unchanged. The function is now 2-arg —
// person_connections(text, boolean DEFAULT false) — the 2nd arg the Tier-V private-owner toggle.
//
// Requires the Postgres store + the graph loader (db:load:graph:pg) + person layer; auto-skips when
// absent — like the other *.data.test.ts gates. IT SKIPS ON THE SOURCE, NEVER ON THE TARGET: an empty
// graph is one of the states this file exists to catch.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { allRows, withClient, end } from "../lib/pg";

type Edge = {
  slug: string;
  name: string;
  sharedCount?: number;
  companies?: { eik: string; name: string | null; money?: number }[];
  partnerSlug?: string;
  c1?: { eik: string; money?: number };
  c2?: { eik: string; money?: number };
};
type Payload = {
  subject: { slug: string; name: string };
  related: Edge[];
  indirect: Edge[];
  disclaimer: string;
} | null;

const connections = (slug: string, includePrivate = false): Promise<Payload> =>
  allRows<{ r: Payload }>("SELECT person_connections($1, $2) AS r", [
    slug,
    includePrivate,
  ]).then((x) => x[0]?.r ?? null);

// SOURCE-side probe: the 2-arg function + the graph edge set it reads. Probes the function SIGNATURE
// (text, boolean) — the 1-arg is retired — and that the co-ownership edge set is non-empty.
const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regprocedure('person_connections(text,boolean)') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM graph_edge WHERE kind IN ('tr_role','tr_owner')",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / graph or person layer absent";

afterAll(async () => {
  await end();
});

// Every fixture self-selects from the live corpus with a deterministic ORDER BY, so nothing hardcodes
// a slug. Takes params — person_role.ref is unconstrained text, so interpolating one would break the
// file the day a ref carries an apostrophe.
const pickSlug = (sql: string, params?: unknown[]): Promise<string | null> =>
  allRows<{ slug: string }>(sql, params).then((r) => r[0]?.slug ?? null);

// ── Behaviour ────────────────────────────────────────────────────────────────

test.skipIf(skip)(
  "a subject with a shared company gets direct edges, each bridge company carrying money",
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
      // P3.5 deliverable: every bridge company node carries its (broad public) money.
      for (const c of e.companies ?? [])
        assert.ok(
          typeof c.money === "number",
          `bridge company ${c.eik} for ${e.slug} carries no money field`,
        );
    }
  },
);

test.skipIf(skip)(
  "the association-noise guard excludes mass-membership orgs",
  async (ctx) => {
    // A company with > 6 public officers is a board / professional association, not a business tie.
    // The graph's precomputed public_officer_count is the guard's input; it equals the person_role
    // count exactly (0 mismatches, proven), so a >6 company from either source is the same set.
    const [big] = await allRows<{ ref: string; n: string }>(`
    SELECT eik AS ref, public_officer_count AS n
      FROM graph_company_node ORDER BY public_officer_count DESC, eik LIMIT 1`);
    if (!big || Number(big.n) <= 6) {
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

test.skipIf(skip)("the privacy gate holds LIVE on both endpoints", async () => {
  // §6: never surface a private co-owner, and never a review-status person. Eligibility is gated LIVE
  // on person (not the graph snapshot), so a status flip drops someone IMMEDIATELY — the property the
  // graph re-point had to preserve. The non-public half has a natural fixture; the status half is a
  // rolled-back UPDATE.
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
    // Default (public) run must never surface a non-public / non-active person.
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

  // A review-status subject is not servable at all — and because the gate is LIVE, a rolled-back
  // UPDATE proves it without a graph rebuild.
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
        "a review-status subject still returned a connections payload — the gate is not live",
      );
    } finally {
      await c.query("ROLLBACK").catch(() => {});
    }
  });
});

// ── Tier-V private-owner toggle (the P3.5 addition) ───────────────────────────

test.skipIf(skip)(
  "the Tier-V toggle admits verified private owners; default suppresses them",
  async () => {
    // A verified private owner (is_public_figure=false, identity_confidence='verified') is not
    // servable as a subject by default, but IS with the toggle.
    const vslug = await pickSlug(
      `SELECT slug FROM graph_person_node
        WHERE identity_confidence = 'verified' AND NOT is_public_figure
        ORDER BY degree DESC, person_id LIMIT 1`,
    );
    if (vslug) {
      assert.equal(
        await connections(vslug, false),
        null,
        `verified private ${vslug} was served on the DEFAULT (public) path`,
      );
      assert.ok(
        (await connections(vslug, true)) !== null,
        `verified private ${vslug} was NOT served even with the toggle`,
      );
    }

    // And on a public subject sharing a GENUINELY SMALL company (coowner_count 2-6) that also carries
    // verified private co-owners, the toggle admits AT LEAST as many direct edges as the default — never
    // fewer — and the default set is a subset (the toggle only ADDS verified endpoints).
    const pslug = await pickSlug(
      `SELECT gp.slug
         FROM graph_person_node gp
         JOIN graph_edge e ON e.person_id = gp.person_id AND e.kind IN ('tr_role','tr_owner')
         JOIN graph_company_node cn ON cn.eik = e.eik AND cn.coowner_count BETWEEN 2 AND 6
          AND cn.public_officer_count < cn.coowner_count
        WHERE gp.is_public_figure
        GROUP BY gp.slug ORDER BY count(*) DESC, gp.slug LIMIT 1`,
    );
    if (pslug) {
      const def = await connections(pslug, false);
      const tog = await connections(pslug, true);
      assert.ok(def && tog, `person_connections returned null for ${pslug}`);
      assert.ok(
        (tog.related.length ?? 0) >= (def.related.length ?? 0),
        `toggle gave FEWER related (${tog.related.length}) than default (${def.related.length}) for ${pslug}`,
      );
      const defSet = new Set(def.related.map((e) => e.slug));
      const togSet = new Set(tog.related.map((e) => e.slug));
      for (const s of defSet)
        assert.ok(togSet.has(s), `default edge ${s} vanished under the toggle`);
    }
  },
);

// OVER-LINK GUARD (the FINDING-001 regression). The private toggle bounds TOTAL co-owners
// (coowner_count), not just the public count — so a few-public-officer mass-ownership vehicle
// (кооперация: 1 public + scores of verified) must NEVER bridge an edge, in EITHER toggle state. Bounds
// the defamation-sensitive fan-out that named ~123 private individuals through one company before the fix.
test.skipIf(skip)(
  "the toggle does not over-link through mass-ownership companies",
  async (ctx) => {
    // The worst offender: many total co-owners, few public officers (passes the OLD public-only guard).
    const [big] = await allRows<{
      eik: string;
      coowners: string;
      pub: string;
    }>(`
      SELECT eik, coowner_count AS coowners, public_officer_count AS pub
        FROM graph_company_node
       WHERE coowner_count > 6 AND public_officer_count <= 6
       ORDER BY coowner_count DESC, eik LIMIT 1`);
    if (!big) {
      ctx.skip(
        "no few-public-officer mass-ownership company — over-link not exercisable",
      );
      return;
    }
    // A public member of that company, so the default path can reach it as a subject.
    const slug = await pickSlug(
      `SELECT p.slug FROM person p
         JOIN graph_edge e ON e.person_id = p.person_id AND e.kind IN ('tr_role','tr_owner')
        WHERE e.eik = $1 AND p.status = 'active' AND p.is_public_figure
        ORDER BY p.slug LIMIT 1`,
      [big.eik],
    );
    if (!slug) {
      ctx.skip(
        `mass-ownership company ${big.eik} has no public member to query from`,
      );
      return;
    }
    for (const priv of [false, true]) {
      const r = await connections(slug, priv);
      const bridges = [
        ...(r?.related ?? []).flatMap((e) =>
          (e.companies ?? []).map((c) => c.eik),
        ),
        ...(r?.indirect ?? []).flatMap((e) => [e.c1?.eik, e.c2?.eik]),
      ].filter(Boolean);
      assert.ok(
        !bridges.includes(big.eik),
        `company ${big.eik} (${big.coowners} co-owners, ${big.pub} public) bridged an edge for ` +
          `${slug} with private=${priv} — the toggle guard does not bound total co-ownership degree`,
      );
    }
  },
);

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

// ── The plan test — the buffer ceiling ────────────────────────────────────────
//
// The whole point of the original fix, carried forward through the graph re-point. The pre-fix body
// materialized a `co` CTE — one GROUP BY over every tr/ngo person_role row joined to every person — on
// EVERY request, independent of the subject, and drove the route to 8.2-10.1 s on prod. The graph
// version replaces that with a precomputed guard column (an O(1) PK lookup), so a subject with NO
// companies costs almost nothing.
//
// CALIBRATED WITH bufferCost BELOW, read through the pool: the graph body measures ~71 buffers for the
// no-companies case; the pre-fix control (restored in a rolled-back tx) reads ~6,760. 200 sits ~2.8×
// above the measured cost and ~34× below the control — comfortably discriminating a regression back to
// a whole-corpus scan.
const BUFFER_CEILING = 200;

/** Sum the EXECUTION buffers of an EXPLAIN (ANALYZE, BUFFERS) plan.
 *
 * EXECUTION only. EXPLAIN ends with a `Planning:` section carrying its own `Buffers:` line,
 * and that one counts catalog reads for BUILDING the plan — hundreds of buffers that scale
 * with the schema, not with the function under test. The warm-up in each caller exists to
 * drive it to ~0, but that only holds while the warm-up and the EXPLAIN run on the SAME
 * backend: in a full `test:data` run the pool hands out a different client, the plan is built
 * afresh, and ~458 planning buffers land on top of an execution cost of ~73 — failing a
 * 200-buffer ceiling the function is nowhere near. Counting only the execution section
 * measures the thing the ceiling is about, in isolation and under load alike.
 */
const sumExecutionBuffers = (rows: { "QUERY PLAN": string }[]): number => {
  const all = rows
    .map((r) => r["QUERY PLAN"])
    .join("\n")
    .split("\n");
  const planningAt = all.findIndex((l) => /^\s*Planning:/.test(l));
  const lines = (planningAt === -1 ? all : all.slice(0, planningAt)).filter(
    (l) => l.includes("Buffers:"),
  );
  assert.ok(
    lines.length,
    "EXPLAIN reported no execution Buffers: line — parser needs updating",
  );
  return lines
    .flatMap((l) => [...l.matchAll(/shared (?:hit|read)=(\d+)/g)])
    .reduce((n, m) => n + Number(m[1]), 0);
};

const bufferCost = async (c: PoolClient, slug: string): Promise<number> => {
  // Warm this backend's catalog/syscache first — the first call on a fresh connection carries
  // one-time planning warm-up that scales with the schema, not with how this function plans.
  await c.query("SELECT person_connections($1)", [slug]);
  const { rows } = await c.query<{ "QUERY PLAN": string }>(
    "EXPLAIN (ANALYZE, BUFFERS) SELECT person_connections($1)",
    [slug],
  );
  return sumExecutionBuffers(rows);
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
      `(ceiling ${BUFFER_CEILING}). The graph guard should be an O(1) column lookup, not a ` +
      `whole-corpus officer-count scan — see scripts/db/schema/pg/084_person_connections.sql.`,
  );

  // Control: restore the expensive pre-fix body (the whole-corpus `co` CTE) as a 2-arg overload and
  // confirm this assertion would have caught it. NOT the whole old body — it keeps `co` + subj_co and
  // drops the rest, a LOWER BOUND (~6,760 buffers) on what the ceiling must reject.
  const regressed = await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`
        CREATE OR REPLACE FUNCTION person_connections(p_slug text, p_include_private boolean DEFAULT false)
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

// The DEFAULT ceiling above never exercises the TOGGLE path (bufferCost binds p_include_private=false).
// The private view admits verified co-owners, so it costs more — but the coowner_count≤6 guard bounds
// the fan-out, so it stays FINITE. Measured ~379 on the highest-verified-degree small-company subject;
// a regression that dropped the guard (fanning to scores of private co-owners, then indirect over their
// companies) would blow well past this. 2000 sits ~5× above the measurement.
const PRIVATE_BUFFER_CEILING = 2000;

const bufferCostPrivate = async (
  c: PoolClient,
  slug: string,
): Promise<number> => {
  await c.query("SELECT person_connections($1, true)", [slug]);
  const { rows } = await c.query<{ "QUERY PLAN": string }>(
    "EXPLAIN (ANALYZE, BUFFERS) SELECT person_connections($1, true)",
    [slug],
  );
  return sumExecutionBuffers(rows);
};

test.skipIf(skip)(
  "the toggle path stays bounded (guard limits the fan-out)",
  async () => {
    // The subject most likely to be expensive under the toggle: the highest verified-private-degree
    // public figure on genuinely small (coowner_count 2-6) companies.
    const slug = await pickSlug(`
    SELECT gp.slug FROM graph_person_node gp
      JOIN graph_edge e ON e.person_id = gp.person_id AND e.kind IN ('tr_role','tr_owner')
      JOIN graph_company_node cn ON cn.eik = e.eik
       AND cn.coowner_count BETWEEN 2 AND 6 AND cn.public_officer_count < cn.coowner_count
     WHERE gp.is_public_figure
     GROUP BY gp.slug ORDER BY count(*) DESC, gp.slug LIMIT 1`);
    if (!slug) return; // no public subject on a small verified-carrying company — nothing to bound
    const cost = await withClient((c) => bufferCostPrivate(c, slug));
    assert.ok(
      cost < PRIVATE_BUFFER_CEILING,
      `person_connections(…, true) read ${cost} buffers for ${slug} (ceiling ${PRIVATE_BUFFER_CEILING}). ` +
        `The coowner_count<=6 guard should bound the private fan-out — check subj_co/p_co still key on ` +
        `coowner_count when p_include_private.`,
    );
  },
);
