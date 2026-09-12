import { describe, expect, it } from "vitest";
import { route } from "./router";

const ctx = { lang: "bg" as const, election: "2026_04_19" };

describe("results for a named place", () => {
  it.each([
    ["какви са резултатите в Панчарево", "панчарево"],
    ["Какви са резултатите в с. Панчарево?", "панчарево"],
    ["What are the results in Pancharevo?", "pancharevo"],
    ["Резултатите във Велико Търново", "велико търново"],
    ["Резултатите в Панчарево на последните избори", "панчарево"],
    ["Резултатите в Панчарево за последните избори", "панчарево"],
    [
      "What are the results in Pancharevo in the latest election?",
      "pancharevo",
    ],
  ])("routes %s to that settlement", (q, place) => {
    expect(route(q, ctx)).toEqual({
      tool: "settlementResults",
      args: { place },
    });
  });

  it.each([
    "Резултатите в Панчарево през 2023",
    "What were the results in 2023 in Панчарево?",
  ])("keeps an explicit election and strips it from the place: %s", (q) => {
    expect(route(q, ctx)).toEqual({
      tool: "settlementResults",
      args: { place: "панчарево", election: "2023_04_02" },
    });
  });

  it.each([
    ["Какви са резултатите в община Самоков?", "самоков"],
    ["What are the results in Samokov municipality?", "samokov"],
  ])("respects municipality scope: %s", (q, place) => {
    expect(route(q, ctx)).toEqual({
      tool: "municipalityResults",
      args: { place },
    });
  });

  it.each([
    ["Какви са резултатите в област Варна?", "regionResults"],
    ["Какви са резултатите в София?", "regionResults"],
    ["Какви са резултатите в България?", "nationalResults"],
    ["What are the results in the last election?", "nationalResults"],
    ["What were the results in 2023?", "nationalResults"],
    ["Покажи резултатите по общини в Благоевград", "municipalityWinners"],
    ["Резултатите в Панчарево за последните 5 години", "settlementHistory"],
  ])("preserves other scopes: %s", (q, tool) => {
    expect(route(q, ctx)?.tool).toBe(tool);
  });
});
