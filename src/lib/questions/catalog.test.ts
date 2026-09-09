import { describe, expect, it } from "vitest";
import {
  QUESTION_CATALOG,
  QUESTION_CATEGORIES,
  QUESTION_DEFINITIONS,
} from "./catalog";
import { resolveQuestionSelection } from "./resolve";
import { TOOLS } from "../../../ai/tools/registry";

describe("shared question catalog", () => {
  it("preserves the 150 chat questions and adds one utility category", () => {
    expect(QUESTION_DEFINITIONS).toHaveLength(150);
    expect(QUESTION_CATEGORIES).toHaveLength(19);
    expect(QUESTION_CATALOG.questions).toBe(QUESTION_DEFINITIONS);
  });

  it("has valid unique paths and capabilities", () => {
    const ids = new Set<string>();
    for (const question of QUESTION_DEFINITIONS) {
      expect(ids.has(question.id), question.id).toBe(false);
      ids.add(question.id);
      const category = QUESTION_CATEGORIES.find(
        (candidate) => candidate.id === question.categoryId,
      );
      expect(category, question.id).toBeDefined();
      expect(
        category?.subcategories.some(
          (subcategory) => subcategory.id === question.subcategoryId,
        ),
        question.id,
      ).toBe(true);
      expect(question.chat.status).toBe("ready");
      expect(question.chat.capabilityId).toBeTruthy();
    }
  });

  it("resolves only declared parameters", () => {
    const question = QUESTION_DEFINITIONS.find(
      (candidate) => candidate.parameters.length > 0,
    )!;
    expect(resolveQuestionSelection(question).questionId).toBe(question.id);
    expect(() => resolveQuestionSelection(question, { injected: "x" })).toThrow(
      "Unknown parameter",
    );
  });

  it("declares every required tool input and the reused a/b semantics", () => {
    for (const question of QUESTION_DEFINITIONS) {
      const tool = TOOLS.find(
        (candidate) => candidate.name === question.chat.capabilityId,
      );
      expect(tool, question.id).toBeDefined();
      for (const required of tool!.params.filter(
        (parameter) => parameter.required,
      ))
        expect(
          question.parameters.find(
            (parameter) => parameter.id === required.name,
          ),
          `${question.id}.${required.name}`,
        ).toMatchObject({ required: true });
      expect(() =>
        resolveQuestionSelection(
          question,
          question.legacyChatArgs?.bg ?? question.defaults,
        ),
      ).not.toThrow();
    }
    const places = QUESTION_DEFINITIONS.find((q) => q.id === "comparePlaces")!;
    expect(places.parameters.map((p) => p.kind)).toEqual(["place", "place"]);
  });

  it("rejects wrong runtime types and impossible dates", () => {
    const base = QUESTION_DEFINITIONS[0];
    const withParameter = (
      parameter: (typeof base.parameters)[number],
      value: unknown,
    ) =>
      resolveQuestionSelection(
        { ...base, defaults: {}, parameters: [parameter] },
        { [parameter.id]: value },
      );
    const number = {
      id: "n",
      kind: "number" as const,
      required: true,
      label: { bg: "Брой", en: "Count" },
    };
    for (const bad of [true, [], {}, "1x"])
      expect(() => withParameter(number, bad)).toThrow("Expected a number");
    const date = {
      id: "date",
      kind: "date" as const,
      required: true,
      label: { bg: "Дата", en: "Date" },
    };
    expect(() => withParameter(date, "2025-02-31")).toThrow("valid YYYY-MM-DD");
    expect(() => withParameter(date, true)).toThrow("Expected text");
  });
});
