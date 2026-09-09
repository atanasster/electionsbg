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
      expect(question?.sql, recipe.id).toMatchObject({
        status: "ready",
        capabilityId: recipe.id,
        version: 1,
      });
      expect(question?.sourceIds, recipe.id).toEqual(recipe.relations);
    }
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
});
