import { describe, expect, it } from "vitest";
import { narrate } from "./narrate";
import type { Envelope } from "../tools/types";

const env = (facts: Record<string, string>): Envelope =>
  ({
    tool: "openCalls",
    domain: "fiscal",
    kind: "table",
    title: "Отворени процедури",
    facts: {
      calls: "2",
      indicative: "8",
      consultations: "0",
      checked: "2026-10-03",
      coverage: "COVERAGE.",
      ...facts,
    },
  }) as Envelope;

describe("openCalls narration", () => {
  it("names the audience and keeps the notes in order", () => {
    const e = env({
      audience: "земеделски стопани",
      sector_note: "SECTOR.",
      unclassified: "UNCLASSIFIED.",
    });
    const bg = narrate(e, "bg");
    expect(bg.startsWith("За земеделски стопани: 2 процедури")).toBe(true);
    expect(bg).toMatch(/SECTOR\. UNCLASSIFIED\. COVERAGE\.$/u);
    expect(
      narrate(e, "en").startsWith("For земеделски стопани: 2 procedures"),
    ).toBe(true);
  });

  it("has no prefix and no stray spaces when the notes are absent", () => {
    for (const lang of ["bg", "en"] as const) {
      const s = narrate(env({}), lang);
      expect(s.startsWith("2 ")).toBe(true);
      expect(s).not.toMatch(/ {2}/u);
      expect(s.endsWith("COVERAGE.")).toBe(true);
    }
  });
});
