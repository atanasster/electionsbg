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
import { sumExecutionBuffers } from "../lib/explain_buffers";
import { reportSkip } from "../../lib/report_skip";

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

const connections = (slug: string): Promise<Payload> =>
  allRows<{ r: Payload }>("SELECT person_connections($1) AS r", [slug]).then(
    (x) => x[0]?.r ?? null,
  );

// SOURCE-side probe: the function + the graph edge set it reads. Probes the SIGNATURE (text) — the 2-arg
// toggle overload is retired — and that the co-ownership edge set is non-empty.
const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regprocedure('person_connections(text)') IS NOT NULL AS ok",
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
reportSkip(import.meta.url, skip);

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
      {
        reportSkip(
          import.meta.url,
          "no company exceeds 6 public officers — guard not exercisable",
        );
        ctx.skip();
      }
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

// ── The RETIRED Tier-V private arm ───────────────────────────────────────────

test.skipIf(skip)(
  "the Tier-V private arm is retired — no overload, and a private person is neither subject nor endpoint",
  async () => {
    // 1. THE OVERLOAD IS GONE, and asserting its absence is not pedantry. Left in place beside the
    // 1-arg it does not merely linger: person_connections('slug') becomes AMBIGUOUS (42725) and every
    // caller errors. Re-creating it is also how the retired surface would come back by accident.
    const [sig] = await allRows<{ two: string | null; one: string | null }>(
      `SELECT to_regprocedure('person_connections(text,boolean)')::text AS two,
              to_regprocedure('person_connections(text)')::text        AS one`,
    );
    assert.equal(
      sig?.two,
      null,
      "person_connections(text, boolean) still exists — the Tier-V arm was not retired, and the 1-arg " +
        "call every caller makes is now ambiguous (42725). See docs/plans/connections-guard-v2.md.",
    );
    assert.ok(sig?.one, "person_connections(text) is missing");

    // 2. A verified private owner is not servable as a SUBJECT. There is no longer any argument that
    // makes them one; before the retirement the toggle did.
    const vslug = await pickSlug(
      `SELECT slug FROM graph_person_node
        WHERE identity_confidence = 'verified' AND NOT is_public_figure
        ORDER BY degree DESC, person_id LIMIT 1`,
    );
    if (vslug)
      assert.equal(
        await connections(vslug),
        null,
        `verified private ${vslug} was served as a subject`,
      );

    // 3. And never as an ENDPOINT — asserted where it would actually bite, on a public subject whose
    // small company DOES carry verified private co-owners (public_officer_count < coowner_count). A
    // subject with no private co-owners nearby cannot discriminate.
    const pslug = await pickSlug(
      `SELECT gp.slug
         FROM graph_person_node gp
         JOIN graph_edge e ON e.person_id = gp.person_id AND e.kind IN ('tr_role','tr_owner')
         JOIN graph_company_node cn ON cn.eik = e.eik AND cn.coowner_count BETWEEN 2 AND 6
          AND cn.public_officer_count < cn.coowner_count
        WHERE gp.is_public_figure
        GROUP BY gp.slug ORDER BY count(*) DESC, gp.slug LIMIT 1`,
    );
    assert.ok(
      pslug,
      "no public subject on a small company with a private co-owner — fixture pool is empty",
    );
    const r = await connections(pslug);
    assert.ok(r, `person_connections returned null for ${pslug}`);
    const reached = [...r.related, ...r.indirect].map((e) => e.slug);
    if (reached.length) {
      const leaked = await allRows<{ slug: string }>(
        `SELECT slug FROM person WHERE slug = ANY($1) AND NOT is_public_figure`,
        [reached],
      );
      assert.equal(
        leaked.length,
        0,
        `non-public persons surfaced for ${pslug}: ${leaked.map((l) => l.slug).join(", ")}`,
      );
    }
  },
);

// OVER-LINK GUARD (the FINDING-001 regression, and since 2026-09-09 the guard's ONLY definition). A
// mass-ownership vehicle — a кооперация or professional association — must NEVER bridge an edge. There
// is no longer a toggle to qualify that: `coowner_count <= 6` is the single bound on every path, so the
// claim is unconditional, which is what the original "in EITHER toggle state" wording was reaching for.
//
// ⚠️ THE PUBLIC-MEMBER REQUIREMENT MUST STAY IN THE PICKER, NOT BE A SKIP AFTER IT. Picking the global
// worst offender first and skipping when it has no public member made this gate VACUOUS ON EVERY RUN:
// the corpus-wide maximum is ЕИК 811202228 at 123 co-owners and **0** public officers, so it can never
// have one, and the guard had simply stopped executing while printing a tidy skip reason. Severity here
// ANTI-CORRELATES with testability — the purest кооперация has the fewest public members — so
// `ORDER BY coowner_count DESC LIMIT 1` selects an untestable fixture by construction. Measured
// 2026-09-08: 1,507 companies in the band, 849 with a public member, the worst being ШИЙП ГРУП – 2016
// (ЕИК 204133950, 97 co-owners / 2 public).
test.skipIf(skip)(
  "does not over-link through mass-ownership companies",
  async (ctx) => {
    const [big] = await allRows<{
      eik: string;
      coowners: string;
      pub: string;
      slug: string;
    }>(`
      SELECT cn.eik, cn.coowner_count AS coowners, cn.public_officer_count AS pub, m.slug
        FROM graph_company_node cn
        JOIN LATERAL (
          SELECT p.slug FROM person p
            JOIN graph_edge e ON e.person_id = p.person_id AND e.kind IN ('tr_role','tr_owner')
           WHERE e.eik = cn.eik AND p.status = 'active' AND p.is_public_figure
           ORDER BY p.slug LIMIT 1) m ON true
       WHERE cn.coowner_count > 6 AND cn.public_officer_count <= 6
       ORDER BY cn.coowner_count DESC, cn.eik LIMIT 1`);
    if (!big) {
      {
        reportSkip(
          import.meta.url,
          "no few-public-officer mass-ownership company with a public member — over-link not exercisable",
        );
        ctx.skip();
      }
      return;
    }
    const bridgesOf = (r: Payload): string[] =>
      [
        ...(r?.related ?? []).flatMap((e) =>
          (e.companies ?? []).map((c) => c.eik),
        ),
        ...(r?.indirect ?? []).flatMap((e) => [e.c1?.eik, e.c2?.eik]),
      ].filter(Boolean) as string[];

    assert.ok(
      !bridgesOf(await connections(big.slug)).includes(big.eik),
      `company ${big.eik} (${big.coowners} co-owners, ${big.pub} public) bridged an edge for ` +
        `${big.slug} — the guard is not bounding total co-ownership degree. If it is bounding ` +
        `public_officer_count again, that is the 2026-09-09 regression: see 084's header.`,
    );

    // MUTATION CHECK. The assertion above passes trivially if the subject simply has no edges, and it
    // also passes on any body that happens not to reach this company. Restore the PRE-2026-09-09 guard
    // (public_officer_count on the default path) in a rolled-back transaction and require the company to
    // bridge under it — otherwise this gate is not measuring the thing it names.
    const under_old_guard = await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(`
          CREATE OR REPLACE FUNCTION person_connections(p_slug text)
          RETURNS jsonb LANGUAGE sql STABLE AS $fn$
            WITH subj AS (
              SELECT person_id FROM person
               WHERE slug = p_slug AND status = 'active' AND is_public_figure LIMIT 1
            ),
            subj_co AS (
              SELECT DISTINCT e.eik
                FROM graph_edge e
                JOIN subj ON subj.person_id = e.person_id
                JOIN graph_company_node cn ON cn.eik = e.eik
               WHERE e.kind IN ('tr_role','tr_owner') AND cn.public_officer_count <= 6
            )
            SELECT jsonb_build_object(
              'subject', jsonb_build_object('slug', p_slug, 'name', p_slug),
              'related', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('slug', p.slug, 'name', p.display_name,
                         'companies', jsonb_build_array(jsonb_build_object('eik', e.eik))))
                  FROM graph_edge e
                  JOIN person p ON p.person_id = e.person_id AND p.status = 'active'
                   AND p.is_public_figure
                  JOIN subj_co sc ON sc.eik = e.eik
                 WHERE e.kind IN ('tr_role','tr_owner')
                   AND e.person_id <> (SELECT person_id FROM subj)), '[]'::jsonb),
              'indirect', '[]'::jsonb, 'disclaimer', 'x')
            FROM subj;
          $fn$;`);
        const { rows } = await c.query<{ r: Payload }>(
          "SELECT person_connections($1) AS r",
          [big.slug],
        );
        return bridgesOf(rows[0]?.r ?? null);
      } finally {
        await c.query("ROLLBACK").catch(() => {});
      }
    });
    assert.ok(
      under_old_guard.includes(big.eik),
      `the mutation check no longer discriminates: with the pre-2026-09-09 public_officer_count guard ` +
        `restored, ${big.eik} did NOT bridge for ${big.slug}, so the assertion above proves nothing.`,
    );
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
// CALIBRATED WITH bufferCost BELOW, read through the pool: the graph body measures 81 buffers for the
// no-companies case; the pre-fix control (restored in a rolled-back tx) reads 11,229. 200 sits ~2.5×
// above the measured cost and ~56× below the control — comfortably discriminating a regression back to
// a whole-corpus scan. Both figures are total buffer ACCESSES and so do not move with cache state;
// scoring cache hits alone put the control at 11 under load, which is how this gate came to fail as
// "the ceiling no longer discriminates" (scripts/db/lib/explain_buffers.ts).
const BUFFER_CEILING = 200;

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

  // Control: restore the expensive pre-fix body (the whole-corpus `co` CTE) and confirm this assertion
  // would have caught it. NOT the whole old body — it keeps `co` + subj_co and drops the rest, a LOWER
  // BOUND (11,229 buffers) on what the ceiling must reject. ⚠️ It must be created 1-ARG: a
  // 2-arg-with-default beside the real 1-arg makes every `person_connections($1)` call here ambiguous
  // (42725), so the control would fail as a syntax error rather than as a buffer measurement.
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
