import { describe, expect, it } from "vitest";
import { STORY_GRID } from "./HomeScreen";

describe("home supporting grid mobile contract", () => {
  it("binds the supporting grid to an explicit minmax track", () => {
    expect(STORY_GRID.split(/\s+/)).toContain("news-supporting-grid");
  });
});
