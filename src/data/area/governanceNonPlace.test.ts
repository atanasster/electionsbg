// The list of static `/governance/*` pages is DERIVED from the route table, not
// remembered.
//
// Every page added under `/governance/` competes with the `:id` place node for
// `AREA_PATH_RE`, and losing is silent: the header pill pins the path segment
// as though it were a place, `?area=` starts travelling with it, and the reader
// carries a bogus anchor around the site. `municipal-finance` shipped exactly
// that way. This test is what stops the next one.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GOVERNANCE_NON_PLACE_SEGMENTS, onPlaceNode } from "./areaAnchor";

/** Every STATIC first segment declared under `governance/` in routes.tsx.
 *  `governance/:id` and `governance/region/:oblast` are parameterised, so they
 *  are not static pages and do not belong in the list. */
const declaredStaticSegments = (): string[] => {
  const src = readFileSync(resolve(__dirname, "../../routes.tsx"), "utf8");
  const out = new Set<string>();
  // `\/?` so a leading-slash form (`path="/governance/foo"`) is caught too —
  // the narrower regex would have skipped it in silence, which is the failure
  // mode this whole gate exists to prevent.
  for (const m of src.matchAll(/path="\/?governance\/([^"]+)"/g)) {
    const first = m[1].split("/")[0];
    if (first.startsWith(":")) continue;
    out.add(first);
  }
  return [...out].sort();
};

/** Every `path="…"` attribute mentioning `governance/`, however written. Used
 *  to prove the scan above saw all of them: a form it cannot parse shows up as
 *  a COUNT MISMATCH rather than as a quietly shorter list. */
const rawGovernancePathCount = (): number => {
  const src = readFileSync(resolve(__dirname, "../../routes.tsx"), "utf8");
  return [...src.matchAll(/path="[^"]*governance\/[^"]*"/g)].length;
};

describe("GOVERNANCE_NON_PLACE_SEGMENTS", () => {
  it("covers every static /governance/* page in the route table", () => {
    const missing = declaredStaticSegments().filter(
      (s) => !GOVERNANCE_NON_PLACE_SEGMENTS.includes(s as never),
    );
    expect(
      missing,
      `these /governance pages would be read as PLACES by the header pill: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("parses EVERY governance path in the file, not merely some", () => {
    // The self-check that matters. `found.length > 2` catches total vacuity but
    // not a partial miss — which is the realistic case, and the one where the
    // gate keeps passing while the single new page it exists to catch goes
    // unseen. Counting both ways turns that into a failure.
    const parsed = [
      ...readFileSync(resolve(__dirname, "../../routes.tsx"), "utf8").matchAll(
        /path="\/?governance\/([^"]+)"/g,
      ),
    ].length;
    expect(parsed).toBe(rawGovernancePathCount());
  });

  it("keeps every known page declared FLAT, where the scan can see it", () => {
    // A nested `<Route path="governance">` with children would put each child's
    // segment out of reach of a flat scan — and out of reach of the count check
    // above too, since a child's `path="overview"` contains no „governance/" at
    // all. Rather than parse JSX, assert the literal each known page is
    // declared as: nest them and these strings vanish, which fails here rather
    // than going quiet.
    const src = readFileSync(resolve(__dirname, "../../routes.tsx"), "utf8");
    for (const seg of GOVERNANCE_NON_PLACE_SEGMENTS) {
      if (seg === "region") continue; // parameterised: governance/region/:oblast
      expect(src, seg).toContain(`path="governance/${seg}"`);
    }
  });

  it("finds the routes it claims to scan", () => {
    // Guards the gate itself: a regex that matched nothing would pass the
    // assertion above vacuously for ever.
    const found = declaredStaticSegments();
    expect(found.length).toBeGreaterThan(2);
    expect(found).toContain("municipal-finance");
    expect(found).toContain("sectors");
  });
});

describe("onPlaceNode", () => {
  it("is false for every non-place governance page", () => {
    for (const seg of GOVERNANCE_NON_PLACE_SEGMENTS) {
      expect(onPlaceNode(`/governance/${seg}`), seg).toBe(false);
      expect(onPlaceNode(`/en/governance/${seg}`), `/en ${seg}`).toBe(false);
    }
  });

  it("is true for an actual place code", () => {
    for (const code of ["SOF00", "BLG18", "S2401", "68134"]) {
      expect(onPlaceNode(`/governance/${code}`), code).toBe(true);
      expect(onPlaceNode(`/en/governance/${code}`), `/en ${code}`).toBe(true);
    }
  });

  it("is false for the bare country node", () => {
    expect(onPlaceNode("/governance")).toBe(false);
    expect(onPlaceNode("/en/governance")).toBe(false);
  });

  it("is false for the oblast node, which is a region and not an anchor", () => {
    expect(onPlaceNode("/governance/region/BLG")).toBe(false);
  });

  it("still excludes a non-place page when the path carries a query or hash", () => {
    // The capture group already excludes `?#`; the lookahead's BOUNDARY must too.
    // With a bare `(?:/|$)` it did not, so `/governance/mayor-pay?area=68134` — the
    // very shape this list exists to protect, a reader arriving with a real anchor —
    // was read as the place „mayor-pay" and MASKED it. Neither call site passes a
    // query today, so nothing but this test stands between the list and that.
    for (const seg of GOVERNANCE_NON_PLACE_SEGMENTS) {
      expect(
        onPlaceNode(`/governance/${seg}?area=68134`),
        `${seg} ?query`,
      ).toBe(false);
      expect(onPlaceNode(`/governance/${seg}#top`), `${seg} #hash`).toBe(false);
      expect(
        onPlaceNode(`/en/governance/${seg}?area=68134`),
        `/en ${seg} ?query`,
      ).toBe(false);
    }
    // …and a real place code is still a place with a query attached, so the
    // widened boundary cannot have been satisfied by excluding everything.
    expect(onPlaceNode("/governance/BLG18?area=68134")).toBe(true);
    expect(onPlaceNode("/governance/68134#top")).toBe(true);
  });

  it("keeps every segment regex-inert, since the list is spliced into a RegExp", () => {
    // `escapeRe` makes this safe rather than merely lucky, but the charset is
    // still worth pinning: a segment needing an escape is also a segment whose
    // route path is worth a second look.
    for (const seg of GOVERNANCE_NON_PLACE_SEGMENTS)
      expect(seg, seg).toMatch(/^[a-z0-9-]+$/);
  });

  it("does not match a prefix of a non-place segment", () => {
    // `sectors` must not shield `sectorsomething` — the lookahead is anchored
    // on a segment boundary, and a sloppier one would hide a real place whose
    // code happened to start with a listed word.
    expect(onPlaceNode("/governance/sectorsomething")).toBe(true);
  });
});
