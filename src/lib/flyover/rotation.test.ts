import { describe, expect, it } from "vitest";
import { nextProgramme, startingProgramme } from "./rotation";

describe("home playback order", () => {
  it("starts on animation one without consulting the visitor or day", () => {
    for (const value of [undefined, null, "", "unknown", "COLUMNS"]) {
      expect(startingProgramme(value)).toBe("columns");
    }
  });
  it("accepts an explicit starting scene", () => {
    expect(startingProgramme("arcs")).toBe("arcs");
    expect(startingProgramme("tour")).toBe("tour");
  });
  it("plays 1 → 2 → 3 → 1", () => {
    expect(nextProgramme("columns")).toBe("arcs");
    expect(nextProgramme("arcs")).toBe("tour");
    expect(nextProgramme("tour")).toBe("columns");
  });
});
