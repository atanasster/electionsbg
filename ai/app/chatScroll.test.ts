import { describe, expect, it } from "vitest";
import { shouldFollowChat } from "./chatScroll";

describe("chat following during navigation", () => {
  it("keeps a cleared pin off during upward smooth-scroll frames inside bottom slack", () => {
    expect(shouldFollowChat(false, 1000, 995, 5)).toBe(false);
    expect(shouldFollowChat(false, 995, 980, 20)).toBe(false);
    expect(shouldFollowChat(false, 980, 980, 20)).toBe(false);
  });
  it("resumes following when the reader scrolls down near the bottom", () => {
    expect(shouldFollowChat(false, 900, 950, 50)).toBe(true);
    expect(shouldFollowChat(false, 500, 600, 400)).toBe(false);
    expect(shouldFollowChat(true, 1000, 1020, 0)).toBe(true);
    expect(shouldFollowChat(true, 1000, 800, 200)).toBe(false);
  });
});
