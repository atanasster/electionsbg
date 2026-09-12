import { describe, expect, it } from "vitest";
import { route } from "./router";
import type { ToolContext } from "../tools/types";
import { followUps } from "../app/followups";

const ctx = { lang: "bg", election: "2026_04_19" } as ToolContext;

describe("chain contract follow-up routing", () => {
  it.each([
    ["Покажи договорите на Метро България", "121644736"],
    ["Show contracts won by Metro Bulgaria", "121644736"],
    ["Покажи договорите на БИЛЛА", "130007884"],
    ["Договорите на Кауфланд", "131129282"],
  ])("routes contracts to the supplier's procurement list: %s", (q, eik) => {
    expect(route(q, ctx)).toEqual({
      tool: "contractSearch",
      args: { company: eik },
    });
  });

  it("routes the actual generated follow-up in both languages", () => {
    const suggestion = followUps({
      tool: "chainProfile",
      kind: "table",
      title: "Метро България",
      viz: "none",
      provenance: [],
      facts: {
        chain: "Метро България",
        eik: "121644736",
        as_supplier_contracts: 2,
      },
    }).find((s) => s.questionId === "contractSearch")!;
    expect(suggestion).toBeDefined();
    for (const q of [suggestion.bg, suggestion.en]) {
      expect(route(q, ctx)).toEqual({
        tool: "contractSearch",
        args: { company: "121644736" },
      });
    }
  });

  it.each(["Профил на веригата Метро", "какви са цените във верига БИЛЛА"])(
    "preserves retail profiles: %s",
    (q) => {
      expect(route(q, ctx)?.tool).toBe("chainProfile");
    },
  );
  it("keeps subway contracts out of the retail-chain identity", () => {
    expect(
      route("Покажи договорите за метро станция", ctx)?.args?.company,
    ).not.toBe("121644736");
  });
});

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
