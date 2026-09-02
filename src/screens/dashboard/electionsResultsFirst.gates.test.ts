// Result-surface gates for dashboard-hub SKILL.md §3.0.1.
//
// Election fronts are the documented exception to the ordinary tile hub's “no hero chart”
// rule: their first substantive answer is geography paired with a ranked/list result. This
// source gate pins the two existing country compositions until the shared ElectionOutcomeCanvas
// exists. At that point the permanent gate belongs on the composed component/render, not on
// these legacy source files.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripJsxComments } from "@/ux/infographic/stripJsxComments";
import { sourceSection as section } from "@/ux/infographic/sourceSection";

const read = (path: string): string =>
  stripJsxComments(readFileSync(path, "utf8"));

describe("election country dashboards remain results-first", () => {
  it("keeps the parliamentary map and ranked party result in the first votes section", () => {
    const source = read("src/screens/dashboard/DashboardCards.tsx");
    const votes = section(source, 'id="votes"', 'id="geography"');

    expect(votes).toContain("<RegionsMapTile");
    expect(votes).toContain("<PartyResultsTile");
    expect(source.indexOf('id="votes"')).toBeLessThan(
      source.indexOf('id="geography"'),
    );
  });

  it("keeps separate mayor/council maps with the local regions result table", () => {
    const source = read(
      "src/screens/dashboard/local/LocalCountryDashboardCards.tsx",
    );
    const maps = section(source, 'id="local-maps"', 'id="local-mayors"');

    expect(maps).toMatch(
      /<LocalRegionsControlMapTile\s+cycle=\{cycle\}\s+metric="mayor"/,
    );
    expect(maps).toMatch(
      /<LocalRegionsControlMapTile\s+cycle=\{cycle\}\s+metric="council"/,
    );
    expect(maps).toContain("<LocalRegionsTable");
    expect(source.indexOf('id="local-mayors"')).toBeLessThan(
      source.indexOf('id="local-councils"'),
    );
  });
});
