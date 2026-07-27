// Shape guard for the `pricePli` block in data/macro_peers.json (written by
// fetch_food_pli.ts). Two readers — the /consumption/eu screen and the
// euFoodPriceLevels AI tool — both derive "food detail rows" from the invariant
// `kind === "food" && code !== "A010101"`. Nothing else pins that contract, so a
// future fetch that dropped `kind`, re-listed A010101 as a division, or lost the
// A01 headline would leak the food total into the detail bars and only break at
// runtime. This locks the invariant against the committed data.
//
//   npx vitest run scripts/macro/fetch_food_pli.test.ts

import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Category {
  code: string;
  kind: "headline" | "division" | "food";
  parent?: string;
}
interface Peers {
  foodPli?: unknown;
  pricePli?: {
    categories: Category[];
    values: Record<string, Record<string, number>>;
    volumes: Record<string, Record<string, number>>;
    trend: { years: number[]; values: Record<string, (number | null)[]> };
  };
}

const peers = JSON.parse(
  readFileSync(resolve("data/macro_peers.json"), "utf8"),
) as Peers;

test("macro_peers.json carries pricePli and no legacy foodPli", () => {
  assert.ok(peers.pricePli, "pricePli block present");
  assert.equal(peers.foodPli, undefined, "legacy foodPli removed");
});

test("A010101 is a food-kind aggregate, excluded from the detail rows", () => {
  const cats = peers.pricePli!.categories;
  const total = cats.find((c) => c.code === "A010101");
  assert.equal(total?.kind, "food", "A010101 tagged as food-kind");

  const detail = cats.filter((c) => c.kind === "food" && c.code !== "A010101");
  assert.ok(detail.length > 0, "food detail rows exist");
  assert.ok(
    detail.every((c) => c.parent === "A0101"),
    "every food detail row hangs off the A0101 division",
  );
});

test("the overall-consumption headline and food division are present", () => {
  const cats = peers.pricePli!.categories;
  assert.ok(
    cats.some((c) => c.kind === "headline" && c.code === "A01"),
    "A01 headline present",
  );
  assert.ok(
    cats.some((c) => c.kind === "division" && c.code === "A0101"),
    "A0101 food division present",
  );
});

test("BG carries an overall price level, a volume, and a trend", () => {
  const p = peers.pricePli!;
  assert.equal(typeof p.values.BG?.A01, "number", "BG overall PLI is numeric");
  assert.equal(
    typeof p.volumes.BG?.A01,
    "number",
    "BG real-consumption volume is numeric",
  );
  assert.ok(p.trend.years.length > 1, "convergence trend has multiple years");
  assert.equal(
    p.trend.values.BG?.length,
    p.trend.years.length,
    "BG trend series aligns with the year axis",
  );
});
