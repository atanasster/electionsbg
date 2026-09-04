// The result surface is not a hub, and the deep content is not tiles (§Phase 7 item 5).
//
// ⚠ THE PRESSURE IS REAL AND ONE-DIRECTIONAL. This repo has a well-made tile-hub kit —
// `HubHead`, `TileHubGrid`, `InfographicTile`, `SceneFrame` — and `/elections` uses it correctly,
// because a hub's job IS to route a reader onward. A result surface's job is the opposite: it
// answers the question the reader already asked. Reaching for the same kit on a result page is
// the single most natural edit anyone will make here, it looks like consistency, and it turns
// "who won" into a grid of doors.
//
// ⚠ AND THE CONVERSE MATTERS AS MUCH. §Phase 7 item 5 is two clauses — "keep `DashboardSection`
// for deep content" is the half that stops the shell absorbing the whole page. A screen that
// dropped its sections would pass any "no hub kit" check while having quietly moved everything
// into the surface, which is the outcome item 5 forbids in the other direction.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "@/../scripts/lib/strip_comments";

const read = (p: string) =>
  stripComments(fs.readFileSync(path.join(process.cwd(), p), "utf8"));

/** The tile-hub kit. Named individually rather than as "anything from @/ux/infographic" because
 *  that barrel also exports the drawing primitives a scene uses, and a result surface has every
 *  right to draw. */
const HUB_KIT = ["HubHead", "TileHubGrid", "InfographicTile", "TileHubSection"];

const SURFACE_MODULES = [
  "src/screens/elections/ElectionResultsShell.tsx",
  "src/screens/elections/ElectionSurfaceBoundary.tsx",
  "src/screens/elections/ElectionSurfaceSkeleton.tsx",
];

const PLACE_SCREENS = [
  "src/screens/dashboard/DashboardCards.tsx",
  "src/screens/dashboard/RegionDashboardCards.tsx",
  "src/screens/dashboard/MunicipalityDashboardCards.tsx",
  "src/screens/dashboard/SettlementDashboardCards.tsx",
  "src/screens/dashboard/SectionDashboardCards.tsx",
];

describe("the result surface is not a tile hub", () => {
  it("names none of the hub kit", () => {
    for (const m of SURFACE_MODULES) {
      const src = read(m);
      for (const kit of HUB_KIT)
        expect(src, `${m} reaches for ${kit}`).not.toMatch(
          new RegExp(`\\b${kit}\\b`),
        );
    }
  });

  it("…while the hub screen still does — the kit is not banned, it is placed", () => {
    // ⚠ THE ANCHOR. Without it the test above passes on a repo that deleted the kit entirely,
    // or renamed it, and would keep passing while the rule it encodes stopped existing.
    const hub = read("src/screens/elections/ElectionsHubScreen.tsx");
    expect(hub).toMatch(/\bHubHead\b/);
    expect(hub).toMatch(/\bTileHubGrid\b/);
  });
});

describe("deep content stays in DashboardSection", () => {
  it("every place screen still renders sections below the surface", () => {
    // The other half of item 5: the surface answers the question, the sections hold the depth.
    // A screen that moved its depth INTO the surface would satisfy the hub check above.
    for (const m of PLACE_SCREENS) {
      const src = read(m);
      expect(src, `${m} renders no DashboardSection`).toMatch(
        /<DashboardSection\b/,
      );
    }
  });

  it("the surface shell renders none of its own", () => {
    // ⚠ THE BOUNDARY IS A BOUNDARY IN BOTH DIRECTIONS. The shell drawing a `DashboardSection`
    // would make the surface and the deep content one thing again, which is what the split
    // exists to prevent — and it would put a second h2 hierarchy inside the surface's own.
    expect(read("src/screens/elections/ElectionResultsShell.tsx")).not.toMatch(
      /<DashboardSection\b/,
    );
  });
});
