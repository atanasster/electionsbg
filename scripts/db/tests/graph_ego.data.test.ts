// Gate for person_graph_ego (084) — one person's own company neighbourhood (nodes + typed edges +
// money) behind the /api/db/graph-ego route and the /connections per-person mini. UNLIKE
// person_connections (person↔person, co-ownership only), this is the person↔COMPANY star across ALL
// edge kinds, and it NAMES ONLY THE SUBJECT — never a third party — so its privacy surface is the
// subject's own eligibility. Plan: docs/plans/connections-engine-v1.md §P3.5.
//
// Auto-skips when Postgres / the graph / the function is absent — like the other *.data.test.ts gates.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, withClient, end } from "../lib/pg";

type Ego = {
  subject: {
    slug: string;
    name: string;
    facet: string | null;
    money: number;
    degree: number;
  };
  companies: {
    eik: string;
    name: string | null;
    money: number;
    officers: number;
  }[];
  edges: { eik: string; kind: string; role: string; current: boolean | null }[];
  disclaimer: string;
} | null;

const ego = (slug: string, includePrivate = false): Promise<Ego> =>
  allRows<{ r: Ego }>("SELECT person_graph_ego($1, $2) AS r", [
    slug,
    includePrivate,
  ]).then((x) => x[0]?.r ?? null);

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regprocedure('person_graph_ego(text,boolean)') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM graph_edge",
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

const pickSlug = (sql: string, params?: unknown[]): Promise<string | null> =>
  allRows<{ slug: string }>(sql, params).then((r) => r[0]?.slug ?? null);

// Shape: a public figure with edges gets subject + companies (each with money + officers) + typed edges,
// and every edge's company is present in the companies array (internal closure the UI draws on).
test.skipIf(skip)(
  "returns the subject's company star with money + typed edges",
  async () => {
    const slug = await pickSlug(
      `SELECT g.slug FROM graph_person_node g
       JOIN person p ON p.person_id = g.person_id AND p.status = 'active' AND p.is_public_figure
      WHERE g.degree BETWEEN 1 AND 6
      ORDER BY g.degree DESC, g.person_id LIMIT 1`,
    );
    assert.ok(slug, "no public figure with 1-6 edges — fixture pool empty");

    const r = await ego(slug);
    assert.ok(r, `person_graph_ego returned null for ${slug}`);
    assert.equal(r.subject.slug, slug);
    assert.ok(r.companies.length > 0, `${slug} has edges but no company nodes`);
    assert.ok(
      r.edges.length > 0,
      `${slug} has edges but the edges array is empty`,
    );
    const eiks = new Set(r.companies.map((c) => c.eik));
    for (const c of r.companies) {
      assert.ok(
        typeof c.money === "number",
        `company ${c.eik} carries no money`,
      );
      assert.ok(
        typeof c.officers === "number",
        `company ${c.eik} carries no officer count`,
      );
    }
    for (const e of r.edges) {
      assert.ok(
        ["tr_role", "tr_owner", "declared_stake", "procurement"].includes(
          e.kind,
        ),
        `edge for ${e.eik} has an unknown kind ${e.kind}`,
      );
      assert.ok(
        eiks.has(e.eik),
        `edge company ${e.eik} is not in the companies array`,
      );
    }
    assert.ok(r.disclaimer?.length, "the identity disclaimer is missing");
  },
);

// The ego NAMES ONLY THE SUBJECT — the JSON must carry no other person's slug/name. This is the
// property that makes the ego a safer surface than person_connections; assert it structurally by
// checking the serialized payload contains no `slug` key other than the subject's.
test.skipIf(skip)("never names a third party", async () => {
  const slug = await pickSlug(
    `SELECT g.slug FROM graph_person_node g
       JOIN person p ON p.person_id = g.person_id AND p.status = 'active' AND p.is_public_figure
      WHERE g.degree BETWEEN 2 AND 6
      ORDER BY g.degree DESC, g.person_id LIMIT 1`,
  );
  if (!slug) return;
  const r = await ego(slug);
  assert.ok(r, `person_graph_ego returned null for ${slug}`);
  const slugKeys = JSON.stringify(r).match(/"slug":/g) ?? [];
  assert.equal(
    slugKeys.length,
    1,
    `ego payload carries ${slugKeys.length} slug keys — it should name only the subject`,
  );
});

// Live privacy gate — a review-status subject is not servable (proven via a rolled-back UPDATE, same as
// person_connections). The gate is LIVE on person, not on the graph snapshot.
test.skipIf(skip)("the privacy gate is live on the subject", async () => {
  const slug = await pickSlug(
    `SELECT slug FROM person WHERE status = 'active' AND is_public_figure ORDER BY slug LIMIT 1`,
  );
  assert.ok(slug, "no active public figure in the corpus");
  assert.ok(
    (await ego(slug)) !== null,
    "an eligible public figure was not served",
  );

  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query("UPDATE person SET status = 'review' WHERE slug = $1", [
        slug,
      ]);
      const { rows } = await c.query<{ r: Ego }>(
        "SELECT person_graph_ego($1) AS r",
        [slug],
      );
      assert.equal(
        rows[0]?.r ?? null,
        null,
        "a review-status subject still returned an ego payload — the gate is not live",
      );
    } finally {
      await c.query("ROLLBACK").catch(() => {});
    }
  });
});

// Tier-V toggle — a verified private owner is null by default, served with the toggle.
test.skipIf(skip)("the Tier-V toggle gates the subject", async () => {
  const vslug = await pickSlug(
    `SELECT slug FROM graph_person_node
      WHERE identity_confidence = 'verified' AND NOT is_public_figure
      ORDER BY degree DESC, person_id LIMIT 1`,
  );
  if (!vslug) return;
  assert.equal(
    await ego(vslug, false),
    null,
    `verified private ${vslug} was served on the DEFAULT path`,
  );
  assert.ok(
    (await ego(vslug, true)) !== null,
    `verified private ${vslug} was NOT served even with the toggle`,
  );
});

// Contract: an eligible person with NO graph edges returns a PAYLOAD (empty companies/edges), not null
// — matching person_connections' shape (FINDING-004). The subject is selected FROM person, not the
// graph node, precisely so a zero-edge subject still answers.
test.skipIf(skip)(
  "an eligible zero-edge subject returns an empty payload, not null",
  async () => {
    const slug = await pickSlug(`
    SELECT p.slug FROM person p
     WHERE p.status = 'active' AND p.is_public_figure
       AND NOT EXISTS (SELECT 1 FROM graph_person_node g WHERE g.person_id = p.person_id)
     ORDER BY p.slug LIMIT 1`);
    if (!slug) return; // every public figure has edges — nothing to test
    const r = await ego(slug);
    assert.ok(
      r,
      `person_graph_ego returned null for zero-edge eligible ${slug}`,
    );
    assert.equal(r.subject.slug, slug);
    assert.equal(
      r.companies.length,
      0,
      "a zero-edge subject should carry no companies",
    );
    assert.equal(
      r.edges.length,
      0,
      "a zero-edge subject should carry no edges",
    );
  },
);
