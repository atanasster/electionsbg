// Gates for the /budget hub registry (dashboard-hub skill §9). Each exists
// because its absence has shipped on some hub in this repo:
//
//   * a tile id with no scene is `undefined` as a component type — „Element
//     type is invalid" and a WHITE SCREEN, not a blank vignette;
//   * a `to` that no route serves is a dead link no type system catches;
//   * a sub-page the hub does not front is an orphan nothing indexes;
//   * a repeated accent reads as „these two tiles are the same kind of thing",
//     and all four bands render together on one page.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bgCorpus as bg, enCorpus as en } from "@/locales/allKeys";
import { BUDGET_BANDS, BUDGET_TILES } from "./budgetRegistry";
import { BUDGET_SCENES } from "./budgetScenes";

/** Every `/budget…` path the router actually serves, read from source so a
 *  deleted route breaks this loudly rather than silently orphaning a tile. */
const routedBudgetPaths = (): Set<string> => {
  const src = readFileSync(resolve(__dirname, "../../routes.tsx"), "utf-8");
  const out = new Set<string>();
  for (const m of src.matchAll(/path="(budget(?:\/[^"]*)?)"/g)) {
    out.add("/" + m[1]);
  }
  return out;
};

describe("budget hub registry", () => {
  it("fronts fourteen destinations across four bands", () => {
    expect(BUDGET_BANDS).toHaveLength(4);
    expect(BUDGET_TILES).toHaveLength(14);
    expect(new Set(BUDGET_TILES.map((t) => t.id)).size).toBe(14);
    expect(new Set(BUDGET_TILES.map((t) => t.to)).size).toBe(14);
  });

  it("has a scene for every tile id", () => {
    for (const tile of BUDGET_TILES) {
      expect(
        BUDGET_SCENES[tile.id],
        `no scene for tile "${tile.id}" — this renders as a white screen`,
      ).toBeTypeOf("function");
    }
    // …and no scene without a tile, which is dead code that reads as coverage.
    expect(Object.keys(BUDGET_SCENES).sort()).toEqual(
      BUDGET_TILES.map((t) => t.id).sort(),
    );
  });

  it("points every tile at a routed, absolute, unparameterised path", () => {
    const routed = routedBudgetPaths();
    // Not vacuous: the router really does serve budget paths.
    expect(routed.size).toBeGreaterThan(10);
    for (const tile of BUDGET_TILES) {
      expect(tile.to.startsWith("/budget"), tile.to).toBe(true);
      // A `:param` would satisfy an „absolute" check and link nowhere. This
      // module seeds nothing — `/budget/ministry/:id` is fronted by its picker.
      expect(tile.to).not.toContain(":");
      expect(routed.has(tile.to), `${tile.to} is not routed`).toBe(true);
    }
  });

  it("fronts every /budget sub-page the router serves", () => {
    const routed = routedBudgetPaths();
    const fronted = new Set(BUDGET_TILES.map((t) => t.to));
    // Pages that are deliberately NOT tiles, each with its reason. Anything
    // else appearing here is an orphan.
    const exempt = new Set([
      "/budget", // the hub itself
      "/budget/deep-dive", // the previous screen, kept reachable, not promoted
      "/budget/methodology", // reached from the footer/source lines
      "/budget/tax-calculator", // reached from the LeadCard (T5.5)
      "/budget/simulator", // its own entry point
      "/budget/mod", // an annex of the funds page
      "/budget/ministry", // the parameterised family, fronted by its picker
    ]);
    const orphans = [...routed].filter(
      (p) =>
        !fronted.has(p) && !exempt.has(p) && !p.startsWith("/budget/ministry/"),
    );
    expect(orphans).toEqual([]);
  });

  // NOTE: „every routed page is declared for prerender AND for the sitemap" is
  // NOT here. It lives in `scripts/prerender/ogAndSitemapCoverage.test.ts`,
  // which already owns „a page ships three artifacts" and already reads both
  // declaration files — and the defect it catches is not budget-specific:
  // `/procurement/tenders`, `/sofia/companies` and
  // `/sector/administration/services` are in the same state today. A per-hub
  // copy would be five implementations of one rule on a weaker primitive.

  it("uses a distinct accent for every tile on the page", () => {
    const accents = BUDGET_TILES.map((t) => t.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });

  it("balances each band to the 4-column grid", () => {
    // At `xl` the grid is 4 wide, so a 5-tile band strands one tile alone on
    // its own row. 4/4/3/3 leaves no orphan row.
    for (const band of BUDGET_BANDS) {
      expect(band.tiles.length).toBeGreaterThanOrEqual(3);
      expect(band.tiles.length).toBeLessThanOrEqual(4);
    }
  });

  it("names every band for what is in it, and resolves both strings", () => {
    // Asserting the KEY PREFIX could not fail — renaming a band to
    // `budget_band_more` („Още", the exact thing this is meant to forbid) left
    // it green. It reads the COPY now, from the bundle, and rejects the two
    // words the skill names: „Още" announces only that the band above it
    // mattered more, and „Разгледай" is an instruction rather than a location.
    for (const band of BUDGET_BANDS) {
      const label = (bg as Record<string, string>)[band.labelKey];
      const desc = (bg as Record<string, string>)[band.descKey];
      expect(label, `${band.labelKey} has no Bulgarian string`).toBeTruthy();
      expect(desc, `${band.descKey} has no Bulgarian string`).toBeTruthy();
      expect(label).not.toMatch(/^(Още|Разгледай|Друго|Останало)$/);
      // A description that just restates the heading is not a table of
      // contents — it has to be longer and different.
      expect(desc.length).toBeGreaterThan(label.length + 10);
      expect(desc).not.toBe(label);
      // And it must be in both bundles, or /en shows the raw key.
      expect((en as Record<string, string>)[band.labelKey]).toBeTruthy();
      expect((en as Record<string, string>)[band.descKey]).toBeTruthy();
    }
  });
});
