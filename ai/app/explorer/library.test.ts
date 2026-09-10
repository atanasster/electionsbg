import { expect, it } from "vitest";
import {
  LIBRARY,
  filterLibrary,
  QUESTION_CATEGORIES,
  WELCOME_IDS,
} from "./library";
import { TOOLS } from "../../tools/registry";
import titles from "./toolTitles.json";
import { toChatQuestionIntent } from "../questionAdapter";
it("covers every executable ID with bilingual titles and valid categories", () => {
  expect(LIBRARY.map((e) => e.tool.name)).toEqual(TOOLS.map((t) => t.name));
  expect(Object.keys(titles).sort()).toEqual(TOOLS.map((t) => t.name).sort());
  for (const e of LIBRARY) {
    expect(e.questions.length).toBeGreaterThan(0);
    expect(
      QUESTION_CATEGORIES.find(
        (c) => c.id === e.categoryId,
      )?.subcategories.some((s) => s.id === e.subcategoryId),
    ).toBe(true);
    for (const lang of ["bg", "en"] as const) {
      expect(e.title[lang].length).toBeGreaterThan(3);
      expect(e.title[lang]).not.toBe(e.tool.name);
    }
  }
});
it("finds technical IDs, bilingual words and transliterated queries", () => {
  expect(filterLibrary("budgetVariance").map((e) => e.tool.name)).toContain(
    "budgetVariance",
  );
  expect(filterLibrary("бюджет").length).toBeGreaterThan(0);
  expect(filterLibrary("byudzhet").length).toBeGreaterThan(0);
  expect(filterLibrary("presidential").map((e) => e.tool.name)).toContain(
    "latestPresidentialPoll",
  );
  expect(filterLibrary("zzzz-not-a-tool")).toEqual([]);
  expect(
    filterLibrary("", "", "", ["budgetVariance"]).map((e) => e.tool.name),
  ).toEqual(["budgetVariance"]);
});
it("has executable welcome presets in both languages", () => {
  for (const id of WELCOME_IDS) {
    const e = LIBRARY.find((e) => e.tool.name === id)!;
    for (const lang of ["bg", "en"] as const)
      expect(toChatQuestionIntent(e.questions[0].id, lang).tool).toBe(id);
  }
});

it("preserves recent ordering through search and category filtering", () => {
  const recent = ["budgetPersonnel", "budgetVariance"];
  expect(filterLibrary("", "", "", recent).map((e) => e.tool.name)).toEqual(
    recent,
  );
  const category = LIBRARY.find((e) => e.tool.name === recent[0])!.categoryId;
  expect(
    filterLibrary("budget", category, "", recent).map((e) => e.tool.name),
  ).toEqual(recent);
});
