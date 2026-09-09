import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  ALL_QUERIES,
  LIBRARY as PROJECTED_LIBRARY,
} from "../../../screens/dev/sqlLibrary";
import {
  ALL_QUERIES as LEGACY_QUERIES,
  LIBRARY as LEGACY_LIBRARY,
} from "./legacy";
import { LEGACY_SQL_RECIPES, RECIPE_CONTRACTS, SQL_RECIPES } from "./recipes";
import { renderSqlQuestion } from "./render";
import { sqlCode, sqlDate, sqlText } from "./literals";

const require = createRequire(import.meta.url);
const { classifySql } = require("../../../../functions/sql_statement.js") as {
  classifySql: (sql: string) => {
    statementCount: number;
    cursorable: boolean;
  };
};
const { runWithClient } = require("../../../../functions/sql_execution.js") as {
  runWithClient: (
    client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
    sql: string,
    limit?: number,
  ) => Promise<{ columns: string[]; rows: Array<Record<string, unknown>> }>;
};

describe("reviewed SQL recipes", () => {
  const metadata = (query: {
    id: string;
    label: string;
    answers: string;
    cost?: string;
    walks?: { a: string; b: string; key: string };
    purpose?: string;
  }) => ({
    id: query.id,
    label: query.label,
    answers: query.answers,
    cost: query.cost,
    walks: query.walks,
    purpose: query.purpose,
  });

  it("preserves all 37 published IDs through the compatibility projection", () => {
    expect(LEGACY_SQL_RECIPES).toHaveLength(37);
    expect(ALL_QUERIES.map((query) => query.id)).toEqual(
      LEGACY_SQL_RECIPES.map((recipe) => recipe.id),
    );
    expect(new Set(LEGACY_SQL_RECIPES.map((recipe) => recipe.id)).size).toBe(
      37,
    );
  });

  it("uses the exact reviewed contract for every legacy recipe", () => {
    expect(Object.keys(RECIPE_CONTRACTS)).toHaveLength(37);
    for (const recipe of LEGACY_SQL_RECIPES) {
      expect(recipe.relations, recipe.id).toEqual(
        RECIPE_CONTRACTS[recipe.id].relations,
      );
      expect(recipe.outputColumns, recipe.id).toEqual(
        RECIPE_CONTRACTS[recipe.id].outputColumns,
      );
    }
  });

  it("preserves every legacy label, answer, cost, walk, purpose and default SQL", () => {
    const normalize = (sql: string) =>
      sql
        .replace(/--[^\n]*(?:\n|$)/g, " ")
        .replace(/\bE'/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    expect(ALL_QUERIES.map(metadata)).toEqual(LEGACY_QUERIES.map(metadata));
    expect(ALL_QUERIES.map((query) => normalize(query.sql))).toEqual(
      LEGACY_QUERIES.map((query) => normalize(query.sql)),
    );
    expect(
      PROJECTED_LIBRARY.map((group) => ({
        purpose: group.purpose,
        queries: group.queries.map(metadata),
      })),
    ).toEqual(
      LEGACY_LIBRARY.map((group) => ({
        purpose: group.purpose,
        queries: group.queries.map(metadata),
      })),
    );
  });

  it("renders every default as one cursor-capped read statement", () => {
    for (const recipe of SQL_RECIPES) {
      const rendered = renderSqlQuestion(recipe.id);
      const classification = classifySql(rendered.sql);
      expect(classification.statementCount, recipe.id).toBe(1);
      expect(classification.cursorable, recipe.id).toBe(true);
    }
  });

  it("executes every ready default and representative variants against seeded contracts", async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ...SQL_RECIPES.map(
        (recipe) => [recipe.id, {}] as [string, Record<string, unknown>],
      ),
      ["contractors-ranked-and-scoped", { scope: "y:2025" }],
      ["what-changed-recently", { days: 30, limit: 80 }],
      ["a-day-in-the-chamber", { from: "2026-01-01" }],
      ["find-a-person", { name: "Иван О'Брайън", limit: 8 }],
      ["companyConnections", { company: "000012345" }],
    ];
    for (const [id, values] of cases) {
      const rendered = renderSqlQuestion(id, values);
      const seed = Object.fromEntries(
        rendered.outputColumns.map((column, index) => [
          column,
          `${id}:${index}`,
        ]),
      );
      const seen: string[] = [];
      const client = {
        query: async (sql: string) => {
          seen.push(sql);
          if (sql.startsWith("FETCH"))
            return {
              rows: [seed],
              fields: rendered.outputColumns.map((name) => ({ name })),
            };
          return { rows: [], fields: [] };
        },
      };
      const result = await runWithClient(client, rendered.sql, 100);
      expect(result.columns, id).toEqual(rendered.outputColumns);
      expect(result.rows, id).toEqual([seed]);
      expect(
        seen.some((sql) => sql.includes(rendered.sql.replace(/;\s*$/, ""))),
        id,
      ).toBe(true);
    }
  });

  it("is deterministic for a recipe version and resolved values", () => {
    const values = { name: "Иван Петров", limit: 17 };
    expect(renderSqlQuestion("find-a-person", values)).toEqual(
      renderSqlQuestion("find-a-person", values),
    );
  });

  it("keeps apostrophes, Cyrillic, backslashes and semicolons inside one literal", () => {
    const rendered = renderSqlQuestion("find-a-person", {
      name: "О'Брайън\\архив; SELECT * FROM secrets",
    });
    expect(rendered.sql).toContain(
      "E'О''Брайън\\\\архив; SELECT * FROM secrets'",
    );
    expect(classifySql(rendered.sql)).toMatchObject({
      statementCount: 1,
      cursorable: true,
    });
  });

  it("preserves leading-zero entity and place codes", () => {
    expect(
      renderSqlQuestion("one-buyer-s-procurement-profile", {
        eik: "000012345",
      }).sql,
    ).toContain("E'000012345'");
    expect(
      renderSqlQuestion("companies-registered-in-a-place", {
        ekatte: "00123",
      }).sql,
    ).toContain("E'00123'");
  });

  it("validates and renders bounded period variants", () => {
    expect(
      renderSqlQuestion("contractors-ranked-and-scoped", { scope: "y:2025" })
        .sql,
    ).toContain("scope_key = E'y:2025'");
    expect(
      renderSqlQuestion("what-changed-recently", { days: 30, limit: 80 }).sql,
    ).toContain("recent_updates(30, 80)");
    expect(
      renderSqlQuestion("a-day-in-the-chamber", { from: "2026-01-01" }).sql,
    ).toContain("date >= E'2026-01-01'::date");
    expect(() =>
      renderSqlQuestion("contractors-ranked-and-scoped", { scope: "forever" }),
    ).toThrow("Value is not allowed");
    expect(() =>
      renderSqlQuestion("what-changed-recently", { days: 0, limit: 80 }),
    ).toThrow("Expected 1–3650");
    expect(() =>
      renderSqlQuestion("a-day-in-the-chamber", { from: "2026-02-30" }),
    ).toThrow("valid date");
  });

  it("rejects values that could alter a code, limit or recipe identity", () => {
    expect(() =>
      renderSqlQuestion("who-owns-a-company", { eik: "1'; DROP TABLE x;--" }),
    ).toThrow("Expected a code");
    expect(() =>
      renderSqlQuestion("name-search", { query: "safe", limit: "20; DELETE" }),
    ).toThrow("Expected 1–100");
    expect(() => renderSqlQuestion("name-search", { extra: "x" })).toThrow(
      "Unknown parameter",
    );
    expect(() => renderSqlQuestion("missing-recipe")).toThrow(
      "Unknown SQL question",
    );
    expect(() => renderSqlQuestion("name-search", {}, 2)).toThrow(
      "Unsupported SQL recipe version",
    );
    expect(() => renderSqlQuestion("constructor")).toThrow(
      "Unknown SQL question",
    );
  });
});

describe("SQL literal primitives", () => {
  it("encodes text and rejects NUL", () => {
    expect(sqlText("Киро's \\ path")).toBe("E'Киро''s \\\\ path'");
    expect(() => sqlText("bad\0value")).toThrow("NUL is not allowed");
  });

  it("validates dates and code values", () => {
    expect(sqlDate("2026-02-28")).toBe("E'2026-02-28'::date");
    expect(() => sqlDate("2026-02-30")).toThrow("valid date");
    expect(sqlCode("000695089")).toBe("E'000695089'");
    expect(() => sqlCode("abc'; SELECT 1")).toThrow("Expected a code");
  });
});
