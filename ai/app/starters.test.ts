import { describe, expect, it } from "vitest";
import { projectChatStarters, STARTERS, STARTER_CATEGORIES } from "./starters";
import { route } from "../orchestrator/router";
import { TOOLS } from "../tools/registry";
import { latestElection } from "../tools/dataset";

describe("starter intent contracts", () => {
  it("excludes questions that are not ready for chat", () => {
    expect(
      projectChatStarters([
        {
          id: "sql-only",
          categoryId: "data-coverage",
          subcategoryId: "search",
          question: { bg: "Търсене", en: "Search" },
          aliases: {},
          parameters: [],
          defaults: {},
          chat: { status: "unavailable" },
          sql: { status: "ready", capabilityId: "search" },
          sourceIds: [],
        },
      ]),
    ).toEqual([]);
  });
  it("has unique identities and valid category paths", () => {
    expect(new Set(STARTERS.map((s) => s.id)).size).toBe(STARTERS.length);
    expect(new Set(STARTER_CATEGORIES.map((c) => c.id)).size).toBe(
      STARTER_CATEGORIES.length,
    );
    for (const category of STARTER_CATEGORIES) {
      expect(new Set(category.subcategories.map((s) => s.id)).size).toBe(
        category.subcategories.length,
      );
    }
    for (const starter of STARTERS) {
      const category = STARTER_CATEGORIES.find(
        (c) => c.id === starter.category,
      );
      expect(
        category?.subcategories.some((s) => s.id === starter.subcategory),
      ).toBe(true);
    }
  });

  for (const lang of ["bg", "en"] as const) {
    it(`has unique ${lang} questions`, () => {
      expect(
        new Set(STARTERS.map((s) => s[lang].toLowerCase().trim())).size,
      ).toBe(STARTERS.length);
    });
    for (const starter of STARTERS) {
      it(`${starter.id}: ${lang} reaches the intended tool AND arguments`, () => {
        const tool = TOOLS.find((t) => t.name === starter.tool);
        expect(tool).toBeDefined();
        const result = route(starter[lang], {
          lang,
          election: latestElection(),
        });
        expect(result?.tool).toBe(starter.tool);
        expect(result?.args).toEqual(starter.args[lang]);
        for (const param of tool!.params.filter((p) => p.required)) {
          expect(
            result?.args[param.name],
            `required ${param.name}`,
          ).toBeDefined();
          expect(result?.args[param.name]).not.toBe("");
        }
      });
    }
  }
});
