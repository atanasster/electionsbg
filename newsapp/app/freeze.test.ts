// The election-freeze sentence (news-person-sentiment-v1 §8.2): dates stated
// in Europe/Sofia time, never relative, and nothing when nothing is frozen.
import { describe, it, expect } from "vitest";
import { freezeText } from "./freeze";

const frozen = {
  frozen: {
    id: "pvr2026-r1",
    as_of: "2026-11-06T21:59:00+00:00",
    until: "2026-11-08T20:00:00+02:00",
  },
};

describe("freezeText", () => {
  it("states both instants in Sofia time", () => {
    const bg = freezeText(frozen, false)!;
    expect(bg).toContain("6 ноември 2026");
    expect(bg).toContain("23:59");
    expect(bg).toContain("8 ноември");
    expect(bg).toContain("20:00");
    expect(bg).toContain("Оценките на отделните статии се обновяват");
    expect(freezeText(frozen, true)).toContain("6 November 2026");
  });

  it("says withheld rather than frozen with no snapshot", () => {
    const text = freezeText(
      { withheld: { id: "x", until: "2026-11-08T18:00:00Z" } },
      false,
    )!;
    expect(text).toContain("не се публикуват");
    expect(text).toContain("20:00");
  });

  it("is nothing outside a freeze", () => {
    expect(freezeText({}, false)).toBeNull();
    expect(freezeText(null, true)).toBeNull();
  });
});
