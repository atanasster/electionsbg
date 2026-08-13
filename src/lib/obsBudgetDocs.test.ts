// The two halves of the OBS mapping live on opposite sides of the database:
// `OBS_CATEGORY` in `scripts/db/load_budget_pg.ts` decides what goes INTO
// `budget_document.obs_category`, and `OBS_BUDGET_DOCS` here decides what
// /budget/law scores it against. Nothing else connects them.
//
// A drift is silent and expensive: a renamed slot scores itself absent, and the
// page then publishes „Bulgaria does not publish a year-end report" — the most
// consequential sentence on it — over a corpus holding thirty of them.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OBS_BUDGET_DOCS, OBS_DOC_COUNT } from "./obsBudgetDocs";

/** The loader's mapping, read from source. Importing the module would pull in
 *  its Postgres client and its top-level file reads. */
const loaderCategories = (): string[] => {
  const src = readFileSync(
    resolve(__dirname, "../../scripts/db/load_budget_pg.ts"),
    "utf-8",
  );
  const block = src.match(
    /const OBS_CATEGORY: Record<string, string \| null> = \{([\s\S]*?)\n\};/,
  );
  if (!block) throw new Error("OBS_CATEGORY not found in load_budget_pg.ts");
  return [...block[1].matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
};

describe("OBS budget documents", () => {
  it("is the survey's eight, with unique ids", () => {
    expect(OBS_DOC_COUNT).toBe(8);
    expect(new Set(OBS_BUDGET_DOCS.map((d) => d.id)).size).toBe(8);
  });

  it("covers every category the loader can write", () => {
    const slots = new Set(OBS_BUDGET_DOCS.map((d) => d.id));
    const written = loaderCategories();
    // Not vacuous: the loader really does write categories.
    expect(written.length).toBeGreaterThan(0);
    for (const c of written) expect(slots).toContain(c);
  });

  it("keeps the four Bulgaria's corpus cannot fill", () => {
    // These four have NO kind mapping to them in the loader, which is what
    // makes the page's „N of 8" score meaningful rather than tautological. If
    // an ingest starts producing one, this list shrinks — deliberately, so the
    // change is visible in a diff rather than showing up as a moved number.
    const written = new Set(loaderCategories());
    const unfilled = OBS_BUDGET_DOCS.filter((d) => !written.has(d.id)).map(
      (d) => d.id,
    );
    expect(unfilled).toEqual([
      "pre-budget-statement",
      "executive-budget-proposal",
      "citizens-budget",
      "mid-year-review",
    ]);
  });

  it("carries both languages for every slot", () => {
    for (const d of OBS_BUDGET_DOCS) {
      for (const k of ["labelBg", "labelEn", "descBg", "descEn"] as const) {
        expect(d[k].length).toBeGreaterThan(0);
      }
      // A Bulgarian label that is still English is the usual copy-paste.
      expect(d.labelBg).toMatch(/[Ѐ-ӿ]/);
      expect(d.labelEn).not.toMatch(/[Ѐ-ӿ]/);
    }
  });
});
