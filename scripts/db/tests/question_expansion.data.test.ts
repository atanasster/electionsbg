import { afterAll, expect, it } from "vitest";
import { getPool, pinLocalDatabase, end } from "../lib/pg";
import {
  BUDGET_SQL_RECIPES,
  EXPANDED_SQL_RECIPES,
} from "../../../src/lib/questions/sql/expanded";
import { renderSqlQuestion } from "../../../src/lib/questions/sql/render";
import { BUDGET_TOOLS } from "../../../ai/tools/budgetServing";
import { setDbFetcher } from "../../../ai/tools/dataClient";
import { nodeDbFetcher } from "../../../ai/tools/dbFetcherNode";
import { BUDGET_QUESTIONS } from "../../../src/lib/questions/contracts/budget";
pinLocalDatabase();
setDbFetcher(nodeDbFetcher);
afterAll(end);
it.each([...BUDGET_SQL_RECIPES, ...EXPANDED_SQL_RECIPES])(
  "$id executes under the reader role and timeout",
  async (recipe) => {
    const c = await getPool().connect();
    try {
      await c.query("BEGIN READ ONLY");
      await c.query("SET LOCAL statement_timeout='8s'");
      await c.query("SET LOCAL ROLE app_readonly");
      const r = await c.query(renderSqlQuestion(recipe.id).sql);
      expect(r.rows.length, recipe.id).toBeGreaterThan(0);
      expect(r.rows[0].data, recipe.id).not.toBeNull();
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  },
);
it.each(BUDGET_QUESTIONS)(
  "$id uses identical fiscal inputs in chat and SQL",
  async (spec) => {
    const values = "year" in spec ? { year: spec.year } : {};
    const payload = (
      await getPool().query(renderSqlQuestion(spec.id, values).sql)
    ).rows[0].data;
    const env = await BUDGET_TOOLS.find((t) => t.name === spec.id)!.run(
      values,
      { lang: "bg", election: "2026_04_19" },
    );
    expect(env.rows?.length).toBe(payload[spec.section].length);
    for (const [i, row] of (env.rows ?? []).entries())
      for (const [key, value] of Object.entries(row))
        expect(value).toEqual(payload[spec.section][i][key] ?? null);
  },
);
it("preserves independently checked budget amounts and partial reporting coverage", async () => {
  const data = (
    await getPool().query(
      renderSqlQuestion("budgetVariance", { year: 2024 }).sql,
    )
  ).rows[0].data;
  expect(data).toMatchObject({
    fiscalYear: 2024,
    coveredUnits: 8,
    totalUnits: 48,
  });
  expect(
    data.rows.find(
      (r: { nodeId: string }) => r.nodeId === "admin-ministerstvo-na-otbranata",
    ),
  ).toMatchObject({
    plannedEur: 1088639606,
    executedEur: 1829092100,
    deltaVsLawEur: 740452494,
  });
});

it.each(["budgetCapitalByMunicipality", "budgetPersonnelByMinistry"])(
  "%s retains nested coverage",
  async (id) => {
    const env = await BUDGET_TOOLS.find((t) => t.name === id)!.run(
      {},
      { lang: "bg", election: "2026_04_19" },
    );
    if (id === "budgetCapitalByMunicipality") {
      expect(JSON.parse(String(env.facts?.covered)).municipalityCount).toBe(24);
      expect(JSON.parse(String(env.facts?.sources)).municipalityCount).toBe(2);
      expect(env.subtitle).toContain("24 от 265");
      expect(env.subtitle).toContain("2 общини");
    } else {
      expect(env.facts?.unitsFiscalYear).toBe(2024);
      expect(JSON.parse(String(env.facts?.unitsCoverage)).units).toBe(7);
      expect(env.subtitle).toContain("7 институции");
    }
  },
);
