// `categoryOfCpv` and `CATEGORY_CPV_DIVS` are two statements of ONE rule: the
// first buckets a contract for the tile, the second builds the
// /procurement/contracts?cpv=… deep-link the tile's own row links to. When they
// disagree, the tile says „Мониторинг · €X" and the link beneath it opens a
// different set of contracts — both pages right, one of them about something
// else. Nothing else in the repo holds them together.

import { describe, it, expect } from "vitest";
import { categoryOfCpv, categoryCpvDivs, type EnvCategory } from "./environmentAttributes"; // prettier-ignore

const CATEGORIES: EnvCategory[] = [
  "waste",
  "water_treatment",
  "monitoring",
  "nature",
  "construction",
  "services",
  "supplies",
  "other",
];

describe("categoryOfCpv", () => {
  it("routes 50.4 to monitoring, not to services", () => {
    // Servicing of the MEASURING networks — 151 contracts, €6.8M, 99.6% of it
    // instrumentation (air 37.1%, radiation 19.7%, water 7.7%, lab 35.5%). It
    // is what EnvironmentAirMoneyTile prints beside the measured ФПЧ10, so
    // filing it as generic maintenance understated that figure by 11.5%.
    expect(categoryOfCpv("50410000")).toBe("monitoring");
    expect(categoryOfCpv("50413200")).toBe("monitoring");
  });

  it("routes the REST of division 50 to services", () => {
    expect(categoryOfCpv("50000000")).toBe("services"); // division root
    expect(categoryOfCpv("50112000")).toBe("services"); // vehicles
    expect(categoryOfCpv("50531100")).toBe("services"); // boilers
    expect(categoryOfCpv("50300000")).toBe("services"); // computers
  });

  it("routes software (48) to services, beside IT services (72)", () => {
    expect(categoryOfCpv("48000000")).toBe("services");
    expect(categoryOfCpv("48800000")).toBe("services");
    expect(categoryOfCpv("72000000")).toBe("services");
  });

  it("keeps the division-90 sub-group split", () => {
    expect(categoryOfCpv("90400000")).toBe("water_treatment");
    expect(categoryOfCpv("90500000")).toBe("waste");
    expect(categoryOfCpv("90600000")).toBe("waste");
    expect(categoryOfCpv("90700000")).toBe("monitoring");
  });

  it("sinks an absent or unnamed CPV to other", () => {
    expect(categoryOfCpv(undefined)).toBe("other");
    expect(categoryOfCpv("")).toBe("other");
    expect(categoryOfCpv("64000000")).toBe("other"); // postal/telecom
  });

  it("ignores whitespace in the stored code", () => {
    expect(categoryOfCpv(" 504 10000 ")).toBe("monitoring");
  });
});

describe("CATEGORY_CPV_DIVS mirrors categoryOfCpv", () => {
  it("every declared prefix classifies back to its own category", () => {
    const wrong: string[] = [];
    for (const cat of CATEGORIES)
      for (const prefix of categoryCpvDivs(cat)) {
        const code = prefix.padEnd(8, "0");
        const got = categoryOfCpv(code);
        if (got !== cat) wrong.push(`${cat}: "${prefix}" (${code}) → ${got}`);
      }
    expect(wrong).toEqual([]);
  });

  it("no prefix contains a code that classifies somewhere else", () => {
    // ⚠ The zero-padded probe above CANNOT catch the regression this file exists
    // for. `services: [..., "50"]` passes it, because "50".padEnd(8,"0") is
    // "50000000" — which really is services. The link would still over-select,
    // because the browse ORs PREFIXES and "50" also matches every 504 row the
    // tile counted under Мониторинг.
    //
    // So walk each prefix's DESCENDANTS: extend it one digit at a time and
    // require every extension to classify the same way. That is the property the
    // deep-link actually depends on, and "50" fails it at "504".
    const wrong: string[] = [];
    for (const cat of CATEGORIES)
      for (const prefix of categoryCpvDivs(cat)) {
        let frontier = [prefix];
        while (frontier[0] && frontier[0].length < 8) {
          const next: string[] = [];
          for (const p of frontier)
            for (let d = 0; d <= 9; d++) {
              const child = `${p}${d}`;
              const got = categoryOfCpv(child.padEnd(8, "0"));
              if (got !== cat)
                wrong.push(`${cat}: "${prefix}" ⊃ "${child}" → ${got}`);
              // Only descend where the code is still a group prefix; 8 digits is
              // a full CPV and the classifier reads at most the first three.
              if (child.length < 4) next.push(child);
            }
          frontier = next;
        }
      }
    expect(wrong).toEqual([]);
  });

  it("only `other` is undeep-linkable", () => {
    // `other` is the sink — a set of divisions plus every uncoded row — so it
    // has no reproducible prefix set and the tile renders it unlinked.
    expect(categoryCpvDivs("other")).toEqual([]);
    for (const cat of CATEGORIES.filter((c) => c !== "other"))
      expect(categoryCpvDivs(cat).length, cat).toBeGreaterThan(0);
  });

  it("no prefix is claimed by two categories, nor nested inside another's", () => {
    // String equality alone would let services:"50" sit beside monitoring:"504"
    // — different strings, overlapping sets. Containment is the real constraint.
    const all = CATEGORIES.flatMap((cat) =>
      categoryCpvDivs(cat).map((prefix) => ({ cat, prefix })),
    );
    const clashes: string[] = [];
    for (const a of all)
      for (const b of all) {
        if (a === b || a.cat === b.cat) continue;
        if (a.prefix.startsWith(b.prefix) || b.prefix.startsWith(a.prefix))
          clashes.push(
            `${a.cat}:"${a.prefix}" overlaps ${b.cat}:"${b.prefix}"`,
          );
      }
    expect(clashes).toEqual([]);
  });
});
