// graph_* schema contract (128) — the unified connections graph store (Phase 3). This pins the
// SHAPE (tables, edge grain, the money-on-company design, the kind vocabulary); the POPULATED-graph
// invariants (both lineages present, money reconciles, the >6-officer guard) live in
// graph.data.test.ts once the P3.3 loader fills them. Plan: docs/plans/connections-engine-v1.md §P3.2.
//
// Source assertions run without a DB (the shape is a text contract); the presence checks auto-skip
// when the tables are unbuilt (no loader applies 128 until P3.3).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end, pinLocalDatabase } from "../lib/pg";

pinLocalDatabase();

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const MIG = readFileSync(
  path.join(ROOT, "scripts/db/schema/pg/128_graph.sql"),
  "utf8",
);

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    return true;
  } catch {
    return false;
  }
};
const up = await reachable();

afterAll(async () => {
  await end();
});

// (source) The three tables exist in the migration.
test("128 defines graph_edge / graph_company_node / graph_person_node", () => {
  for (const t of ["graph_edge", "graph_company_node", "graph_person_node"])
    assert.match(
      MIG,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`),
      `128 must define ${t}`,
    );
});

// (source) The edge KIND vocabulary — the two lineages unified. A silently-dropped kind would lose
// a whole lineage; a widened one would let unvalidated edges in.
test("graph_edge.kind is exactly the four unified kinds", () => {
  assert.match(
    MIG,
    /kind\s+text\s+NOT NULL\s+CHECK \(kind IN \('tr_role','tr_owner','declared_stake','procurement'\)\)/,
    "graph_edge.kind CHECK must be exactly (tr_role, tr_owner, declared_stake, procurement)",
  );
});

// (source) The edge GRAIN — a person can hold several typed links to one company; role in the PK
// (NOT NULL DEFAULT '') keeps them distinct without NULL-in-PK.
test("graph_edge grain is (person_id, eik, kind, role)", () => {
  assert.match(MIG, /role\s+text\s+NOT NULL\s+DEFAULT ''/);
  assert.match(MIG, /PRIMARY KEY \(person_id, eik, kind, role\)/);
});

// (source) MONEY LIVES ON THE COMPANY NODE — the design decision the whole engine hangs on. Anchor
// to the graph_company_node block only (non-greedy to its closing `);`) so this cannot false-pass on
// graph_person_node's own public_money_eur further down the file.
test("public_money_eur is on the company node", () => {
  const block = MIG.match(
    /CREATE TABLE IF NOT EXISTS graph_company_node \(([\s\S]*?)\);/,
  );
  assert.ok(block, "graph_company_node table not found");
  assert.match(
    block[1],
    /public_money_eur\s+double precision/,
    "graph_company_node must carry public_money_eur (money is on the company, not the edge)",
  );
  // And graph_edge must NOT carry money — the edge is typed, money is on the company.
  const edge = MIG.match(
    /CREATE TABLE IF NOT EXISTS graph_edge \(([\s\S]*?)\);/,
  );
  assert.ok(
    edge && !/public_money_eur/.test(edge[1]),
    "money must not be on the edge",
  );
});

// (presence) When the tables ARE built (P3.3 ran), their keys are intact. Skips on a fresh DB.
test.skipIf(!up)("built tables carry their primary keys", async () => {
  const [t] = await allRows<{ e: string | null }>(
    "SELECT to_regclass('public.graph_edge')::text AS e",
  );
  if (!t?.e) return; // unbuilt — P3.3 has not run
  const pks = await allRows<{ conname: string }>(
    `SELECT conname FROM pg_constraint
      WHERE conrelid IN ('graph_edge'::regclass, 'graph_company_node'::regclass,
                         'graph_person_node'::regclass)
        AND contype = 'p'`,
  );
  assert.equal(pks.length, 3, "each graph_* table must have a primary key");
});
