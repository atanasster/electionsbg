import { expect, it } from "vitest";
import { route } from "../orchestrator/router";
import { detectPriceProduct } from "./prices";
import type { ToolContext } from "./types";

it.each([
  "What are the prices in Plovdiv?",
  "Prices in Plovdiv",
  "Какви са цените в Пловдив?",
])("keeps a city price overview free of an unintended rice filter: %s", (q) => {
  expect(detectPriceProduct(q.toLowerCase())).toBe(false);
  const result = route(q, {
    lang: "en",
    election: "2026_04_19",
  } as ToolContext);
  expect(result?.tool).toBe("settlementPrices");
  expect(result?.args).toHaveProperty("place");
  expect(result?.args).not.toHaveProperty("product");
});

it("still recognizes an explicit rice question", () => {
  const q = "What are rice prices in Plovdiv?";
  expect(detectPriceProduct(q.toLowerCase())).toBe(true);
  expect(
    route(q, { lang: "en", election: "2026_04_19" } as ToolContext)?.args,
  ).toHaveProperty("product");
});
