// parliament.bg's quoting of party names is UNBALANCED, and that is the whole reason this
// helper is not a one-liner. Measured over all 4,284 cached profiles: 3,715 carry a value in
// 49 distinct raw forms, 16 of them quoted, and the quoting appears as `"X"`, `Партия "X"`
// and `ПП "X` — an opening quote with no close on ~400 of them.
//
// Three implementations are plausible and only one is right:
//   • strip the EDGES     → leaves `Партия "Атака` on the unbalanced ones
//   • DELETE every quote  → joins words (`ПП "ГЕРБ` → `ППГЕРБ`)
//   • REPLACE with a space, then collapse  ← this one
//
// The test exists because the emitted value is what 1,443 person pages print as the party
// they were elected with, and none of the three fails loudly.

import { describe, it, expect } from "vitest";
import { electedWithOf, PARTY_QUOTE_CHARS } from "./electedWith";

describe("electedWithOf", () => {
  it("strips balanced quoting", () => {
    expect(electedWithOf({ A_ns_CoalL_value: '"Коалиция за България"' })).toBe(
      "Коалиция за България",
    );
  });

  it("strips UNBALANCED quoting without joining the words around it", () => {
    // Both real corpus shapes. A delete-throughout would yield "ППГЕРБ".
    expect(electedWithOf({ A_ns_CoalL_value: 'Партия "Атака"' })).toBe(
      "Партия Атака",
    );
    expect(electedWithOf({ A_ns_CoalL_value: 'ПП "ГЕРБ' })).toBe("ПП ГЕРБ");
  });

  it("handles the typographic quote glyphs too", () => {
    expect(electedWithOf({ A_ns_CoalL_value: "„Възраждане“" })).toBe(
      "Възраждане",
    );
    expect(electedWithOf({ A_ns_CoalL_value: "«ВОЛЯ»" })).toBe("ВОЛЯ");
  });

  it("returns null for absent or blank values, never an empty string", () => {
    // `""` is worse than null downstream: it is falsy, so it would suppress the badge, but
    // it is also not-null, so a `??` chain would stop on it.
    expect(electedWithOf({})).toBeNull();
    expect(electedWithOf({ A_ns_CoalL_value: "" })).toBeNull();
    expect(electedWithOf({ A_ns_CoalL_value: '  "" ' })).toBeNull();
  });

  it("leaves an unquoted name exactly as the register wrote it", () => {
    // No normalisation here on purpose — the canonical mapping is the consumer's job, and
    // rewriting „ГЕРБ" to a later coalition brand is a claim about who the seat belonged to.
    expect(electedWithOf({ A_ns_CoalL_value: "ГЕРБ" })).toBe("ГЕРБ");
    expect(electedWithOf({ A_ns_CoalL_value: "ГЕРБ – СДС" })).toBe(
      "ГЕРБ – СДС",
    );
  });

  it("the glyph class actually matches what it claims", () => {
    // A regex that matched nothing would make every assertion above pass vacuously.
    for (const q of ['"', "„", "“", "”", "«", "»", "'", "‘", "’"])
      expect(q).toMatch(new RegExp(PARTY_QUOTE_CHARS.source));
    expect("Х").not.toMatch(new RegExp(PARTY_QUOTE_CHARS.source));
  });
});
