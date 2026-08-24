// Display labels for КЗК statuses and merits outcomes.
//
// These were uncovered until `отказана` was added — a value that is NOT a
// register term but a CODE derived from the proceeding status by
// kzk_effective_outcome() (042), which is exactly the case the BG side of the
// map exists for and the one a raw pass-through would get wrong.

import { describe, it, expect } from "vitest";
import { kzkOutcomeLabel, kzkStatusLabel, isUpheldOutcome } from "./kzkLabels";

describe("kzkOutcomeLabel", () => {
  it("shows the register's own term to a BG reader", () => {
    expect(kzkOutcomeLabel("уважена", "bg")).toBe("уважена");
    expect(kzkOutcomeLabel("отхвърлена", "bg-BG")).toBe("отхвърлена");
  });

  it("translates for EN, including regional locales", () => {
    expect(kzkOutcomeLabel("уважена", "en")).toBe("upheld");
    // `en-US` used to fall through the old `!== "en"` test and see raw Bulgarian.
    expect(kzkOutcomeLabel("уважена", "en-US")).toBe("upheld");
  });

  it("renders the derived refusal in words the register actually uses", () => {
    // `отказана` is our code, not КЗК's wording — the refusal is of the
    // PROCEEDINGS, not of the complaint. Showing the bare code to a Bulgarian
    // reader would put a term the register never printed on the page, which is
    // why the BG override map exists at all.
    expect(kzkOutcomeLabel("отказана", "bg")).toBe("отказано производство");
    expect(kzkOutcomeLabel("отказана", "en")).toBe("refused — no proceedings");
  });

  it("falls back to the raw term for a value not in the map", () => {
    // A new register verdict must render as itself rather than vanish.
    expect(kzkOutcomeLabel("нещо ново", "en")).toBe("нещо ново");
    expect(kzkOutcomeLabel("нещо ново", "bg")).toBe("нещо ново");
  });

  it("returns an empty string for a missing outcome", () => {
    expect(kzkOutcomeLabel(null, "bg")).toBe("");
    expect(kzkOutcomeLabel(undefined, "en")).toBe("");
    expect(kzkOutcomeLabel("", "en")).toBe("");
  });

  it("is case- and whitespace-insensitive on the lookup", () => {
    expect(kzkOutcomeLabel("  УВАЖЕНА  ", "en")).toBe("upheld");
    expect(kzkOutcomeLabel(" ОТКАЗАНА ", "bg")).toBe("отказано производство");
  });
});

describe("kzkStatusLabel", () => {
  it("keeps BG and translates EN", () => {
    expect(kzkStatusLabel("отказано производство", "bg")).toBe(
      "отказано производство",
    );
    expect(kzkStatusLabel("отказано производство", "en")).toBe(
      "no proceedings (refused)",
    );
  });

  it("takes no BG override — every status IS a register term", () => {
    // The outcome map needs one because `отказана` is derived. Statuses come
    // verbatim from the register, so a BG override here would be a rewrite.
    for (const s of [
      "приключено производство",
      "открито производство",
      "обединено",
    ])
      expect(kzkStatusLabel(s, "bg")).toBe(s);
  });
});

describe("isUpheldOutcome", () => {
  it("fires on a full uphold only", () => {
    expect(isUpheldOutcome("уважена")).toBe(true);
    expect(isUpheldOutcome("  Уважена ")).toBe(true);
    // `частично` is deliberately excluded, matching upheld_ocids in SQL.
    expect(isUpheldOutcome("частично")).toBe(false);
    expect(isUpheldOutcome("отхвърлена")).toBe(false);
  });

  it("does NOT fire on the derived refusal", () => {
    // The property that keeps the Corruption Risk Index honest: a refusal to
    // open proceedings is not a finding against the buyer. upheld_ocids reads
    // the RAW column and never sees this value at all; this asserts the
    // front-end twin agrees.
    expect(isUpheldOutcome("отказана")).toBe(false);
    expect(isUpheldOutcome("отказано производство")).toBe(false);
  });

  it("is null-safe", () => {
    expect(isUpheldOutcome(null)).toBe(false);
    expect(isUpheldOutcome(undefined)).toBe(false);
  });
});
