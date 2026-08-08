// The generated migration is in sync with the rule table it is generated from.
//
// Without this, editing src/lib/shlyoRules.ts and forgetting to regenerate leaves the
// browser and Postgres on two different tables — which is the exact failure the generator
// exists to prevent, arrived at one step later. Nothing else would report it: both sides
// compile, both return rows, and only the queries that need the changed rule differ.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { buildSql, OUT } from "./shlyo_query_fold";
import { SHLYO_RULES } from "@/lib/shlyoRules";

describe("141_shlyo_query_fold.sql", () => {
  it("is byte-identical to what the generator emits", () => {
    expect(existsSync(OUT)).toBe(true);
    expect(readFileSync(OUT, "utf8")).toBe(buildSql());
  });

  it("carries every rule, in order, innermost-first", () => {
    // The nesting order IS the application order — reversing it silently changes what the
    // fold means ("6" would eat the "6" of "6t" before the щ rule saw it).
    const sql = buildSql();
    const positions = SHLYO_RULES.map((r) => sql.indexOf(`, '${r.find}', `));
    expect(positions.every((p) => p >= 0)).toBe(true);
    // Innermost call appears FIRST in the source text, so positions must ascend.
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("says it is generated, and names the source and the command", () => {
    // A generated file that does not announce itself gets hand-edited once.
    const sql = buildSql();
    expect(sql).toMatch(/GENERATED FILE — DO NOT EDIT/);
    expect(sql).toContain("src/lib/shlyoRules.ts");
    expect(sql).toContain("npm run gen:shlyo-sql");
  });

  it("emits an IMMUTABLE PARALLEL SAFE function — it rides an indexed predicate", () => {
    expect(buildSql()).toMatch(
      /RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE/,
    );
  });

  it("never emits a stored column or an index — the rules are query-side only", () => {
    // Applied to data these rules are wrong ("Wow Ltd" would index as `vovltd`). A
    // generator that grew an ALTER or a CREATE INDEX would be that mistake, shipped.
    const sql = buildSql();
    expect(sql).not.toMatch(/ALTER TABLE|CREATE INDEX|GENERATED ALWAYS AS/);
  });

  it("escapes quotes in a rule pattern", () => {
    // No rule contains one today; this asserts a future one cannot break out of the
    // literal and turn a rule edit into a SQL injection into our own migration.
    const sql = buildSql();
    const bodyStart = sql.indexOf("SELECT regexp_replace");
    // Every quote in the body belongs to a literal: an odd count would mean one escaped.
    const body = sql.slice(bodyStart);
    expect((body.match(/'/g) ?? []).length % 2).toBe(0);
  });
});
