import { describe, it, expect } from "vitest";
import { parseLoc } from "./geo";

describe("parseLoc", () => {
  it("parses a well-formed 'lon,lat' string into {lat, lon}", () => {
    expect(parseLoc("27.910543,43.204665")).toEqual({
      lat: 43.204665,
      lon: 27.910543,
    });
  });

  it("returns null for null/empty input", () => {
    expect(parseLoc()).toBeNull();
    expect(parseLoc(null)).toBeNull();
    expect(parseLoc("")).toBeNull();
  });

  it("returns null for a missing segment (must NOT parse '' as 0)", () => {
    // The whole reason for the empty-segment guard: Number("") === 0 would place a bogus
    // centroid at the equator/prime meridian.
    expect(parseLoc(",43")).toBeNull();
    expect(parseLoc("27,")).toBeNull();
  });

  it("returns null for non-numeric coordinates", () => {
    expect(parseLoc("abc,def")).toBeNull();
  });
});
