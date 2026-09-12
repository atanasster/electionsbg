import { describe, expect, it } from "vitest";
import { route } from "./router";

describe("starter subject words are not place names", () => {
  it.each([
    ["Кои са последните кметове на Варна?", "localMayorHistory", "варна"],
    ["Who are the last mayors of Varna?", "localMayorHistory", "varna"],
    ["Кои са районните кметове на Пловдив?", "localSubMayors", "пловдив"],
    ["Who are Plovdiv's district mayors?", "localSubMayors", "plovdiv"],
    ["Какви са данъците в Стара Загора?", "localTaxes", "стара загора"],
    ["What are the taxes in Varna?", "localTaxes", "varna"],
    ["Какви промоции има в Стара Загора?", "localDeals", "стара загора"],
    ["What deals are in Varna?", "localDeals", "varna"],
  ])("extracts the named place from %s", (question, tool, place) => {
    expect(route(question, { lang: "bg", election: "2026_04_19" })).toEqual({
      tool,
      args: { place },
    });
  });
  it.each([
    ["Кои са най-големите инвестиционни проекти?", {}],
    ["What are the biggest investment projects?", {}],
    [
      "Кои са най-големите инвестиционни проекти в Пловдив?",
      { oblast: "пловдив" },
    ],
    ["What are the biggest investment projects in Varna?", { oblast: "varna" }],
  ])("preserves investment project scope for %s", (question, args) => {
    expect(route(question, { lang: "en", election: "2026_04_19" })).toEqual({
      tool: "investmentProjects",
      args,
    });
  });
});
