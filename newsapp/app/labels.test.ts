import { describe, expect, it } from "vitest";
import { LEANING_META, RUSSIA_META } from "./labels";

describe("analysis label semantics", () => {
  it("keeps a neutral classification distinct from a non-applicable rubric", () => {
    expect(LEANING_META.neutral.label).toBe("Без ясно идеологическо рамкиране");
    expect(LEANING_META.not_applicable.label).toBe("Извън политическата ос");
    expect(RUSSIA_META.neutral.label).toBe(
      "Без ясно изразена позиция към Русия",
    );
    expect(RUSSIA_META.not_applicable.label).toBe("Русия не е спомената");
  });

  it("describes article framing instead of assigning an ideology to an outlet", () => {
    for (const key of [
      "strong_progressive",
      "progressive",
      "conservative",
      "strong_conservative",
    ] as const) {
      expect(LEANING_META[key].label).toContain("рамкиране");
    }
  });
});
