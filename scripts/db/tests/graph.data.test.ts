// graph_* POPULATED invariants (128 + the P3.3 loader load_graph_pg.ts). The SHAPE contract lives in
// graph_schema.data.test.ts (source-level, no DB); this pins what the LOADER must produce:
//   • BOTH lineages present — co-ownership (tr_role/tr_owner) AND procurement.
//   • money on the company node reconciles to company_public_money (127), eik-for-eik.
//   • a person's money = Σ over their DISTINCT linked company nodes (broad basis).
//   • referential closure — every edge's person/company has a node.
//   • the mass-membership signal is STORED not filtered (edges through >6-officer orgs survive).
//   • the procurement bridge actually mapped (company_politicians.ref → person_id).
// Plan: docs/plans/connections-engine-v1.md §P3.3.
//
// Auto-skips when Postgres is down or the graph is unbuilt — like the other *.data.test.ts gates.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end, pinLocalDatabase } from "../lib/pg";

pinLocalDatabase();

const state = async (): Promise<"ok" | "no-server" | "missing" | "empty"> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.graph_edge') IS NOT NULL AS ok",
    );
    if (!t?.ok) return "missing";
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM graph_edge",
    );
    return Number(c.n) > 0 ? "ok" : "empty";
  } catch {
    return "no-server";
  }
};

const dbState = await state();
const skip = dbState === "no-server" || dbState === "missing";

const count = async (sql: string): Promise<number> => {
  const [r] = await allRows<{ n: string }>(sql);
  return Number(r.n);
};

afterAll(async () => {
  await end();
});

// BOTH lineages present — the whole point of the unified store. A zero on either means a lineage
// silently dropped (an empty co-ownership arm, or a broken procurement bridge).
test.skipIf(skip)("both lineages produced edges", async () => {
  const coown = await count(
    "SELECT count(*) n FROM graph_edge WHERE kind IN ('tr_role','tr_owner')",
  );
  assert.ok(coown > 50000, `only ${coown} co-ownership edges (expected ~160k)`);
  // The procurement arm only exists once company_politicians is loaded (out-of-band db:load:tr:pg).
  // Assert proc>0 ONLY when that source has rows — else a bare DB (tr never ingested) would fail here
  // rather than skip, unlike the rest of the person suite which assumes tr/agri are loaded.
  const cp = await count("SELECT count(*) n FROM company_politicians");
  if (cp > 0) {
    const proc = await count(
      "SELECT count(*) n FROM graph_edge WHERE kind = 'procurement'",
    );
    assert.ok(
      proc > 0,
      "no procurement edges — the ref→person_id bridge is broken",
    );
  }
});

// The procurement bridge mapped a healthy fraction of company_politicians. A near-zero mapped count
// is the roster-re-slug failure the loader's own preflight guards; this pins it as a green invariant
// too. (~95% map — a handful of cp refs point at persons that never resolved.)
test.skipIf(skip)(
  "procurement bridge mapped most of company_politicians",
  async () => {
    const cp = await count("SELECT count(*) n FROM company_politicians");
    if (cp === 0) return;
    const mapped = await count(
      "SELECT count(*) n FROM graph_edge WHERE kind = 'procurement'",
    );
    assert.ok(
      mapped >= cp * 0.8,
      `only ${mapped}/${cp} company_politicians mapped to person_id (bridge degraded)`,
    );
  },
);

// PER-ARM bridge coverage — the failure the single total-count above CANNOT see. The bridge has two
// independent arms (mp / official) and a roster re-slug typically breaks only the OFFICIAL arm; the
// mp arm's edges then survive and every total-count assertion passes on a half-missing lineage. This
// re-runs each substring join and asserts each non-empty arm mapped a healthy fraction — the same
// per-arm guard the loader preflight now enforces (the only one that runs on Cloud SQL).
test.skipIf(skip)("both procurement arms mapped", async () => {
  const rows = await allRows<{
    cp_mp: string;
    mapped_mp: string;
    cp_off: string;
    mapped_off: string;
  }>(
    `SELECT
       (SELECT count(*) FROM company_politicians WHERE kind='mp' AND eik<>'')       AS cp_mp,
       (SELECT count(DISTINCT (pr.person_id, cp.eik)) FROM company_politicians cp
          JOIN person_role pr ON pr.source='mp'
           AND pr.ref = substring(cp.ref from '^/candidate/mp-(.*)$')
         WHERE cp.kind='mp' AND cp.eik<>'')                                          AS mapped_mp,
       (SELECT count(*) FROM company_politicians WHERE kind='official' AND eik<>'')  AS cp_off,
       (SELECT count(DISTINCT (pr.person_id, cp.eik)) FROM company_politicians cp
          JOIN person_role pr ON pr.ref = substring(cp.ref from '^/officials/(.*)$')
         WHERE cp.kind='official' AND cp.eik<>'')                                    AS mapped_off`,
  );
  const r = rows[0];
  const cpMp = Number(r.cp_mp);
  const cpOff = Number(r.cp_off);
  if (cpMp > 0)
    assert.ok(
      Number(r.mapped_mp) >= cpMp * 0.5,
      `mp arm mapped only ${r.mapped_mp}/${cpMp} — the mp bridge is broken`,
    );
  if (cpOff > 0)
    assert.ok(
      Number(r.mapped_off) >= cpOff * 0.5,
      `officials arm mapped only ${r.mapped_off}/${cpOff} — the officials bridge is broken`,
    );
});

// Money on the company node == company_public_money (127), eik-for-eik. Sampled over the largest
// figures, where a basis difference is most likely and most damaging. The node's money IS the matview's
// (a plain JOIN), so a drift here means the loader stopped joining 127.
test.skipIf(skip)(
  "company node money equals company_public_money",
  async () => {
    const rows = await allRows<{ eik: string; node: number; mv: number }>(
      `SELECT cn.eik, cn.public_money_eur AS node,
            coalesce(m.public_money_eur, 0) AS mv
       FROM graph_company_node cn
       LEFT JOIN company_public_money m ON m.eik = cn.eik
      ORDER BY cn.public_money_eur DESC
      LIMIT 25`,
    );
    assert.ok(rows.length > 0, "no company nodes");
    for (const r of rows)
      assert.ok(
        Math.abs(Number(r.node) - Number(r.mv)) < 1,
        `${r.eik}: node ${r.node} vs company_public_money ${r.mv} — money basis drifted`,
      );
  },
);

// A person's money == Σ over their DISTINCT linked company nodes. Re-derives it from the edges and
// company nodes and compares to the stored figure on the top-money people. Catches a loader that
// summed edges (double-counting a company a person links to twice) instead of distinct companies.
test.skipIf(skip)("person money is the distinct-company sum", async () => {
  const rows = await allRows<{
    person_id: string;
    node: number;
    derived: number;
  }>(
    `WITH top AS (
       SELECT person_id, public_money_eur FROM graph_person_node
        ORDER BY public_money_eur DESC LIMIT 25
     ),
     derived AS (
       SELECT d.person_id, coalesce(sum(cn.public_money_eur), 0) AS money
         FROM (SELECT DISTINCT person_id, eik FROM graph_edge) d
         JOIN graph_company_node cn ON cn.eik = d.eik
        WHERE d.person_id IN (SELECT person_id FROM top)
        GROUP BY d.person_id
     )
     SELECT t.person_id, t.public_money_eur AS node, coalesce(dv.money, 0) AS derived
       FROM top t LEFT JOIN derived dv ON dv.person_id = t.person_id`,
  );
  assert.ok(rows.length > 0, "no person nodes");
  for (const r of rows)
    assert.ok(
      Math.abs(Number(r.node) - Number(r.derived)) < 1,
      `person ${r.person_id}: node ${r.node} vs distinct-company sum ${r.derived}`,
    );
});

// Referential closure — every edge endpoint has a node. A dangling edge would crash the ego/global
// serving joins (or silently drop the row).
test.skipIf(skip)("every edge endpoint has a node", async () => {
  const orphanPersons = await count(
    `SELECT count(*) n FROM graph_edge e
      WHERE NOT EXISTS (SELECT 1 FROM graph_person_node p WHERE p.person_id = e.person_id)`,
  );
  const orphanCompanies = await count(
    `SELECT count(*) n FROM graph_edge e
      WHERE NOT EXISTS (SELECT 1 FROM graph_company_node c WHERE c.eik = e.eik)`,
  );
  assert.equal(
    orphanPersons,
    0,
    `${orphanPersons} edges reference a missing person node`,
  );
  assert.equal(
    orphanCompanies,
    0,
    `${orphanCompanies} edges reference a missing company node`,
  );
});

// officer_count is the DISTINCT-person degree of the company, and mass-membership orgs (>6) are KEPT,
// not filtered — the guard is applied at traversal time, so the edges through them must still exist.
test.skipIf(skip)("mass-membership companies keep their edges", async () => {
  const mass = await count(
    "SELECT count(*) n FROM graph_company_node WHERE officer_count > 6",
  );
  assert.ok(mass > 0, "expected some mass-membership (>6-officer) companies");
  // Their edges are present, NOT pre-filtered. Each >6-officer company has by definition ≥7 distinct
  // linked people, hence ≥7 edges, so the total through all of them must be ≥ 7×mass. A loader that
  // filtered most mass-membership edges (keeping a few) would fall below this floor — `>= mass` would
  // not bite, since even one surviving edge per company clears it.
  const edgesThrough = await count(
    `SELECT count(*) n FROM graph_edge e
      WHERE e.eik IN (SELECT eik FROM graph_company_node WHERE officer_count > 6)`,
  );
  assert.ok(
    edgesThrough >= 7 * mass,
    `mass-membership edges (${edgesThrough}) below 7×${mass} — they were filtered, not just flagged`,
  );
});

// officer_count reconciles to the distinct linked people on the edge table (the number the >6 guard
// keys on). A drift means the count was computed off a different grain than the edges serve.
test.skipIf(skip)("officer_count equals distinct linked people", async () => {
  const drift = await count(
    `SELECT count(*) n FROM graph_company_node cn
       WHERE cn.officer_count IS DISTINCT FROM (
         SELECT count(DISTINCT person_id) FROM graph_edge e WHERE e.eik = cn.eik
       )`,
  );
  assert.equal(drift, 0, `${drift} company nodes have a stale officer_count`);
});

// public_officer_count — the association-noise GUARD the connections serving layer (084) keys on — is
// distinct PUBLIC-figure CO-OWNERSHIP officers, and must EQUAL the old per-request public_officer_count
// basis (person_role source tr/ngo ∩ public ∩ active). This is the invariant that makes the graph
// re-point behaviour-preserving; a drift silently over- or under-links the whole connections graph.
test.skipIf(skip)(
  "public_officer_count equals the live person_role basis",
  async () => {
    const drift = await count(
      `SELECT count(*) n FROM graph_company_node cn
       WHERE cn.public_officer_count IS DISTINCT FROM coalesce((
         SELECT count(DISTINCT r.person_id)
           FROM person_role r JOIN person p USING (person_id)
          WHERE r.source IN ('tr','ngo') AND r.ref = cn.eik
            AND p.is_public_figure AND p.status = 'active'), 0)`,
    );
    assert.equal(
      drift,
      0,
      `${drift} company nodes' public_officer_count drifted from the person_role guard basis`,
    );
  },
);

// party/party_color (P4.1) = the person's LATEST electoral affiliation. Reconcile the stored column to
// person_election_stats (newest election carrying a party); a drift would mis-colour or mis-slice the
// /connections party×party matrix. Politicians are where it lives; assert it is actually populated.
test.skipIf(skip)(
  "party equals the latest person_election_stats affiliation",
  async () => {
    const drift = await count(
      `SELECT count(*) n FROM graph_person_node g
         WHERE g.party IS DISTINCT FROM (
           SELECT party_nick FROM person_election_stats pes
            WHERE pes.person_id = g.person_id AND pes.party_nick IS NOT NULL
            ORDER BY election_date DESC LIMIT 1)`,
    );
    assert.equal(
      drift,
      0,
      `${drift} graph persons' party drifted from person_election_stats`,
    );
    const politiciansWithParty = await count(
      "SELECT count(*) n FROM graph_person_node WHERE facet='politician' AND party IS NOT NULL",
    );
    assert.ok(
      politiciansWithParty > 100,
      `only ${politiciansWithParty} politician nodes carry a party — the party join looks broken`,
    );
  },
);

// The loader builds into UNLOGGED stage twins and merges (scripts/db/lib/stage_merge.ts) rather than
// TRUNCATEing tables /api/db/person-connections, person-graph-ego and connections-graph read — see
// person_reload_locks.data.test.ts. The twins must not outlive the load: they are unlogged scratch,
// and one left behind reaches pg_dump and db:sync:cloud.
test.skipIf(skip)("no graph stage twin outlived the load", async () => {
  const leftover = await count(
    `SELECT count(*) n FROM pg_class
      WHERE relkind = 'r'
        AND relname IN ('graph_edge_stage','graph_company_node_stage',
                        'graph_person_node_stage','graph_payloads_stage')`,
  );
  assert.equal(
    leftover,
    0,
    "a graph stage twin outlived the load — it would reach pg_dump and db:sync:cloud",
  );
});
