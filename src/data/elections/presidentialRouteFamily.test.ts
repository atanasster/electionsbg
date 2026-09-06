// The claim `presidentialRoutes.ts` makes about the ROUTER, checked against the router.
//
// ⚠ THIS IS THE HALF `presidentialRoutes.test.ts` STRUCTURALLY CANNOT DO. That file compares
// the builder to its own pattern table — self-consistency, and it would go on passing with
// every pattern wrong. The falsifiable claim is „`routes.tsx` declares these six paths", and
// only `routes.tsx` can falsify it.
//
// ⚠ IT READS THE SOURCE RATHER THAN MOUNTING THE ROUTER, deliberately: mounting pulls 288 lazy
// screens and their transitive imports into a unit test, and what is being asserted is a
// DECLARATION, not a render. `scripts/tests/election/surfaces.data.test.ts` already reads the
// same file the same way to resolve every emitted destination.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PRESIDENTIAL_ROUTE_PATTERNS } from "./presidentialRoutes";
import type { ElectionPlaceLevel } from "./surfaceTypes";

const source = (): string =>
  fs.readFileSync(path.join(process.cwd(), "src", "routes.tsx"), "utf8");

/** Every `path="…"` `routes.tsx` declares. */
const declared = (): Set<string> =>
  new Set([...source().matchAll(/path="([^"]+)"/g)].map((m) => m[1]));

const LEVELS = Object.keys(PRESIDENTIAL_ROUTE_PATTERNS) as ElectionPlaceLevel[];

describe("the presidential route family", () => {
  it("declares every level's pattern in routes.tsx", () => {
    const paths = declared();
    for (const level of LEVELS)
      expect(
        paths.has(PRESIDENTIAL_ROUTE_PATTERNS[level]),
        `${level}: routes.tsx declares no path="${PRESIDENTIAL_ROUTE_PATTERNS[level]}"`,
      ).toBe(true);
  });

  it("declares no presidential path the pattern table does not name", () => {
    // ⚠ THE OTHER DIRECTION, AND IT IS THE ONE THAT CATCHES A ROUTE ADDED BY HAND. A
    // `/presidential/:cycle/round/2` added straight to the router would be a URL the producer
    // never emits and no gate ever resolves — and the runoff being a TOGGLE rather than a
    // route is a recorded decision, so a second route for it must fail here rather than ship.
    const table = new Set(Object.values(PRESIDENTIAL_ROUTE_PATTERNS));
    const strays = [...declared()].filter(
      (p) => p.startsWith("presidential") && !table.has(p),
    );
    expect(strays).toEqual([]);
  });

  it("finds presidential paths at all — the control", () => {
    // Without this, both assertions above pass on a `routes.tsx` the regex failed to parse.
    expect(
      [...declared()].filter((p) => p.startsWith("presidential")).length,
    ).toBe(LEVELS.length);
  });
});
