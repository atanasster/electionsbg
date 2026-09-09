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
    // verified private co-owners, the toggle keeps every default edge that survives BOTH guards, drops
    // every default edge that survives only the public one, and may add verified endpoints on top.
    //
    // ⚠️ "THE TOGGLE ONLY ADDS" IS NOT THE CONTRACT, and this test asserted it until 2026-09-09. Per
    // 084's header the guard population FOLLOWS the toggle: the DEFAULT view bounds a bridge company by
    // public_officer_count <= 6, the PRIVATE view by coowner_count <= 6 — so a 1-public + 123-verified
    // кооперация cannot fan a subject out to scores of named private individuals (the over-link test
    // below). A company with coowner_count > 6 AND public_officer_count <= 6 is therefore a bridge by
    // DEFAULT and NOT under the toggle, and a default edge whose every bridge is such a company
    // legitimately vanishes. Measured 2026-09-08 on local: 1,507 companies sit in that band, and the old
    // picker's top subject (zlatko-zlatanov-dm4zqj) reached its one default edge through exactly one of
    // them (ЕИК 112577345, 7 co-owners / 2 public) — green on 2026-09-07 only because the picker had
    // chosen someone else. Both directions below are the function's real contract, and the second is
    // the over-link guard applied to an ordinary subject rather than to the worst offender.
    //
    // Why the subset/superset reasoning is sound: coowner_count >= public_officer_count on every company
    // node (asserted below — 0 of 88,953 violate it), so the toggle's bridge set is a SUBSET of the
    // default's, and an edge's toggle bridges are a subset of its default bridges.
    //
    // The picker requires a both-guard company that carries ANOTHER public officer (so at least one
    // default edge is guaranteed to survive — the subset check cannot go vacuous) and a non-public
    // eligible co-owner (so the toggle has something to add). 1,098 subjects qualify on the 2026-09-08
    // corpus.
    const [inv] = await allRows<{ n: string }>(
      `SELECT count(*) AS n FROM graph_company_node WHERE coowner_count < public_officer_count`,
    );
    assert.equal(
      Number(inv?.n ?? 0),
      0,
      `${inv?.n} company nodes have coowner_count < public_officer_count — the toggle's bridge set is ` +
        `no longer a subset of the default's, and the assertions below no longer follow from 084`,
    );
    const pslug = await pickSlug(
      `SELECT gp.slug
         FROM graph_person_node gp
         JOIN graph_edge e ON e.person_id = gp.person_id AND e.kind IN ('tr_role','tr_owner')
         JOIN graph_company_node cn ON cn.eik = e.eik AND cn.coowner_count BETWEEN 2 AND 6
          AND cn.public_officer_count BETWEEN 2 AND cn.coowner_count - 1
        WHERE gp.is_public_figure
        GROUP BY gp.slug ORDER BY count(*) DESC, gp.slug LIMIT 1`,
    );
    assert.ok(
      pslug,
      "no public subject on a 2-6 co-owner company with another public officer AND a private co-owner — fixture pool is empty",
    );
    const def = await connections(pslug, false);
    const tog = await connections(pslug, true);
    assert.ok(def && tog, `person_connections returned null for ${pslug}`);
    const togSet = new Set(tog.related.map((e) => e.slug));

    // Partition the default edges by whether ANY of their bridge companies satisfies BOTH guards.
    const bridgeEiks = [
      ...new Set(
        def.related.flatMap((e) => (e.companies ?? []).map((c) => c.eik)),
      ),
    ];
    const bothGuard = new Set(
      (
        await allRows<{ eik: string }>(
          `SELECT eik FROM graph_company_node WHERE eik = ANY($1) AND coowner_count <= 6`,
          [bridgeEiks],
        )
      ).map((r) => r.eik),
    );
    const hasBothGuardBridge = (e: Edge) =>
      (e.companies ?? []).some((c) => bothGuard.has(c.eik));
    const survivors = def.related.filter(hasBothGuardBridge);
    const mustVanish = def.related.filter((e) => !hasBothGuardBridge(e));
    assert.ok(
      survivors.length > 0,
      `${pslug} has no default edge through a coowner_count <= 6 company — the picker no longer ` +
        `guarantees a non-vacuous subset check`,
    );
    for (const e of survivors)
      assert.ok(
        togSet.has(e.slug),
        `default edge ${e.slug} (bridged by a coowner_count <= 6 company) vanished under the toggle for ${pslug}`,
      );
    // The other direction — the guard FOLLOWS the toggle. An edge whose every bridge is a >6-co-owner
    // company has no admissible bridge in the private view and must not be kept there; keeping it is
    // the public-only guard leaking into the toggle path, i.e. the FINDING-001 over-link.
    for (const e of mustVanish)
      assert.ok(
        !togSet.has(e.slug),
        `default edge ${e.slug} survived the toggle for ${pslug} although every bridge company ` +
          `(${(e.companies ?? []).map((c) => c.eik).join(", ")}) has coowner_count > 6 — the private ` +
          `view is bounding public_officer_count instead of coowner_count`,
      );
  },
);

// OVER-LINK GUARD (the FINDING-001 regression). The private toggle bounds TOTAL co-owners
// (coowner_count), not just the public count — so a few-public-officer mass-ownership vehicle
// (кооперация: 1 public + scores of verified) must NEVER bridge an edge UNDER THE TOGGLE. Bounds the
// defamation-sensitive fan-out that named ~123 private individuals through one company before the fix.
//
// ⚠️ "IN EITHER TOGGLE STATE" WAS THE OLD CLAIM AND IT IS NOT WHAT 084 IMPLEMENTS — it never fired only
// because the picker above was vacuous. The DEFAULT view bounds public_officer_count, so a 97-co-owner
// кооперация with 2 public officers IS a default bridge, by design: it names 2 public figures, which is
// a small public tie, not a fan-out. The harm this guard exists to prevent is naming SCORES OF PRIVATE
// INDIVIDUALS, and that is reachable only through the private view. Measured 2026-09-08: on the default
// path no admitted bridge company names more than MAX_CO_OFFICERS people (max 6, and 0 of 88,953 exceed
// it), while ЕИК 204133950 and 811202228 would name 88 and 114 people respectively if the private view
// bounded the public count instead of coowner_count. So the two arms below assert DIFFERENT properties:
// private = must not bridge at all; default = may bridge, but the fan-out stays bounded.
test.skipIf(skip)(
  "the toggle does not over-link through mass-ownership companies",
  async (ctx) => {
    // The worst offender THAT IS ACTUALLY QUERYABLE: many total co-owners, few public officers (passes
    // the OLD public-only guard), AND carrying a public member so the default path can reach it as a
    // subject.
    //
    // ⚠️ THE PUBLIC-MEMBER REQUIREMENT MUST BE IN THE PICKER, NOT A SKIP AFTER IT. Picking the global
    // worst offender first and skipping when it has no public member made this gate VACUOUS ON EVERY
    // RUN: the corpus-wide maximum is ЕИК 811202228 at 123 co-owners and **0** public officers, so it
    // can never have one, and the FINDING-001 over-link guard — the defamation-sensitive one — had
    // simply stopped executing while reporting a tidy skip reason. Measured 2026-09-08: 1,507 companies
    // sit in the band and 849 of them DO carry a public member, the worst being ШИЙП ГРУП – 2016
    // (ЕИК 204133950, 97 co-owners / 2 public). The skip below now fires only when NONE is queryable,
    // which is the genuinely-not-exercisable case.
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
    const slug = big.slug;
    const bridgesFor = async (priv: boolean) => {
      const r = await connections(slug, priv);
      return {
        r,
        bridges: [
          ...(r?.related ?? []).flatMap((e) =>
            (e.companies ?? []).map((c) => c.eik),
          ),
          ...(r?.indirect ?? []).flatMap((e) => [e.c1?.eik, e.c2?.eik]),
        ].filter(Boolean) as string[],
      };
    };

    // PRIVATE — the FINDING-001 regression proper. coowner_count > 6, so it must not bridge at all.
    const priv = await bridgesFor(true);
    assert.ok(
      !priv.bridges.includes(big.eik),
      `company ${big.eik} (${big.coowners} co-owners, ${big.pub} public) bridged an edge for ` +
        `${slug} with private=true — the toggle guard does not bound total co-ownership degree, so ` +
        `this subject is being fanned out to named private individuals`,
    );

    // DEFAULT — it may bridge (public_officer_count <= 6 is the default guard), but the fan-out through
    // it must stay bounded by that same count. This is the property that makes the asymmetry safe; an
    // unbounded default fan-out would be the over-link arriving through the other door.
    const def = await bridgesFor(false);
    if (def.bridges.includes(big.eik)) {
      const named = new Set(
        [
          ...(def.r?.related ?? [])
            .filter((e) => (e.companies ?? []).some((c) => c.eik === big.eik))
            .map((e) => e.slug),
          ...(def.r?.indirect ?? [])
            .filter((e) => e.c1?.eik === big.eik || e.c2?.eik === big.eik)
            .map((e) => e.slug),
        ].filter(Boolean),
      );
      assert.ok(
        named.size <= 6,
        `company ${big.eik} (${big.coowners} co-owners, ${big.pub} public) named ${named.size} people ` +
          `for ${slug} on the DEFAULT path — the public-officer guard is no longer bounding the ` +
          `fan-out, so a mass-ownership vehicle is over-linking through the public view`,
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

  // Control: restore the expensive pre-fix body (the whole-corpus `co` CTE) as a 2-arg overload and
  // confirm this assertion would have caught it. NOT the whole old body — it keeps `co` + subj_co and
  // drops the rest, a LOWER BOUND (11,229 buffers) on what the ceiling must reject.
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
// the fan-out, so it stays FINITE. Measured 464 on the highest-verified-degree small-company subject;
// a regression that dropped the guard (fanning to scores of private co-owners, then indirect over their
// companies) would blow well past this. 2000 sits ~4× above the measurement.
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
