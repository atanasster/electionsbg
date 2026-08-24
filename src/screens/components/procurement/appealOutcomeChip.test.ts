// `outcomeChip` — the awarder tile's pure branch table.
//
// Untested until the derived `отказана` outcome landed, which is what exposed
// the two defects these cases pin: the tile hardcoded its own EN translations
// (so an edit to OUTCOME_EN reached every surface but this one) and printed the
// raw Bulgarian `status` to English readers on the 3,271 appeals with no
// published ending.

import { describe, it, expect } from "vitest";
import { outcomeChip, outcomeTone } from "./appealOutcomeChip";

describe("outcomeChip", () => {
  it("renders a merits verdict through the shared label map", () => {
    expect(outcomeChip("уважена", null, true).text).toBe("уважена");
    expect(outcomeChip("уважена", null, false).text).toBe("upheld");
    expect(outcomeChip("отхвърлена", null, false).text).toBe("rejected");
  });

  it("renders the derived refusal in the register's words, never the code", () => {
    // `отказана` is our code; showing it raw would put a term КЗК never printed
    // in front of a Bulgarian reader.
    expect(outcomeChip("отказана", null, true).text).toBe(
      "отказано производство",
    );
    expect(outcomeChip("отказана", null, false).text).toBe(
      "refused — no proceedings",
    );
  });

  it("translates the status fallback instead of printing Cyrillic to EN", () => {
    expect(outcomeChip(null, "открито производство", false).text).toBe(
      "proceedings opened",
    );
    expect(outcomeChip(null, "открито производство", true).text).toBe(
      "открито производство",
    );
  });

  it("falls back to a pending label when there is no status either", () => {
    expect(outcomeChip(null, null, true).text).toBe("в производство");
    expect(outcomeChip(null, null, false).text).toBe("pending");
    expect(outcomeChip(null, "", false).text).toBe("pending");
  });

  it("keeps an unmapped outcome visible rather than dropping it", () => {
    expect(outcomeChip("нещо ново", null, false).text).toBe("нещо ново");
  });
});

describe("outcomeTone", () => {
  it("colours an uphold red — the finding against the buyer", () => {
    expect(outcomeTone("уважена")).toContain("red");
    // Through isUpheldOutcome, so casing and padding cannot change the colour
    // from what upheld_ocids and the risk index score.
    expect(outcomeTone("  УВАЖЕНА ")).toContain("red");
  });

  it("colours a rejection emerald", () => {
    expect(outcomeTone("отхвърлена")).toContain("emerald");
  });

  it("gives every other outcome the neutral tone", () => {
    // A refusal is not a finding either way — it is the absence of a hearing.
    expect(outcomeTone("отказана")).toContain("muted");
    expect(outcomeTone("прекратена")).toContain("muted");
    // `частично` is a part-uphold that the risk index deliberately scores as a
    // full one; it is reserved and unused, so neutral here is correct until it
    // is decided (see 042's vocabulary comment).
    expect(outcomeTone("частично")).toContain("muted");
    expect(outcomeTone(null)).toContain("muted");
  });
});
