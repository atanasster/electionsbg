// The vocabulary the /court pages are written in — shared by the screen and the
// prerender builder so a crawler and a reader never see the same body described
// two different ways.
//
// `judicialTierAdjective` is the reason this module exists: `judicial_body.tier`
// is stored in the masculine, and composing it naively with the kind noun writes
// "апелативен прокуратура" onto 70 static pages.

import { describe, it, expect } from "vitest";
import {
  bgIn,
  judicialKindLabel,
  judicialKindPhrase,
  judicialNum,
  judicialTierAdjective,
} from "./judicialKind";

describe("judicialTierAdjective", () => {
  it("feminises every tier for прокуратура", () => {
    // All 9 tiers present in judicial_body, verified against the dimension.
    const cases: Array<[string, string]> = [
      ["районен", "районна"],
      ["окръжен", "окръжна"],
      ["градски", "градска"],
      ["апелативен", "апелативна"],
      ["административен", "административна"],
      ["върховен", "върховна"],
      ["военен", "военна"],
      ["специализиран", "специализирана"],
      ["национален", "национална"],
    ];
    for (const [masc, fem] of cases) {
      expect(judicialTierAdjective(masc, "prosecution")).toBe(fem);
    }
  });

  it("keeps the masculine form for съд / следствен отдел / съвет", () => {
    for (const kind of ["court", "investigation", "council"]) {
      expect(judicialTierAdjective("апелативен", kind)).toBe("апелативен");
    }
  });

  it("passes an unknown tier through rather than dropping it", () => {
    // A new tier should read slightly off, not vanish from the sentence.
    expect(judicialTierAdjective("новосъздаден", "prosecution")).toBe(
      "новосъздаден",
    );
    expect(judicialTierAdjective(null, "court")).toBe("");
    expect(judicialTierAdjective(undefined, "prosecution")).toBe("");
  });
});

describe("bgIn", () => {
  it("uses във before a В-/Ф-initial name", () => {
    // 11 of the 279 bodies start with В — both Supreme Courts among them.
    expect(bgIn("Върховен касационен съд")).toBe("във");
    expect(bgIn("Военен съд — София")).toBe("във");
    expect(bgIn("Фондова борса")).toBe("във");
  });

  it("uses в everywhere else, ignoring leading whitespace", () => {
    expect(bgIn("Софийски градски съд")).toBe("в");
    expect(bgIn("  Районен съд — Варна")).toBe("в");
  });
});

describe("judicialKindLabel / judicialKindPhrase", () => {
  it("labels each kind in both languages", () => {
    expect(judicialKindLabel("prosecution").bg).toBe("Прокуратура");
    expect(judicialKindPhrase("investigation").en).toBe(
      "investigation service",
    );
  });

  it("falls back to court — the modal kind and the one the URL promises", () => {
    expect(judicialKindLabel("nonsense").bg).toBe("Съд");
    expect(judicialKindPhrase(null).bg).toBe("съд");
    expect(judicialKindPhrase(undefined).en).toBe("court");
  });
});

describe("judicialNum", () => {
  it("formats per the reader's locale, identically on both sides", () => {
    // The builder used toFixed() and the screen toLocaleString(), so the static
    // HTML said 13.85 and the hydrated page said 13,85 for one figure.
    expect(judicialNum(13.85, "bg")).toBe("13,85");
    expect(judicialNum(13.85, "en")).toBe("13.85");
  });

  it("renders a missing figure as a dash, not as zero", () => {
    expect(judicialNum(null, "bg")).toBe("—");
    expect(judicialNum(undefined, "en")).toBe("—");
  });
});
