import { describe, expect, it } from "vitest";
import { resolveQuestionSelection } from "../resolve";
import { SQL_QUESTION_CATALOG, SQL_QUESTION_DEFINITIONS } from "./catalog";
import { CHAT_SQL_RECIPES, SQL_RECIPES_BY_ID } from "./recipes";
import { renderSqlQuestion } from "./render";

describe("SQL question catalog", () => {
  it("exposes every legacy recipe as one ready catalog question", () => {
    expect(SQL_QUESTION_DEFINITIONS).toHaveLength(37);
    for (const question of SQL_QUESTION_DEFINITIONS) {
      expect(question.sql.status).toBe("ready");
      expect(
        SQL_RECIPES_BY_ID.get(question.sql.capabilityId ?? ""),
      ).toBeDefined();
      expect(question.question.bg).not.toBe(question.question.en);
      const resolved = resolveQuestionSelection(question);
      expect(renderSqlQuestion(question.id, resolved.parameters).sql).toContain(
        "SELECT",
      );
    }
  });

  it("promotes reviewed DB-backed chat questions without duplicate IDs", () => {
    expect(CHAT_SQL_RECIPES.map((recipe) => recipe.questionId)).toEqual([
      "nationalResults",
      "presidentialResults",
      "municipalFiscalRanking",
      "personWealth",
      "topContractors",
      "procurementAppeals",
      "companyConnections",
    ]);
    expect(
      new Set(SQL_QUESTION_CATALOG.questions.map((question) => question.id))
        .size,
    ).toBe(SQL_QUESTION_CATALOG.questions.length);
    for (const recipe of CHAT_SQL_RECIPES) {
      const question = SQL_QUESTION_CATALOG.questions.find(
        (candidate) => candidate.id === recipe.questionId,
      );
      expect(question?.chat.status, recipe.id).toBe("ready");
      const reviewed = ["nationalResults", "presidentialResults"].includes(
        recipe.id,
      );
      expect(question?.sql.status, recipe.id).toBe(
        reviewed ? "ready" : "review",
      );
      if (reviewed)
        expect(question?.sql, recipe.id).toMatchObject({
          capabilityId: recipe.id,
          version: 1,
        });
      expect(question?.sourceIds, recipe.id).toEqual(recipe.relations);
    }
  });

  it("keeps parliamentary and presidential result queries on distinct types and rounds", () => {
    expect(renderSqlQuestion("nationalResults").sql).toBe(
      "SELECT * FROM election_national_results('parliamentary', E'2026_04_19', NULL);",
    );
    expect(
      renderSqlQuestion("presidentialResults", {
        cycle: "2021_11_14_pvr",
        round: 2,
      }).sql,
    ).toBe(
      "SELECT * FROM election_national_results('presidential', E'2021_11_14_pvr', 2);",
    );
    expect(() =>
      renderSqlQuestion("presidentialResults", {
        cycle: "2021_11_14_pvr",
        round: 3,
      }),
    ).toThrow();
  });

  it("validates presidential values once across selector and SQL generation", () => {
    const question = SQL_QUESTION_CATALOG.questions.find(
      (candidate) => candidate.id === "presidentialResults",
    )!;
    for (const values of [
      { cycle: "1980_01_01_pvr", round: 2 },
      { cycle: "2021_11_14_pvr", round: 3 },
      { cycle: "2021_11_14_pvr", round: 1.5 },
    ])
      expect(() => resolveQuestionSelection(question, values)).toThrow();
    const resolved = resolveQuestionSelection(question, {
      cycle: "2021_11_14_pvr",
      round: 1,
    });
    expect(() =>
      renderSqlQuestion(question.id, resolved.parameters),
    ).not.toThrow();
  });

  it("keeps all SQL questions on valid shared category paths", () => {
    for (const question of SQL_QUESTION_DEFINITIONS) {
      const category = SQL_QUESTION_CATALOG.categories.find(
        (candidate) => candidate.id === question.categoryId,
      );
      expect(category, question.id).toBeDefined();
      expect(
        category?.subcategories.some(
          (subcategory) => subcategory.id === question.subcategoryId,
        ),
        question.id,
      ).toBe(true);
    }
  });

  it("renders each municipal ranking metric with shared count boundaries", () => {
    const orderBy = {
      commitments: "commitments_eur",
      expense_obligations: "expense_obligations_eur",
      arrears: "arrears_eur",
    };
    for (const [metric, column] of Object.entries(orderBy)) {
      const rendered = renderSqlQuestion("municipalFiscalRanking", {
        year: 2024,
        count: 100,
        metric,
      });
      expect(rendered.sql).toContain(`ORDER BY ${column} DESC NULLS LAST`);
      expect(rendered.sql).toContain("debt_stock_eur");
      expect(rendered.outputColumns).toContain("criteria_evaluable");
    }
    for (const count of [101, 1.5, Number.POSITIVE_INFINITY])
      expect(() =>
        renderSqlQuestion("municipalFiscalRanking", {
          year: 2024,
          count,
          metric: "commitments",
        }),
      ).toThrow();
  });

  it("keeps person identity and absent wealth states explicit", () => {
    const sql = renderSqlQuestion("personWealth", {
      name: "Иван Иванов",
    }).sql;
    expect(sql).toContain("WHEN r.matches = 0 THEN 'missing'");
    expect(sql).toContain("WHEN r.matches > 1 THEN 'ambiguous'");
    expect(sql).toContain("WHEN point IS NULL THEN 'no_data'");
    expect(sql).toContain("name_fold = translit_bg_latin(");
  });
});
