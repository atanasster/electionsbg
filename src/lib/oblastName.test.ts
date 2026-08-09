import { describe, it, expect } from "vitest";
import regions from "@/data/json/regions.json";
import {
  bareOblastName,
  oblastLabel,
  oblastNameIsSelfTyped,
  type OblastLabelForm,
} from "./oblastName";

// Every way a doubled tier word has been observed to render. The three BG forms
// differ only in the tier word's shape, so a label may carry at most one of
// them — and an already-typed name ("София област") may carry none of ours.
const DOUBLED = [
  /обл\.\s*обл\./i,
  /област\s+обл\./i,
  /обл\.\s+\S+\s+област/i,
  /област\s+\S+\s+област/i,
  /(prov\.|province)\s+\S*\s*(prov\.|province)/i,
  /(region|MMR|abroad)\b.*\bprovince/i,
];

const FORMS: OblastLabelForm[] = ["compact", "prose", "leading"];

const nameOf = (r: { long_name?: string; name: string }) =>
  r.long_name || r.name;
const nameEnOf = (r: {
  long_name_en?: string;
  name_en?: string;
  name: string;
}) => r.long_name_en || r.name_en || r.name;

describe("bareOblastName", () => {
  it("strips the compact tier prefix in both languages", () => {
    expect(bareOblastName("обл. Пловдив")).toBe("Пловдив");
    expect(bareOblastName("prov. Plovdiv")).toBe("Plovdiv");
  });

  it("leaves a plain or self-typed name untouched", () => {
    expect(bareOblastName("Благоевград")).toBe("Благоевград");
    expect(bareOblastName("София област")).toBe("София област");
    expect(bareOblastName("Извън страната")).toBe("Извън страната");
  });

  it("does not strip a name that merely starts with the same letters", () => {
    // No region is named this, but the regex must anchor on the "обл." token —
    // a bare `replace(/обл\./)` would maul any name containing it.
    expect(bareOblastName("Област Пловдив")).toBe("Област Пловдив");
  });
});

describe("oblastNameIsSelfTyped", () => {
  it("recognises the four regions that name their own tier", () => {
    for (const n of [
      "София област",
      "София 23 МИР",
      "Извън страната",
      "Sofia region",
      "Sofia 23 MMR",
      "Abroad",
    ])
      expect(oblastNameIsSelfTyped(n)).toBe(true);
  });

  it("does not count PDV's compact prefix as self-typed", () => {
    // "обл. Пловдив" carries a tier PREFIX, which `bareOblastName` removes —
    // the remainder is a plain name that still needs a tier word composed.
    expect(oblastNameIsSelfTyped("обл. Пловдив")).toBe(false);
    expect(oblastNameIsSelfTyped("prov. Plovdiv")).toBe(false);
    expect(oblastNameIsSelfTyped("Благоевград")).toBe(false);
  });
});

describe("oblastLabel", () => {
  it("composes the tier word in the right position per form", () => {
    expect(oblastLabel("Пловдив", "bg", "compact")).toBe("обл. Пловдив");
    expect(oblastLabel("Пловдив", "bg", "prose")).toBe("област Пловдив");
    expect(oblastLabel("Пловдив", "bg", "leading")).toBe("Област Пловдив");
    expect(oblastLabel("Plovdiv", "en", "prose")).toBe("Plovdiv province");
  });

  it("adds no second tier word to a name that already carries one", () => {
    expect(oblastLabel("обл. Пловдив", "bg", "compact")).toBe("обл. Пловдив");
    expect(oblastLabel("обл. Пловдив", "bg", "leading")).toBe("Област Пловдив");
    expect(oblastLabel("София област", "bg", "compact")).toBe("София област");
    expect(oblastLabel("София 23 МИР", "bg", "leading")).toBe("София 23 МИР");
    expect(oblastLabel("Извън страната", "bg", "prose")).toBe("Извън страната");
    expect(oblastLabel("prov. Plovdiv", "en", "prose")).toBe(
      "Plovdiv province",
    );
    expect(oblastLabel("Sofia region", "en", "prose")).toBe("Sofia region");
  });

  // PDV ("обл. Пловдив", the province) and PDV-00 ("Пловдив", the градски МИР
  // inside it) both bare to "Пловдив", so without the code the two region pages
  // label identically and share a <title>.
  it("names a градски МИР as one, so it cannot collide with its province", () => {
    expect(oblastLabel("Пловдив", "bg", "prose", "PDV-00")).toBe("МИР Пловдив");
    expect(oblastLabel("Пловдив", "bg", "leading", "PDV-00")).toBe(
      "МИР Пловдив",
    );
    expect(oblastLabel("Plovdiv", "en", "prose", "PDV-00")).toBe("Plovdiv MMR");
    for (const form of FORMS)
      expect(oblastLabel("Пловдив", "bg", form, "PDV-00")).not.toBe(
        oblastLabel("обл. Пловдив", "bg", form, "PDV"),
      );
  });

  it("gives every region in regions.json a label unique to it", () => {
    for (const form of FORMS) {
      const byLabel = new Map<string, string>();
      for (const r of regions) {
        const label = oblastLabel(nameOf(r), "bg", form, r.oblast);
        const clash = byLabel.get(label);
        expect(clash, `${r.oblast} and ${clash} both label "${label}"`).toBe(
          undefined,
        );
        byLabel.set(label, r.oblast);
      }
    }
  });

  it("is idempotent — labelling a label changes nothing", () => {
    for (const form of FORMS)
      for (const r of regions) {
        const once = oblastLabel(nameOf(r), "bg", form);
        expect(oblastLabel(once, "bg", form)).toBe(once);
      }
  });

  // The regression this file exists for: six of the 31 regions (PDV, SFO, S23,
  // S24, S25 and the abroad district 32) hold a name that already reads as its
  // own tier, and ~1.2k prerendered pages named one of them with a tier word of
  // their own — "гр. Карлово, обл. обл. Пловдив", "Област Извън страната".
  it("never doubles a tier word for any region in regions.json", () => {
    for (const form of FORMS)
      for (const r of regions) {
        for (const label of [
          oblastLabel(nameOf(r), "bg", form),
          oblastLabel(nameEnOf(r), "en", form),
        ]) {
          expect(label.length).toBeGreaterThan(0);
          for (const bad of DOUBLED) expect(label).not.toMatch(bad);
        }
      }
  });

  it("returns an empty label for an empty name rather than a bare tier word", () => {
    expect(oblastLabel("", "bg", "prose")).toBe("");
    expect(oblastLabel("обл.", "bg", "prose")).toBe("");
  });
});
