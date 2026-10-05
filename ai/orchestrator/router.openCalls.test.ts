import { describe, expect, it } from "vitest";
import { route } from "./router";
import type { ToolContext } from "../tools/types";

const ctx = { lang: "bg", election: "2026_04_19" } as ToolContext;

// „европрограми ЗА X" is a question about what X can apply for. It reached no rule at all in
// Bulgarian (so the model guessed), and in English the COFOG arm took it as the agriculture
// budget function — both before the open-calls arm.
describe("„EU programmes for X“ routes to open calls", () => {
  it.each([
    "Покажи ми европрограми за селско стопанство",
    "покажи ми европрограми за сеелско стопанство",
    "Има ли европрограма за млади земеделци?",
    "Show me EU programmes for agriculture",
    "EU programs for farmers",
  ])("%s", (q) => {
    expect(route(q, ctx)?.tool).toBe("openCalls");
  });

  it.each([
    "Колко пари от европрограми получи община Русе?",
    "Колко пари от европрограми за образование получи община Русе?",
    "Колко пари са дадени по европрограми за земеделие през 2023?",
    "How much did EU programmes for agriculture pay out in 2022?",
  ])("leaves an AWARDED-money question elsewhere: %s", (q) => {
    // „за" alone does not make it an open-call question — these ask who already received money.
    expect(route(q, ctx)?.tool).not.toBe("openCalls");
  });
});
