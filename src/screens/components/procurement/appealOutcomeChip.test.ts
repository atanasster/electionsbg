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
  // Tone NAMES, not Tailwind classes — AppealChip owns the classes. Asserting on
  // the name is also what makes these cases readable as claims about meaning
  // rather than about pixels.
  it("colours an uphold red — the finding against the buyer", () => {
    expect(outcomeTone("уважена")).toBe("red");
    // Through isUpheldOutcome, so casing and padding cannot change the colour
    // from what upheld_ocids and the risk index score.
    expect(outcomeTone("  УВАЖЕНА ")).toBe("red");
  });

  it("colours a merits rejection emerald — the buyer was found for", () => {
    expect(outcomeTone("отхвърлена")).toBe("emerald");
  });

  it("gives every other outcome the neutral tone", () => {
    // A refusal is not a finding either way — it is the absence of a hearing,
    // so it must NOT take the emerald a rejection gets.
    expect(outcomeTone("отказана")).toBe("muted");
    expect(outcomeTone("прекратена")).toBe("muted");
    // `частично` is a part-uphold that the risk index deliberately scores as a
    // full one; it is reserved and unused, so neutral here is correct until it
    // is decided (see 042's vocabulary comment).
    expect(outcomeTone("частично")).toBe("muted");
    expect(outcomeTone(null)).toBe("muted");
  });

  it("returns amber for a row still in play", () => {
    // The no-outcome branch, matching AppealChip's own default for an appealed
    // procedure — so the tile and /procurement/appeals, which now share this
    // function, agree on every tone rather than only on three of the four.
    expect(outcomeChip(null, "открито производство", true).tone).toBe("amber");
    expect(outcomeChip(null, null, false).tone).toBe("amber");
  });
});
