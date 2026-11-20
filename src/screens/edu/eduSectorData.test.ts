import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  EDU_HUB_TITLE,
  foldRetired,
  foldRetiredFunds,
  parseUniverse,
  universeRows,
} from "./eduSectorData";
import type { EduBodyAgg } from "@/data/edu/useEduSector";

const body = (
  eik: string,
  universe: EduBodyAgg["universe"],
  totalEur: number,
  contractCount = 1,
): EduBodyAgg => ({
  eik,
  name: eik,
  universe,
  totalEur,
  contractCount,
  bidKnownN: contractCount,
  singleBidN: 0,
});

describe("foldRetired", () => {
  it("folds the retired ЕИК of СА „Ценов“ into its successor's row", () => {
    const out = foldRetired([
      body("040624317", "higher_education", 10, 2),
      body("000124026", "higher_education", 5, 1),
    ]);
    expect(out.has("040624317")).toBe(false);
    expect(out.get("000124026")).toMatchObject({
      totalEur: 15,
      contractCount: 3,
    });
  });
});

describe("foldRetiredFunds", () => {
  it("lists one ИСУН row per institution, summing the retired ЕИК into its successor", () => {
    const out = foldRetiredFunds([
      { eik: "040624317", grantEur: 10, paidEur: 4, projectCount: 2 },
      { eik: "000124026", grantEur: 5, paidEur: 1, projectCount: 1 },
      { eik: "000670680", grantEur: 7, paidEur: 7, projectCount: 3 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.eik === "000124026")).toEqual({
      eik: "000124026",
      grantEur: 15,
      paidEur: 5,
      projectCount: 3,
    });
  });
});

describe("universeRows", () => {
  it("sums by universe, drops unclassified and empty groups, keeps register order", () => {
    const rows = universeRows([
      body("a", "research_ban", 3),
      body("b", "ministry", 2),
      body("c", "ministry", 4),
      body("d", "", 99),
      body("e", "agency", 0, 0),
    ]);
    expect(rows.map((r) => [r.universe, r.totalEur])).toEqual([
      ["ministry", 6],
      ["research_ban", 3],
    ]);
  });
});

describe("parseUniverse", () => {
  it("accepts only register universes", () => {
    expect(parseUniverse("higher_education")).toBe("higher_education");
    expect(parseUniverse("HIGHER_EDUCATION")).toBeNull();
    expect(parseUniverse("")).toBeNull();
  });
});

describe("the prerendered <h1>s", () => {
  it("equal the screens' own titles", () => {
    const pre = readFileSync("scripts/prerender/routes.ts", "utf8");
    const titles = [
      EDU_HUB_TITLE,
      ...["EduProcurementScreen", "EduBodiesScreen", "EduMoneyScreen"].map(
        (f) => {
          const src = readFileSync(`src/screens/edu/${f}.tsx`, "utf8");
          const m = src.match(
            /title=\{\{\s*bg:\s*"([^"]+)",\s*en:\s*"([^"]+)"/,
          );
          expect(m, f).toBeTruthy();
          return { bg: m![1], en: m![2] };
        },
      ),
    ];
    for (const t of titles) {
      expect(pre, t.bg).toContain(`<h1>${t.bg}</h1>`);
      expect(pre, t.en).toContain(`<h1>${t.en}</h1>`);
    }
  });
});
