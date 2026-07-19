import { describe, it, expect } from "vitest";
import { readableText } from "./readableText";

describe("readableText", () => {
  it("uses white text on dark party colours", () => {
    expect(readableText("rgb(237, 28, 36)")).toBe("#fff"); // БСП red
    expect(readableText("#1e3a8a")).toBe("#fff"); // navy
  });
  it("uses black text on light party colours (the contrast fix)", () => {
    expect(readableText("rgb(250, 240, 60)")).toBe("#000"); // bright yellow
    expect(readableText("#e5e5e5")).toBe("#000"); // near-white
  });
  it("defaults to white when the colour is missing or unparseable", () => {
    expect(readableText(null)).toBe("#fff");
    expect(readableText("")).toBe("#fff");
    expect(readableText("rebeccapurple")).toBe("#fff");
  });
});
