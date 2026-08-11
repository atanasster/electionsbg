// 003_tr_search.sql may not DROP its tables, and that has a price this file collects.
//
// The DROPs were removed because `DROP TABLE … CASCADE` on tr_companies / tr_officers /
// tr_person_roles silently deleted three matviews owned by OTHER migrations —
// person_browse_table (120), declaration_stake_company (096), company_officer_counts (071) —
// on every `db:load:tr:pg`, at exit 0. 003's header has the full account.
//
// What that costs: `CREATE TABLE IF NOT EXISTS` is a no-op on a warm database, so the CREATEs
// alone would trade a loud data loss for a quiet SCHEMA DRIFT — a new column would land on a
// fresh clone and on nothing else, which is the same class of defect wearing different
// clothes. The reconcile block at the foot of 003 (`ADD COLUMN IF NOT EXISTS`) is what
// actually reaches a warm database, and this file is what keeps the two lists in step.
//
// Deliberately a PURE TEXT test with no database: it has to fail on the machine of whoever
// edits the DDL, before any load, and the drift it catches is between two halves of one file.

import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../lib/paths";

const FILE = path.join(REPO_ROOT, "scripts/db/schema/pg/003_tr_search.sql");
const sql = readFileSync(FILE, "utf8");

/** The file with `--` comments removed — every parse below runs on this. */
const code = sql
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

type Col = { name: string; generated: boolean };

/** Column list of `CREATE TABLE IF NOT EXISTS <table> ( … )`, split at paren depth 0 so a
 *  `GENERATED ALWAYS AS (translit_bg_latin(name)) STORED` stays one entry. */
const createdCols = (table: string): Col[] => {
  // Assert the CREATE was found BEFORE searching for its paren. indexOf("(", -1)
  // is treated as indexOf("(", 0) and returns the first paren in the FILE, so a
  // renamed or removed CREATE would sail past `open > 0` and silently parse a
  // different table's column list — surfacing as a confusing column mismatch
  // instead of the message below.
  const at = code.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(at >= 0, `no CREATE TABLE IF NOT EXISTS ${table} in 003`);
  const open = code.indexOf("(", at);
  assert.ok(open > 0, `CREATE TABLE ${table} has no column list`);
  let depth = 0;
  let end = -1;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) {
      end = i;
      break;
    }
  }
  assert.ok(end > 0, `unbalanced parens in CREATE TABLE ${table}`);

  const parts: string[] = [];
  let buf = "";
  depth = 0;
  for (const ch of code.slice(open + 1, end)) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
    } else buf += ch;
  }
  parts.push(buf);

  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({
      name: p.split(/\s+/)[0] as string,
      generated: /\bGENERATED\b/i.test(p),
    }));
};

/** Column list of the `ALTER TABLE <table> ADD COLUMN IF NOT EXISTS …` reconcile block. */
const reconciledCols = (table: string): Col[] =>
  [
    ...code.matchAll(
      new RegExp(
        `ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+([a-z0-9_]+)([^;]*);`,
        "gi",
      ),
    ),
  ].map((m) => ({
    name: m[1] as string,
    generated: /\bGENERATED\b/i.test(m[2] as string),
  }));

const TABLES = [
  "tr_companies",
  "ngo_details",
  "tr_officers",
  "tr_person_roles",
] as const;

test("003 never DROPs a table — its CASCADE deleted three other migrations' matviews", () => {
  assert.deepStrictEqual(
    code.split("\n").filter((l) => /^\s*DROP\b/i.test(l)),
    [],
    "003_tr_search.sql has regained a DROP. load_tr_pg.ts applies this file on EVERY run, " +
      "and person_browse_table (120), declaration_stake_company (096) and " +
      "company_officer_counts (071) read these tables — so a DROP … CASCADE deletes all " +
      "three at exit 0, and a DROP without CASCADE aborts every TR load with 2BP01. Replace " +
      "the whole contents instead (load_tr_pg.ts's replaceTable), and see 003's header.",
  );
});

test("every 003 column is in BOTH the CREATE and the reconcile block", () => {
  for (const table of TABLES) {
    const created = createdCols(table);
    const reconciled = reconciledCols(table);
    assert.ok(
      created.length > 0,
      `parsed no columns out of CREATE TABLE ${table}`,
    );

    assert.deepStrictEqual(
      reconciled.map((c) => c.name),
      created.map((c) => c.name),
      `${table}: the CREATE and the ADD COLUMN IF NOT EXISTS reconcile block disagree. ` +
        `The CREATE is a no-op on a warm database, so a column missing from the reconcile ` +
        `block reaches a fresh clone and NOTHING else — silently. Add the matching ` +
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS … line (same order, no NOT NULL / ` +
        `PRIMARY KEY — see 003's header for why).`,
    );

    // A generated column reconciled as a plain one is worse than missing: it exists, so
    // IF NOT EXISTS never fires again, and it holds NULL for ever on that database.
    for (const [i, c] of created.entries())
      assert.equal(
        reconciled[i]?.generated,
        c.generated,
        `${table}.${c.name}: GENERATED in the CREATE but not in the reconcile block (or ` +
          `vice versa). Carry the full \`GENERATED ALWAYS AS (…) STORED\` clause across.`,
      );
  }
});

test("the reconcile block declares no constraint the ALTER cannot apply", () => {
  // NOT NULL / PRIMARY KEY on a genuinely-new column of a populated 1M-row table aborts the
  // ALTER, and exec() sends a migration as one implicit transaction — so the whole file rolls
  // back and every TR load fails. The constraints belong on the CREATE, for fresh databases.
  for (const m of code.matchAll(
    /ALTER\s+TABLE\s+[a-z0-9_]+\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+([a-z0-9_]+)([^;]*);/gi,
  ))
    assert.ok(
      !/\b(NOT\s+NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES)\b/i.test(m[2] as string),
      `003's reconcile line for ${m[1]} carries a constraint. On a warm, populated table ` +
        `that ALTER throws and rolls back the whole migration, failing every TR load.`,
    );
});
