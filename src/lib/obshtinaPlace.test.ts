import { describe, it, expect } from "vitest";
import { canonicalObshtina, SYNTHETIC_OBSHTINA_LABELS } from "./obshtinaPlace";

// The Sofia direction is the whole point of this module: `SFO_CITY` is the code the
// frontend queries municipal_officials_table with, so a flipped fold would break the
// capital's municipal roster outright. These run without Postgres, which makes them the
// only coverage of the fold that survives CI.
describe("canonicalObshtina", () => {
  it("folds the local-shard Sofia code onto the frontend code", () => {
    expect(canonicalObshtina("SOF")).toBe("SFO_CITY");
  });

  it("folds the governance-route Sofia code onto the frontend code", () => {
    // SOF00 is SOFIA_CITY_GOVERNANCE_ID — the id /governance/:obshtina and
    // /consumption/:obshtina route on. Unfolded, MyAreaGovernmentCard queried
    // municipal_officials_table with it, matched none of the 75 SFO_CITY listings and
    // rendered "Няма деклариран кмет" over a sitting mayor.
    expect(canonicalObshtina("SOF00")).toBe("SFO_CITY");
  });

  it("is idempotent on the canonical code", () => {
    expect(canonicalObshtina("SFO_CITY")).toBe("SFO_CITY");
  });

  it("does NOT collapse Sofia's 24 районa — each holds its own office", () => {
    // A кмет на район holds that район's office, and both sources already agree on the
    // S2*** code. Folding them into the city bundle would erase 24 distinct offices.
    expect(canonicalObshtina("S2401")).toBe("S2401");
    expect(canonicalObshtina("S2309")).toBe("S2309");
  });

  it("passes ordinary obshtina codes through untouched", () => {
    expect(canonicalObshtina("BLG11")).toBe("BLG11");
    expect(canonicalObshtina("PDV22")).toBe("PDV22");
  });

  it("maps empty / null / undefined to null, never to a bare code", () => {
    expect(canonicalObshtina("")).toBeNull();
    expect(canonicalObshtina(null)).toBeNull();
    expect(canonicalObshtina(undefined)).toBeNull();
  });
});

describe("SYNTHETIC_OBSHTINA_LABELS", () => {
  it("labels every synthetic code in both languages", () => {
    const entries = Object.entries(SYNTHETIC_OBSHTINA_LABELS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [code, label] of entries) {
      expect(code, "synthetic code must be non-empty").toBeTruthy();
      expect(label.bg, `${code} has no BG label`).toBeTruthy();
      expect(label.en, `${code} has no EN label`).toBeTruthy();
    }
  });

  it("covers the canonical Sofia code, which municipalities.json cannot carry", () => {
    // data/municipalities.json holds real EKATTE municipalities only; SFO_CITY is minted
    // by municipality_join.ts. Without this entry the capital's roles render an unlabelled
    // badge — the failure the 'every place_code resolves to both labels' gate catches, but
    // only when Postgres is up.
    expect(SYNTHETIC_OBSHTINA_LABELS.SFO_CITY?.bg).toBe("Столична община");
  });

  it("never labels a code that canonicalObshtina would rewrite", () => {
    // A synthetic label keyed on a non-canonical code would be dead: the resolver
    // canonicalises before looking the label up.
    for (const code of Object.keys(SYNTHETIC_OBSHTINA_LABELS))
      expect(canonicalObshtina(code)).toBe(code);
  });
});
