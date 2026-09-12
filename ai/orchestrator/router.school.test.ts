import { describe, expect, it } from "vitest";
import { route } from "./router";
import type { ToolContext } from "../tools/types";

const ctx = { lang: "bg", election: "2026_04_19" } as ToolContext;

describe("named-school routing", () => {
  it.each([
    ['училище " Свети Свети Кирил и Методий"', "schoolMatura"],
    ['гимназия "Пейо Яворов"', "schoolMatura"],
  ])(
    "routes a short school lookup before municipality matching: %s",
    (q, tool) => {
      expect(route(q, ctx)).toEqual({ tool, args: { school: q } });
    },
  );

  it("keeps a plural place ranking on the municipality school tool", () => {
    expect(route("Кои са най-добрите училища в Пловдив?", ctx)?.tool).toBe(
      "schoolScores",
    );
  });
});
