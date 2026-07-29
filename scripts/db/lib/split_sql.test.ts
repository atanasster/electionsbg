// The splitter behind execEach. Its whole job is to let DDL run statement-by-
// statement so a multi-table script cannot hold one table's AccessExclusive lock
// while reaching for another's (the 40P01 that killed db:load:tenders:pg:cloud
// on 2026-07-29). Splitting on a bare `;` would corrupt any function body, so
// the dollar-quote cases below are the ones that actually matter.
//
//   npx vitest run scripts/db/lib/split_sql.test.ts

import { test, describe } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitSqlStatements } from "./split_sql";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("splitSqlStatements", () => {
  test("splits plain statements and drops the empty tail", () => {
    assert.deepEqual(splitSqlStatements("SELECT 1; SELECT 2;"), [
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  test("keeps a trailing statement with no terminating semicolon", () => {
    assert.deepEqual(splitSqlStatements("SELECT 1"), ["SELECT 1"]);
  });

  test("does not split inside a dollar-quoted body", () => {
    const sql = `
CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1;
  RETURN 2;
END;
$$;
SELECT 3;`;
    const out = splitSqlStatements(sql);
    assert.equal(out.length, 2);
    assert.ok(out[0].includes("PERFORM 1;"));
    assert.ok(out[0].includes("RETURN 2;"));
    assert.equal(out[1], "SELECT 3");
  });

  test("respects a tagged dollar quote containing a bare $$", () => {
    const sql = `CREATE FUNCTION g() RETURNS text AS $body$ SELECT '$$'; $body$; SELECT 1;`;
    const out = splitSqlStatements(sql);
    assert.equal(out.length, 2);
    assert.equal(out[1], "SELECT 1");
  });

  test("does not split on a semicolon inside a string literal", () => {
    const out = splitSqlStatements("SELECT 'a;b'; SELECT 2;");
    assert.deepEqual(out, ["SELECT 'a;b'", "SELECT 2"]);
  });

  test("handles an escaped quote inside a string literal", () => {
    const out = splitSqlStatements("SELECT 'it''s; fine'; SELECT 2;");
    assert.deepEqual(out, ["SELECT 'it''s; fine'", "SELECT 2"]);
  });

  test("does not split on a semicolon inside a quoted identifier", () => {
    const out = splitSqlStatements('SELECT "we;ird"; SELECT 2;');
    assert.deepEqual(out, ['SELECT "we;ird"', "SELECT 2"]);
  });

  test("ignores semicolons in line and block comments", () => {
    // Comments stay attached to the following statement (Postgres ignores them,
    // and keeping them makes a failing statement readable in the error). What
    // must hold is that their semicolons did not split anything.
    const out = splitSqlStatements(
      "SELECT 1; -- trailing; comment\n/* block; comment */ SELECT 2;",
    );
    assert.equal(out.length, 2);
    assert.equal(out[0], "SELECT 1");
    assert.ok(out[1].endsWith("SELECT 2"));
  });

  test("drops comment-only chunks rather than sending empty queries", () => {
    assert.deepEqual(splitSqlStatements("-- just a comment\n;\nSELECT 1;"), [
      "SELECT 1",
    ]);
  });
});

describe("the real file execEach is pointed at", () => {
  const sql = readFileSync(
    path.join(
      __dirname,
      "../schema/pg/113_procurement_browser_covering_indexes.sql",
    ),
    "utf8",
  );

  test("splits into individually-idempotent index DDL", () => {
    const stmts = splitSqlStatements(sql);
    assert.ok(stmts.length >= 8, `expected ≥8 statements, got ${stmts.length}`);
    for (const s of stmts) {
      const head = s
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/--[^\n]*/g, "")
        .trim();
      assert.match(
        head,
        /^(DROP INDEX IF EXISTS|CREATE INDEX IF NOT EXISTS|ANALYZE|SET|COMMENT)/i,
        `statement is not idempotent DDL — per-statement execution would not be safe:\n${head.slice(0, 120)}`,
      );
    }
  });

  test("every statement targets exactly one of the two hot tables", () => {
    // The point of the split: no single statement may hold locks on BOTH
    // contracts and tenders, or the deadlock cycle is still reachable.
    for (const s of splitSqlStatements(sql)) {
      const body = s.toLowerCase();
      const both =
        body.includes(" on contracts") && body.includes(" on tenders");
      assert.equal(
        both,
        false,
        `statement spans both tables:\n${s.slice(0, 120)}`,
      );
    }
  });
});
