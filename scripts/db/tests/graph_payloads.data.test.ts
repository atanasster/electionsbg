// graph_payloads (129 + the P3.4 blob build in load_graph_pg.ts) — the down-sampled PUBLIC-figure
// bridge graph behind /connections' overview. This pins the blob's internal consistency (the UI draws
// it directly, so a dangling edge or an off-cap node set is a render bug) and that the facet×facet
// matrix reconciles against the live graph. Plan: docs/plans/connections-engine-v1.md §P3.4.
//
// Auto-skips when Postgres is down or the blob is unbuilt — like the other *.data.test.ts gates.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end, pinLocalDatabase } from "../lib/pg";

pinLocalDatabase();

type Blob = {
  meta: { audience: string; companyCap: number; bridgeCompaniesTotal: number };
  companies: {
    eik: string;
    name: string | null;
    money: number;
    officers: number;
  }[];
  persons: {
    id: number;
    slug: string;
    name: string | null;
    facet: string | null;
    money: number;
    degree: number;
    party: string | null;
    partyColor: string | null;
  }[];
  edges: { p: number; c: string; kind: string }[];
  matrix: { a: string; b: string; companies: number }[];
  partyMatrix: { a: string; b: string; companies: number }[];
  partyColors: Record<string, string>;
};

const load = async (): Promise<Blob | null> => {
  try {
    const rows = await allRows<{ payload: Blob }>(
      "SELECT payload FROM graph_payloads WHERE scope='global'",
    );
    return rows[0]?.payload ?? null;
  } catch {
    return null; // no server / table missing
  }
};

const blob = await load();
const skip = blob === null;

const count = async (sql: string, params?: unknown[]): Promise<number> => {
  const [r] = await allRows<{ n: string }>(sql, params);
  return Number(r.n);
};

afterAll(async () => {
  await end();
});

// The blob is populated and bounded — company node set never exceeds the cap it advertises.
test.skipIf(skip)("blob is populated and within the company cap", () => {
  if (!blob) return;
  assert.ok(
    blob.companies.length > 0,
    "no bridge companies in the global blob",
  );
  assert.ok(blob.persons.length > 0, "no public figures in the global blob");
  assert.ok(
    blob.companies.length <= blob.meta.companyCap,
    `${blob.companies.length} companies exceeds cap ${blob.meta.companyCap}`,
  );
  // The cap is a down-sample of a larger set — the loader must actually be sampling, not shipping all.
  assert.ok(
    blob.meta.bridgeCompaniesTotal >= blob.companies.length,
    "bridgeCompaniesTotal is below the shipped company count — meta is wrong",
  );
  // Pin the cap against the literal so a stray edit to GLOBAL_COMPANY_CAP is a test failure, not a
  // silent re-scope of the overview (meta.companyCap alone can't detect that — same constant feeds it).
  assert.equal(
    blob.meta.companyCap,
    150,
    "global company cap changed unexpectedly",
  );
});

// INTERNAL CLOSURE — every edge endpoint is a node IN THE BLOB. The UI draws only these arrays, so a
// dangling edge (person or company not in the node set) is a broken link on the page.
test.skipIf(skip)("every blob edge connects two blob nodes", () => {
  if (!blob) return;
  const persons = new Set(blob.persons.map((p) => p.id));
  const companies = new Set(blob.companies.map((c) => c.eik));
  for (const e of blob.edges) {
    assert.ok(persons.has(e.p), `edge person ${e.p} is not a blob person node`);
    assert.ok(
      companies.has(e.c),
      `edge company ${e.c} is not a blob company node`,
    );
  }
});

// The audience is PUBLIC — the global overview must not leak the Tier-V private owners (they are the
// bulk of the graph; the whole down-sample premise is that the overview is public-figure only).
test.skipIf(skip)("every blob person is a public figure", async () => {
  if (!blob) return;
  const ids = blob.persons.map((p) => p.id).join(",");
  const nonPublic = await count(
    `SELECT count(*) n FROM graph_person_node
      WHERE person_id IN (${ids}) AND NOT is_public_figure`,
  );
  assert.equal(
    nonPublic,
    0,
    `${nonPublic} blob persons are not public figures`,
  );
});

// Companies are the RICHEST bridges — the array is money-sorted (the down-sample is "top-N by money").
test.skipIf(skip)("companies are sorted by money descending", () => {
  if (!blob) return;
  for (let i = 1; i < blob.companies.length; i++)
    assert.ok(
      blob.companies[i - 1].money >= blob.companies[i].money,
      `companies not money-sorted at index ${i}`,
    );
});

// The matrix is PUBLIC-ONLY — it must never carry a facet held only by private (Tier-V) people. This
// is the exact axis the reconciliation below is blind to (it re-derives from the same definition). Note
// the matrix is a GLOBAL public aggregate over ALL ≤6-officer public bridges, deliberately broader than
// the drawn top-150 `persons` sample — so the check is against every public figure's facet, NOT the
// drawn subset (a matrix facet like 'magistrate' can legitimately be absent from the 354 drawn people).
// Without co_facet's is_public_figure filter the private 'company' facet (53k owners) leaked in here.
test.skipIf(skip)("matrix facets are all public-figure facets", async () => {
  if (!blob) return;
  const rows = await allRows<{ facet: string }>(
    "SELECT DISTINCT facet FROM graph_person_node WHERE is_public_figure AND facet IS NOT NULL",
  );
  const publicFacets = new Set(rows.map((r) => r.facet));
  for (const cell of blob.matrix) {
    assert.ok(
      publicFacets.has(cell.a),
      `matrix facet ${cell.a} is not a public-figure facet (private leak?)`,
    );
    assert.ok(
      publicFacets.has(cell.b),
      `matrix facet ${cell.b} is not a public-figure facet (private leak?)`,
    );
  }
});

// MATRIX RECONCILIATION — re-derive EVERY cell from the live graph and compare. cell(a,b) = ≤6-officer
// companies bridging PUBLIC facet a and b (a<b: both present; a=b: ≥2 of that facet). The is_public_figure
// filter must match the loader's co_facet; reconciling all ~15 cells (not a top-N sample) guarantees the
// same-facet diagonal branch is exercised. Facet values are parameterized ($1/$2), not interpolated.
test.skipIf(skip)(
  "facet×facet matrix cells reconcile with the graph",
  async () => {
    if (!blob) return;
    const sameSql = `SELECT count(*) n FROM (
         SELECT e.eik FROM graph_edge e
           JOIN graph_person_node p ON p.person_id=e.person_id AND p.is_public_figure AND p.facet=$1
           JOIN graph_company_node cn ON cn.eik=e.eik AND cn.officer_count<=6
          GROUP BY e.eik HAVING count(DISTINCT e.person_id) >= 2) x`;
    const crossSql = `SELECT count(*) n FROM (
         SELECT ca.eik FROM
           (SELECT DISTINCT e.eik FROM graph_edge e
              JOIN graph_person_node p ON p.person_id=e.person_id AND p.is_public_figure AND p.facet=$1
              JOIN graph_company_node cn ON cn.eik=e.eik AND cn.officer_count<=6) ca
           JOIN
           (SELECT DISTINCT e.eik FROM graph_edge e
              JOIN graph_person_node p ON p.person_id=e.person_id AND p.is_public_figure AND p.facet=$2
              JOIN graph_company_node cn ON cn.eik=e.eik AND cn.officer_count<=6) cb
           ON cb.eik = ca.eik) y`;
    assert.ok(blob.matrix.length > 0, "empty matrix");
    let sawDiagonal = false;
    for (const cell of blob.matrix) {
      const [a, b] = cell.a <= cell.b ? [cell.a, cell.b] : [cell.b, cell.a];
      if (a === b) sawDiagonal = true;
      const live =
        a === b ? await count(sameSql, [a]) : await count(crossSql, [a, b]);
      assert.equal(
        cell.companies,
        live,
        `matrix cell (${a},${b}) blob ${cell.companies} vs live ${live}`,
      );
    }
    assert.ok(
      sawDiagonal,
      "no same-facet diagonal cell — the a=b branch went untested",
    );
  },
);

// PARTY×PARTY is the politician-facet slice of the matrix (P4.1). Same shape as facet×facet but
// narrowed to facet='politician' AND party IS NOT NULL. Reconcile every cell, and confirm the blob's
// drawn persons carry the party where the graph node has it (so the UI can colour them).
test.skipIf(skip)(
  "party×party matrix cells reconcile with the graph",
  async () => {
    if (!blob) return;
    const sameSql = `SELECT count(*) n FROM (
       SELECT e.eik FROM graph_edge e
         JOIN graph_person_node p ON p.person_id=e.person_id AND p.is_public_figure
           AND p.facet='politician' AND p.party=$1
         JOIN graph_company_node cn ON cn.eik=e.eik AND cn.officer_count<=6
        GROUP BY e.eik HAVING count(DISTINCT e.person_id) >= 2) x`;
    const crossSql = `SELECT count(*) n FROM (
       SELECT ca.eik FROM
         (SELECT DISTINCT e.eik FROM graph_edge e
            JOIN graph_person_node p ON p.person_id=e.person_id AND p.is_public_figure
              AND p.facet='politician' AND p.party=$1
            JOIN graph_company_node cn ON cn.eik=e.eik AND cn.officer_count<=6) ca
         JOIN
         (SELECT DISTINCT e.eik FROM graph_edge e
            JOIN graph_person_node p ON p.person_id=e.person_id AND p.is_public_figure
              AND p.facet='politician' AND p.party=$2
            JOIN graph_company_node cn ON cn.eik=e.eik AND cn.officer_count<=6) cb
         ON cb.eik = ca.eik) y`;
    // A corpus with party-tagged politicians co-owning companies should have a non-empty party matrix;
    // if it is empty, there is simply nothing to reconcile (assert nothing rather than fail).
    for (const cell of blob.partyMatrix) {
      const [a, b] = cell.a <= cell.b ? [cell.a, cell.b] : [cell.b, cell.a];
      const live =
        a === b ? await count(sameSql, [a]) : await count(crossSql, [a, b]);
      assert.equal(
        cell.companies,
        live,
        `partyMatrix cell (${a},${b}) blob ${cell.companies} vs live ${live}`,
      );
    }
  },
);

// The drawn persons carry party where the graph node has one — the UI colours politician nodes by it.
test.skipIf(skip)("blob persons carry the graph node's party", async () => {
  if (!blob) return;
  const withParty = blob.persons
    .filter((p) => p.party != null)
    .map((p) => p.id);
  // Every person the graph node tags with a party must surface it in the blob (no silent drop).
  const ids = blob.persons.map((p) => p.id).join(",");
  const graphParty = await count(
    `SELECT count(*) n FROM graph_person_node WHERE person_id IN (${ids}) AND party IS NOT NULL`,
  );
  assert.equal(
    withParty.length,
    graphParty,
    `blob surfaced ${withParty.length} party-tagged persons but the graph node has ${graphParty}`,
  );
  // And every partyMatrix facet is a party some drawn politician carries would be too strong (the
  // matrix is a global aggregate, broader than the drawn set) — but every matrix party must be a real
  // party on SOME politician graph node (never a leak from a non-politician facet).
  for (const cell of blob.partyMatrix.slice(0, 20)) {
    for (const p of [cell.a, cell.b]) {
      const real = await count(
        `SELECT count(*) n FROM graph_person_node
          WHERE facet='politician' AND party=$1 AND is_public_figure`,
        [p],
      );
      assert.ok(
        real > 0,
        `partyMatrix party ${p} matches no public politician node`,
      );
    }
  }
});

// partyColors covers EVERY public politician party that carries a colour (a GLOBAL palette, so the UI
// can colour a party×party axis whose party is off the drawn set). One colour per party.
test.skipIf(skip)("partyColors is a global politician palette", async () => {
  if (!blob) return;
  const keys = Object.keys(blob.partyColors);
  assert.ok(keys.length > 0, "partyColors is empty");
  const c = await count(
    `SELECT count(DISTINCT party) n FROM graph_person_node
      WHERE facet='politician' AND party IS NOT NULL AND party_color IS NOT NULL`,
  );
  assert.equal(
    keys.length,
    c,
    `partyColors has ${keys.length} entries but ${c} politician parties carry a colour`,
  );
});
