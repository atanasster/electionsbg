// The bidirectional local↔parliamentary URL builders.
//
// The country case is pinned by name because it MOVED: the parliamentary country result was
// `/` until the global home dashboard took the root, and four separate call sites encoded
// that. A builder that silently reverts to `/` would send every "see the parliamentary
// result" link to the home page — a working link to the wrong page, which no route test
// catches.

import { describe, expect, it } from "vitest";
import {
  localUrlForParliamentary,
  parliamentaryUrlForLocal,
} from "./crossElectionLink";

describe("parliamentaryUrlForLocal", () => {
  it("sends the country to /parliamentary, never to /", () => {
    expect(parliamentaryUrlForLocal({ level: "country" })).toBe(
      "/parliamentary",
    );
  });

  it("falls back to /parliamentary when the code is missing, at every level", () => {
    // These three fall back on absent input. They were `/` too, so each is the same
    // regression in a rarer branch — a place whose code failed to resolve would land on the
    // home page rather than on the national result it was standing in for.
    expect(parliamentaryUrlForLocal({ level: "region" })).toBe(
      "/parliamentary",
    );
    expect(parliamentaryUrlForLocal({ level: "municipality" })).toBe(
      "/parliamentary",
    );
    expect(parliamentaryUrlForLocal({ level: "settlement" })).toBe(
      "/parliamentary",
    );
  });

  it("never returns a bare / for any level", () => {
    // The sweep behind the three cases above: whatever the level, the root is not an
    // election destination any more.
    const levels = [
      "country",
      "sofia",
      "region",
      "municipality",
      "settlement",
    ] as const;
    for (const level of levels) {
      expect(parliamentaryUrlForLocal({ level }), level).not.toBe("/");
    }
  });

  it("keeps the deep-route scheme unchanged", () => {
    // Only the country case moved. If a refactor swept the others along, these fail.
    expect(parliamentaryUrlForLocal({ level: "region", oblast: "BLG" })).toBe(
      "/municipality/BLG",
    );
    expect(
      parliamentaryUrlForLocal({
        level: "municipality",
        obshtinaCode: "BLG03",
      }),
    ).toBe("/settlement/BLG03");
    expect(
      parliamentaryUrlForLocal({ level: "settlement", ekatte: "04279" }),
    ).toBe("/sections/04279");
  });

  it("routes Sofia's city and rayon shards to /sofia", () => {
    // Sofia has no 1:1 parliamentary município page — one local SOF against three МИР.
    expect(parliamentaryUrlForLocal({ level: "sofia" })).toBe("/sofia");
    expect(
      parliamentaryUrlForLocal({ level: "municipality", obshtinaCode: "SOF" }),
    ).toBe("/sofia");
    expect(
      parliamentaryUrlForLocal({
        level: "municipality",
        obshtinaCode: "S2301",
      }),
    ).toBe("/sofia");
  });
});

describe("localUrlForParliamentary", () => {
  it("is unaffected by the parliamentary country move", () => {
    // The other direction targets `/local/**`, which this plan does not touch. Asserted so
    // a future edit to its twin above cannot quietly follow through to here.
    expect(
      localUrlForParliamentary({ level: "country", cycle: "2023_10_29_mi" }),
    ).toContain("/local/");
  });
});
