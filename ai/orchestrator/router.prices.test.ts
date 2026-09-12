import { describe, expect, it } from "vitest";
import { route } from "./router";
import type { ToolContext } from "../tools/types";

const ctx = { lang: "bg", election: "2026_04_19" } as ToolContext;

describe("specific product price routing", () => {
  it.each([
    "каква е цената на кафе лаваца 500г",
    "каква е цената на МЛЯНО КАФЕ ЛАВАЦА КРЕМА Е ГУСТО 250ГР.",
  ])(
    "routes a product name to the catalogue rather than a municipality: %s",
    (q) => {
      expect(route(q, ctx)).toEqual({
        tool: "productPrice",
        args: { product: q },
      });
    },
  );

  it("keeps an explicitly located product on the settlement price tool", () => {
    expect(route("Каква е цената на млякото в Пловдив?", ctx)?.tool).toBe(
      "settlementPrices",
    );
  });
});
