import { describe, expect, it } from "vitest";
import {
  formatCount,
  renderTourText,
  tourTokens,
  unresolvedTourTokens,
} from "./tourText";

const overlaps: Record<string, number> = { "a|b|eik": 18794, "a|c|eik": 5628 };
const overlapOf = (id: string) => overlaps[id];

describe("tour text tokens", () => {
  it("formats a count the way each language writes it", () => {
    expect(formatCount(18794, "en")).toBe("18,794");
    expect(formatCount(18794, "bg")).toBe("18 794");
    expect(formatCount(628, "bg")).toBe("628");
  });

  it("writes each token as that link's measured overlap, per language", () => {
    expect(
      renderTourText(
        {
          bg: "{{overlap:a|b|eik}} фирми и {{overlap:a|c|eik}} лица",
          en: "{{overlap:a|b|eik}} firms and {{overlap:a|c|eik}} people",
        },
        overlapOf,
      ),
    ).toEqual({
      bg: "18 794 фирми и 5 628 лица",
      en: "18,794 firms and 5,628 people",
    });
  });

  it("names the tokens it cannot resolve, so the build can refuse them", () => {
    const texts = [{ bg: "{{overlap:a|b|eik}}", en: "{{overlap:x|y|eik}}" }];
    expect(tourTokens(texts[0].en)).toEqual(["x|y|eik"]);
    expect(unresolvedTourTokens(texts, overlapOf)).toEqual(["x|y|eik"]);
    // An unresolved token is left visible rather than rendered as a blank or a zero.
    expect(renderTourText(texts[0], overlapOf).en).toBe("{{overlap:x|y|eik}}");
  });
});
