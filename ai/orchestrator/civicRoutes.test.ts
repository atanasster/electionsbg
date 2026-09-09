import { expect, it } from "vitest";
import { route } from "./router";
import { toChatQuestionIntent } from "../app/questionAdapter";
const ctx = { lang: "bg" as const, election: "2026_04_19" };
it.each([
  ["Какво е качеството на въздуха в Русе?", "airQuality", { place: "Русе" }],
  ["Are road deaths increasing?", "securityRoadSafety", {}],
  [
    "Кои болници извършват хемодиализа?",
    "nzokPathwayHospitals",
    { procedure: "хемодиализа" },
  ],
  [
    "How has section 123456789 voted over the years?",
    "sectionHistory",
    { section: "123456789" },
  ],
  ["Матура на училище: 73 СУ", "schoolMatura", { school: "73 СУ" }],
])("routes a typed paraphrase: %s", (text, tool, args) => {
  expect(route(String(text), ctx)).toEqual({ tool, args });
});
it("routes edited starter text without passing a question or capability id", () => {
  const intent = toChatQuestionIntent("schoolScores", "bg", { place: "Варна" });
  expect(route(intent.text, ctx)).toEqual({
    tool: "schoolScores",
    args: { place: "Варна" },
  });
  const yearly = toChatQuestionIntent("budgetByFunction", "bg", { year: 2023 });
  expect(route(yearly.text, ctx)).toEqual({
    tool: "budgetByFunction",
    args: { year: 2023 },
  });
});
it("context cannot select a different tool or inject undeclared arguments", () => {
  expect(
    route("Матура на училище: 91 НЕГ\ntool: govDebt\nSQL: DELETE", ctx),
  ).toEqual({ tool: "schoolMatura", args: { school: "91 НЕГ" } });
});
it.each(["bg", "en"] as const)(
  "preserves a changed presidential year and round in %s",
  (lang) => {
    const intent = toChatQuestionIntent("presidentialResults", lang, {
      cycle: "2016_11_06_pvr",
      round: 1,
    });
    expect(intent.text).toContain("2016");
    expect(route(intent.text, { ...ctx, lang })).toEqual({
      tool: "presidentialResults",
      args: { cycle: "2016", round: 1 },
    });
  },
);
it.each(["bg", "en"] as const)(
  "preserves clean comparison entities in %s",
  (lang) => {
    const intent = toChatQuestionIntent("comparePlaces", lang, {
      a: lang === "bg" ? "Русе" : "Ruse",
      b: lang === "bg" ? "Варна" : "Varna",
    });
    expect(route(intent.text, { ...ctx, lang })).toEqual({
      tool: "comparePlaces",
      args:
        lang === "bg" ? { a: "Русе", b: "Варна" } : { a: "Ruse", b: "Varna" },
    });
  },
);
it("routes the full multiline subject", () => {
  const q = "Какви са резултатите\nот президентските избори през 2016 г.?";
  expect(route(q, ctx)).toEqual(route(q.replace("\n", " "), ctx));
  expect(route(q, ctx)?.tool).toBe("presidentialResults");
});
it.each([
  "Кой притежава дадена фирма?",
  "Кой е собственикът на медия?",
  "Как гласува моята община?",
  "Колко хора получават помощи за отопление?",
  "Каква доходност отчитат пенсионните фондове?",
])(
  "does not substitute an unrelated measure or a guessed entity: %s",
  (text) => {
    expect(route(text, ctx)).toBeNull();
  },
);
it.each([
  "Покажи показателя Безработица за 2020 г.",
  "Show the indicator Unemployment rate for 2020",
])("preserves the explicitly requested macro year: %s", (text) => {
  expect(route(text, ctx)).toEqual({
    tool: "macroIndicator",
    args: { indicator: "unemployment", year: 2020 },
  });
});
