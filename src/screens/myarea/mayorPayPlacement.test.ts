import { describe, expect, it } from "vitest";
import { shouldShowMayorPayOnLocalPage } from "./mayorPayPlacement";

describe("shouldShowMayorPayOnLocalPage", () => {
  it("shows current mayor declarations only on the current regular local cycle", () => {
    expect(shouldShowMayorPayOnLocalPage("2023_10_29_mi")).toBe(true);
    expect(shouldShowMayorPayOnLocalPage("2019_10_27_mi")).toBe(false);
    expect(shouldShowMayorPayOnLocalPage("2024_10_20_chmi")).toBe(false);
  });

  it("does not give a Sofia district the city mayor's declaration", () => {
    expect(shouldShowMayorPayOnLocalPage("2023_10_29_mi", true)).toBe(false);
  });
});
