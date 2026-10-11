import { describe, expect, it } from "vitest";
import { isFreshlySeen } from "./isFreshlySeen";

describe("isFreshlySeen", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  it("is true inside the window and false outside it", () => {
    expect(isFreshlySeen("2026-10-12T02:00:00Z", now)).toBe(true);
    expect(isFreshlySeen("2026-10-11T11:00:00Z", now)).toBe(false);
  });
  it("is false for a future stamp, a missing one, and garbage", () => {
    expect(isFreshlySeen("2026-10-13T00:00:00Z", now)).toBe(false);
    expect(isFreshlySeen(undefined, now)).toBe(false);
    expect(isFreshlySeen("not a date", now)).toBe(false);
  });
});
