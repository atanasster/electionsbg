// The one property this module exists to guarantee: a person's name never reaches Google.
//
// ⚠ THE RISK IS SPECIFIC AND CLOSE. These surfaces carry Bulgarian personal names BY DESIGN —
// §5.3 keeps a mayor's and a candidate's name untransliterated in both languages so a reader can
// match it against a ballot — and `PlaceDigestLocalCell.mayorName` and
// `ElectionRankedEntry.candidateName` sit one property away from every call site. Rendering a
// name to the reader who asked for the page and shipping it to an analytics vendor are different
// acts, and only the first is one this project decided to take.
//
// So the guarantee is STRUCTURAL rather than a review habit: the payload has no free-text field,
// and these tests fail if one appears.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "@/../scripts/lib/strip_comments";
import {
  SURFACE_EVENT,
  SURFACE_EVENT_KEYS,
  trackSurfaceLink,
} from "./electionSurfaceAnalytics";

const gtag = vi.fn();
beforeEach(() => {
  gtag.mockClear();
  vi.stubGlobal("window", { ...globalThis.window, gtag });
});
afterEach(() => vi.unstubAllGlobals());

const sent = () => gtag.mock.calls.at(-1)!;

describe("what is sent", () => {
  it("emits ONE event name, with the affordance as a parameter", () => {
    // Five event names would make "which way out of a result surface do readers take" a
    // comparison across five counters instead of a breakdown of one.
    trackSurfaceLink({
      target: "digest",
      kind: "parliamentary",
      level: "region",
      placeId: "BGS",
      view: "local",
    });
    const [cmd, name, params] = sent();
    expect(cmd).toBe("event");
    expect(name).toBe(SURFACE_EVENT);
    expect(params.target).toBe("digest");
  });

  it("sends only keys on the declared allowlist", () => {
    // ⚠ THE ALLOWLIST IS READ FROM THE MODULE, not restated here — otherwise the test and the
    // code are two lists that drift, and the drift is what a leak would ride in on.
    for (const e of [
      {
        target: "digest",
        kind: "local",
        level: "municipality",
        placeId: "PAZ19",
        view: "parliamentary",
      },
      {
        target: "standout_evidence",
        kind: "parliamentary",
        level: "settlement",
        placeId: "55155",
        signal: "turnout_outlier",
      },
      {
        target: "complete_result",
        kind: "parliamentary",
        level: "section",
        placeId: "010100001",
      },
      {
        target: "finder",
        kind: "parliamentary",
        level: "country",
        placeId: "BG",
      },
    ] as const) {
      trackSurfaceLink(e);
      const keys = Object.keys(sent()[2]);
      expect(
        keys.filter((k) => !SURFACE_EVENT_KEYS.includes(k as never)),
        `${e.target} sent an undeclared key`,
      ).toEqual([]);
    }
  });

  it("omits an absent optional rather than sending an empty one", () => {
    // `view: undefined` still serialises as a key. A blank dimension in a report reads as a
    // category, which is worse than no dimension.
    trackSurfaceLink({
      target: "complete_result",
      kind: "parliamentary",
      level: "section",
      placeId: "010100001",
    });
    expect(Object.keys(sent()[2])).toEqual([
      "target",
      "kind",
      "level",
      "place_id",
    ]);
  });

  it("is a no-op when gtag is absent", () => {
    // The seam already guarantees this; asserted because these pages are the busiest on the
    // site and a throw here would take the click with it.
    vi.stubGlobal("window", {});
    expect(() =>
      trackSurfaceLink({
        target: "digest",
        kind: "parliamentary",
        level: "country",
        placeId: "BG",
      }),
    ).not.toThrow();
  });
});

describe("no free-text field can carry a name", () => {
  const src = stripComments(
    fs.readFileSync(
      path.join(
        process.cwd(),
        "src/screens/elections/electionSurfaceAnalytics.ts",
      ),
      "utf8",
    ),
  );

  it("declares no `string` payload field beyond the id and the two enums", () => {
    // ⚠ A SOURCE SCAN, because the leak is a shape the type system would happily accept: adding
    // `detail?: string` compiles, passes every test above, and lets the first caller who wants
    // "a bit more context" send `cell.mayorName`. The fields that ARE strings are a place code
    // (already in the URL) and two enum-ish values.
    const declared = [...src.matchAll(/^\s*(\w+)\??:\s*string;/gm)].map(
      (m) => m[1],
    );
    expect(declared.sort()).toEqual(["placeId", "signal"]);
  });

  it("names none of the surface's name-bearing fields", () => {
    for (const forbidden of [
      "candidateName",
      "mayorName",
      "localPartyName",
      "label",
    ])
      expect(src, forbidden).not.toContain(forbidden);
  });
});

describe("every link on the surface is instrumented", () => {
  const shell = stripComments(
    fs.readFileSync(
      path.join(
        process.cwd(),
        "src/screens/elections/ElectionResultsShell.tsx",
      ),
      "utf8",
    ),
  );

  it("routes every anchor through the helper", () => {
    // ⚠ COUNTED, NOT SPOT-CHECKED. A new destination added to the shell is the single most
    // likely edit here, and an uninstrumented one is invisible: the link works, the page looks
    // right, and the measurement the phase exists for quietly under-counts.
    const anchors = shell.match(/<a\b/g)?.length ?? 0;
    const tracked = shell.match(/trackSurfaceLink\(\{/g)?.length ?? 0;
    expect(anchors).toBeGreaterThan(0);
    expect(tracked, `${anchors} anchors, ${tracked} instrumented`).toBe(
      anchors,
    );
  });
});
