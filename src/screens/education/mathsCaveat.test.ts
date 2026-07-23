// The maths line qualifies itself in two independent ways, and both matter on
// real pages: 54 of the 152 schools that show it carry a year 1-4 behind their
// own latest БЕЛ, and the median maths group is 7 pupils (the smallest is 1).

import { describe, it, expect } from "vitest";
import { mathsCaveat, mathsCaveatText } from "./mathsCaveat";

const MIN = 10;

describe("mathsCaveat", () => {
  it("is null when the school has no maths result", () => {
    expect(mathsCaveat(null, 2026, MIN)).toBeNull();
    expect(mathsCaveatText(null, true)).toBeNull();
  });

  it("flags a maths year behind the school's latest БЕЛ year", () => {
    // The Nedelino case: maths only in 2022, БЕЛ through 2026.
    const c = mathsCaveat({ year: 2022, n: 17 }, 2026, MIN)!;
    expect(c.stale).toBe(true);
    expect(c.smallCohort).toBe(false);
    expect(mathsCaveatText(c, true)).toMatch(/Последната година/);
  });

  it("flags a cohort under the ranking floor", () => {
    const c = mathsCaveat({ year: 2026, n: 3 }, 2026, MIN)!;
    expect(c.stale).toBe(false);
    expect(c.smallCohort).toBe(true);
    expect(mathsCaveatText(c, true)).toMatch(/несигурна/);
  });

  it("flags both at once, in one sentence", () => {
    const c = mathsCaveat({ year: 2023, n: 1 }, 2026, MIN)!;
    expect(c).toEqual({ stale: true, smallCohort: true });
    const txt = mathsCaveatText(c, true)!;
    expect(txt).toMatch(/Последната година/);
    expect(txt).toMatch(/несигурна/);
  });

  it("says nothing when the figure is current and big enough", () => {
    const c = mathsCaveat({ year: 2026, n: 145 }, 2026, MIN)!;
    expect(c).toEqual({ stale: false, smallCohort: false });
    expect(mathsCaveatText(c, true)).toBeNull();
  });

  it("treats the floor as exclusive — exactly the minimum is fine", () => {
    expect(mathsCaveat({ year: 2026, n: MIN }, 2026, MIN)!.smallCohort).toBe(
      false,
    );
    expect(
      mathsCaveat({ year: 2026, n: MIN - 1 }, 2026, MIN)!.smallCohort,
    ).toBe(true);
  });

  it("claims nothing about the cohort on a payload that carries no count", () => {
    // Older payloads have no `n`; absence must not read as "small".
    const c = mathsCaveat({ year: 2026 }, 2026, MIN)!;
    expect(c.smallCohort).toBe(false);
    expect(mathsCaveatText(c, true)).toBeNull();
  });

  it("has an English form for both notes", () => {
    const c = mathsCaveat({ year: 2022, n: 2 }, 2026, MIN)!;
    const txt = mathsCaveatText(c, false)!;
    expect(txt).toMatch(/last year this school had a maths matura/i);
    expect(txt).toMatch(/small group/i);
  });
});
