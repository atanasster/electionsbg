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

  it("leaves an AWARDED-money question to the funds arm", () => {
    // Bare „европрограми" is not a token: this asks who already received money.
    expect(
      route("Колко пари от европрограми получи община Русе?", ctx)?.tool,
    ).not.toBe("openCalls");
  });
});
