// Every relation `/api/db` reads must actually be readable by `app_readonly`.
//
// ⚠️ THIS CLOSES A CLASS, NOT A BUG. A missing GRANT is invisible from every angle a
// reviewer normally checks: the migration applies, the loader succeeds, every row
// count reconciles, and both the loaders and the *.data.test.ts gates connect as the
// OWNER — which is why local is green. It surfaces only as a 42501 on Cloud SQL,
// against a corpus that looks fully loaded.
//
// Migration 146 shipped exactly this way: seven tables behind three routes, zero
// GRANTs. The existing gate (b8aa2d69d2) asserts that every GRANT in schema/pg is
// role-guarded — 146 passed it trivially by containing none. That gate checks the
// SHAPE of grants that exist; this one checks that a table the API reads has one.
//
// Skips when Postgres is down, like every *.data.test.ts.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../lib/pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FN_DIR = path.resolve(__dirname, "../../../functions");

/**
 * Candidate relation names in the serving code.
 *
 * TWO extractors, because one is not enough and the gap is not hypothetical: a
 * literal `FROM x` scan misses every table whose name reaches SQL through a
 * descriptor rather than the query text. `tender_search_text` is exactly that — the
 * tenders search interpolates `searchInSet.table`, so the string appears only as a
 * property value and a FROM-only scan reports it as unread. It was the table that
 * caught this, and the class it belongs to is "any dynamically-built query".
 *
 * So the second extractor takes every bare-identifier string literal in the file.
 * That over-collects (route names, column names, keys), which is harmless: the SQL
 * below keeps only names that are real relations in `public`, and asserting a grant
 * on a relation the API merely MIGHT read is the safe direction to be wrong in.
 */
const readRelations = (): Set<string> => {
  const out = new Set<string>();
  for (const f of ["db_routes.js", "db_table.js"]) {
    const src = fs.readFileSync(path.join(FN_DIR, f), "utf8");
    for (const m of src.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)\b/gi))
      out.add(m[1].toLowerCase());
    for (const m of src.matchAll(/["'`]([a-z_][a-z0-9_]{2,})["'`]/g))
      out.add(m[1].toLowerCase());
  }
  return out;
};

let up = false;
let roleExists = false;

beforeAll(async () => {
  try {
    const r = await getPool().query(
      "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') e",
    );
    up = true;
    roleExists = r.rows[0].e;
  } catch {
    up = false;
  }
});

afterAll(async () => {
  if (up) await getPool().end();
});

describe("app_readonly can read everything /api/db selects from", () => {
  it("finds a non-trivial set of relations to check", () => {
    // Guards the regex: if it stopped matching, every assertion below would pass
    // vacuously and this file would silently stop being a gate.
    const rels = readRelations();
    expect(rels.size).toBeGreaterThan(50);
    expect(rels.has("tenders")).toBe(true);
    expect(rels.has("tender_search_text")).toBe(true);
  });

  it("grants SELECT on every relation the routes read", async () => {
    if (!up) return;
    // On a database where roles_readonly.sql was never run there is nothing to
    // assert — that is the documented cold-bootstrap state, and the GRANTs in
    // schema/pg are role-guarded precisely so it stays legal.
    if (!roleExists) return;

    const names = [...readRelations()];
    const { rows } = await getPool().query<{
      rel: string;
      kind: string;
      granted: boolean;
    }>(
      `SELECT c.relname AS rel, c.relkind::text AS kind,
              has_table_privilege('app_readonly', c.oid, 'SELECT') AS granted
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r','v','m','p')
          AND c.relname = ANY($1::text[])`,
      [names],
    );

    // Only relations that actually exist here are checked — a route may read a
    // table this database has never loaded, which is a different (documented)
    // condition and not this gate's business.
    const missing = rows.filter((r) => !r.granted).map((r) => r.rel);
    expect(
      missing,
      `these relations are read by /api/db but app_readonly cannot SELECT them — ` +
        `green locally (loaders and tests connect as the owner), 42501 on Cloud SQL: ` +
        missing.join(", "),
    ).toEqual([]);

    // …and the probe must have found something, or an empty `missing` proves nothing.
    expect(rows.length).toBeGreaterThan(20);
  });
});
