// Gates for the presidential route family's ONE builder.
//
// What this file can check today is that the builder and the patterns it publishes describe the
// same URLs, and that a missing id refuses rather than emitting a trailing-slash path. That the
// PATTERNS are the ones `routes.tsx` actually declares is a separate gate, in
// `presidentialRouteFamily.test.ts`, because the router is where that claim can be falsified.

import { describe, it, expect } from "vitest";
import {
  PRESIDENTIAL_ROUTE_PATTERNS,
  presidentialUrl,
} from "./presidentialRoutes";

import type { ElectionPlaceLevel } from "./surfaceTypes";

const CYCLE = "2021_11_14_pvr";

/** Every level, derived from the pattern table rather than restated — so a seventh level joins
 *  every assertion below the day it is added, which is the property a hand-written list loses. */
const LEVELS = Object.keys(PRESIDENTIAL_ROUTE_PATTERNS) as ElectionPlaceLevel[];

/** The level-generic door the OVERLOADS deliberately do not provide.
 *
 *  ⚠ IT EXISTS ONLY HERE. Production callers name their level, so `country`/`abroad` cannot be
 *  handed an id and the four place levels cannot omit one — that is the whole point of the
 *  overloads, and a generic export would give every caller the swallow back. A gate that
 *  iterates the levels needs a way in, and this switch is it: explicit, in test code, and
 *  exhaustive, so a seventh level fails to compile here too. */
const urlFor = (
  cycle: string,
  level: ElectionPlaceLevel,
  id?: string,
): string | null => {
  switch (level) {
    case "country":
    case "abroad":
      return presidentialUrl(cycle, level);
    default:
      return presidentialUrl(cycle, level, id);
  }
};

/** A route pattern → a regex, `:param` standing for one non-empty path segment.
 *
 *  ⚠ THE LITERAL PARTS ARE ESCAPED FIRST. Unescaped, a pattern carrying a `.` or a `+` would
 *  quietly widen the matcher and this file's central assertion would start passing for URLs it
 *  should reject — a gate going vacuous with nothing red. No pattern carries one today, which
 *  is exactly why it would not be noticed. */
const matcher = (pattern: string): RegExp =>
  new RegExp(
    `^/${pattern
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/:[A-Za-z]+/g, "[^/]+")}$`,
  );

describe("presidentialUrl", () => {
  it("emits a URL for every place level, and each matches that level's pattern", () => {
    for (const level of LEVELS) {
      const url = urlFor(CYCLE, level, "X1");
      expect(url, `no URL for ${level}`).not.toBeNull();
      expect(
        matcher(PRESIDENTIAL_ROUTE_PATTERNS[level]).test(url!),
        `${level}: ${url} does not match ${PRESIDENTIAL_ROUTE_PATTERNS[level]}`,
      ).toBe(true);
    }
  });

  it("gives every level a pattern no OTHER level's URL matches", () => {
    // ⚠ DISTINCT STRINGS ARE NOT DISTINCT MATCHERS, and the difference is the whole risk here.
    // `presidential/:cycle/region/:oblast` and `presidential/:cycle/:kind/:id` are two strings
    // and one match set — a municipality URL would satisfy both, which is how one page ends up
    // serving another level's ids. Comparing the SETS is what catches that.
    for (const a of LEVELS) {
      const url = urlFor(CYCLE, a, "X1")!;
      for (const b of LEVELS) {
        if (a === b) continue;
        expect(
          matcher(PRESIDENTIAL_ROUTE_PATTERNS[b]).test(url),
          `${b}'s pattern matches ${a}'s URL ${url}`,
        ).toBe(false);
      }
    }
  });

  it("refuses a level that needs an id and has none, rather than emitting a trailing slash", () => {
    // ⚠ THE REFUSAL IS THE POINT. `/presidential/<cycle>/region/` matches no route, renders the
    // SPA 404 and looks exactly like a working link in the payload.
    for (const level of [
      "region",
      "municipality",
      "settlement",
      "section",
    ] as const) {
      expect(urlFor(CYCLE, level), `${level} with no id`).toBeNull();
      expect(urlFor(CYCLE, level, ""), `${level} with an empty id`).toBeNull();
    }
  });

  it("country and abroad need no id — and abroad ignores one rather than appending it", () => {
    expect(presidentialUrl(CYCLE, "country")).toBe(`/presidential/${CYCLE}`);
    expect(presidentialUrl(CYCLE, "abroad")).toBe(
      `/presidential/${CYCLE}/abroad`,
    );
    // ⚠ AN ID AT `abroad` NO LONGER COMPILES — `presidentialUrl(cycle, "abroad", "DEU")` is a
    // type error since the overloads landed, which is what turned the producer's 302 silent
    // swallows into something the compiler could point at. Through the generic door it is
    // still ignored, and this pins that it is ignored rather than appended.
    expect(urlFor(CYCLE, "abroad", "DEU")).toBe(
      `/presidential/${CYCLE}/abroad`,
    );
  });

  it("refuses an empty cycle at every level", () => {
    // A cycle-less URL is `/presidential//region/BLG`, which no router serves.
    for (const level of LEVELS) {
      expect(urlFor("", level, "X1"), level).toBeNull();
    }
  });
});
