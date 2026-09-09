import { describe, expect, it } from "vitest";
import type { QuestionCatalog } from "../types";
import { questionsForLeaf, searchQuestions } from "./model";

const catalog: QuestionCatalog = {
  categories: [
    {
      id: "elections",
      label: { bg: "Избори", en: "Elections" },
      subcategories: [
        {
          id: "parliamentary",
          label: { bg: "Парламентарни", en: "Parliamentary" },
        },
      ],
    },
  ],
  questions: [
    {
      id: "results",
      categoryId: "elections",
      subcategoryId: "parliamentary",
      question: { bg: "Последни резултати", en: "Latest results" },
      aliases: { bg: ["вот"], en: ["vote"] },
      parameters: [],
      defaults: {},
      chat: { status: "ready", capabilityId: "results" },
      sql: {
        status: "unavailable",
        reason: { bg: "Няма таблица", en: "No table" },
      },
      sourceIds: [],
    },
    {
      id: "review",
      categoryId: "elections",
      subcategoryId: "parliamentary",
      question: { bg: "Активност по райони", en: "Turnout by district" },
      aliases: { bg: ["избирателна активност"], en: ["voter activity"] },
      parameters: [],
      defaults: {},
      chat: { status: "review" },
      sql: { status: "ready", capabilityId: "review", version: 1 },
      sourceIds: [],
    },
  ],
};

describe("question selector model", () => {
  it("finds questions by category and subcategory labels in either language", () => {
    expect(
      searchQuestions(catalog, "chat", "bg", "elections parliamentary").map(
        (q) => q.id,
      ),
    ).toEqual(["results"]);
    expect(
      searchQuestions(catalog, "sql", "en", "избори парламентарни").map(
        (q) => q.id,
      ),
    ).toEqual(["review"]);
  });
  it("filters each host independently", () => {
    expect(
      questionsForLeaf(catalog, "chat", "elections", "parliamentary"),
    ).toHaveLength(1);
    expect(
      questionsForLeaf(catalog, "sql", "elections", "parliamentary"),
    ).toHaveLength(1);
    expect(
      questionsForLeaf(catalog, "sql", "elections", "parliamentary", true),
    ).toHaveLength(2);
  });

  it("searches both languages and aliases without changing curated order", () => {
    expect(searchQuestions(catalog, "chat", "bg", "latest")[0]?.id).toBe(
      "results",
    );
    expect(searchQuestions(catalog, "chat", "en", "вот")[0]?.id).toBe(
      "results",
    );
    expect(
      searchQuestions(catalog, "chat", "bg", "избирателна райони"),
    ).toEqual([]);
    expect(
      searchQuestions(catalog, "chat", "bg", "активност райони", true)[0]?.id,
    ).toBe("review");
  });

  it("keeps review items unavailable until explicitly requested", () => {
    expect(
      questionsForLeaf(catalog, "chat", "elections", "parliamentary"),
    ).toHaveLength(1);
    expect(
      questionsForLeaf(catalog, "chat", "elections", "parliamentary", true),
    ).toHaveLength(2);
    expect(
      questionsForLeaf(catalog, "sql", "elections", "parliamentary"),
    ).toHaveLength(1);
  });
});
