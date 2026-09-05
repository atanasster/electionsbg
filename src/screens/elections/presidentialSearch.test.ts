// The presidential group in the `/elections` search box.
//
// ⚠ THE SOURCE IS WITHHELD, and that is the assertion this file exists for. A result that
// navigates to a route which does not exist is worse than a query that finds nothing: the
// reader has been TOLD the page is there. „No presidential group" and „nobody built one"
// look identical in a rendered dropdown, so the withholding is pinned rather than assumed.

import { describe, expect, it } from "vitest";
import catalogue from "@/data/json/presidential_elections.json";
import { KINDS_WITHOUT_SURFACE } from "./electionsHubCycle";
import {
  electionsHubSources,
  presidentialSearchSource,
} from "./electionsSearch";
import { searchIndex } from "@/lib/entitySearchIndex";
import type { IndexSource } from "@/ux/search/hubSearchSources";

const LABEL = { bg: "Президентски избори", en: "Presidential elections" };

describe("presidentialSearchSource", () => {
  it("is withheld while the kind has no surface", () => {
    expect(presidentialSearchSource(LABEL)).toBeNull();
    // ⚠ NON-VACUITY: the kind really is withheld right now, and the two kinds with routes
    // are not — so this suite cannot pass on a list that has silently emptied.
    expect(KINDS_WITHOUT_SURFACE).toContain("presidential");
    expect(KINDS_WITHOUT_SURFACE).not.toContain("local");
  });

  it("reads the REAL withheld list by default, not a copy of it", () => {
    // ⚠ The seam is what makes the index testable, and it is also where a hardcoded default
    // would hide: `presidentialSearchSource(LABEL)` must consult the same constant the hub,
    // the header and the tile registry do, or the group appears — or fails to — on its own
    // schedule. Both directions, driven from that constant.
    expect(presidentialSearchSource(LABEL, KINDS_WITHOUT_SURFACE)).toBeNull();
    expect(
      presidentialSearchSource(
        LABEL,
        KINDS_WITHOUT_SURFACE.filter((k) => k !== "presidential"),
      ),
    ).not.toBeNull();
  });

  it("is APPENDED to the hub's sources once servable, and absent until then", () => {
    // ⚠ THE COMPOSITION, not just the source. As a `useMemo` in the component this was
    // unreachable by any gate: a dropped memo would leave the group silently absent the day
    // its route lands, with every test still green.
    const labels = {
      inScope: { bg: "a", en: "a" },
      outScope: { bg: "b", en: "b" },
      presidential: LABEL,
    };
    const cycle = { kind: "parliamentary" as const, id: "2026_04_19" };
    const withheldNow = electionsHubSources(null, cycle, labels).map(
      (s) => s.id,
    );
    expect(withheldNow).not.toContain("election-presidential");
    const servable = electionsHubSources(null, cycle, labels, []).map(
      (s) => s.id,
    );
    // Places FIRST — the finder is a place box that also knows the cycles, not the reverse.
    expect(servable.at(-1)).toBe("election-presidential");
    expect(servable.slice(0, -1)).toEqual(withheldNow);
  });

  it("finds every cycle by year, by president and by vice-president", () => {
    // ⚠ THE SEAM. The source is withheld today, so without a way to build it as it WILL be
    // built the whole index — every href, every search key — ships untested and the first
    // person to see it is a reader.
    const src = presidentialSearchSource(LABEL, []) as IndexSource;
    expect(src.kind).toBe("index");
    expect(src.id).toBe("election-presidential");
    expect(src.index!.rows).toHaveLength(catalogue.length);

    const hit = (q: string) => searchIndex(src.index, q, 10);
    // By year…
    expect(hit("2016").map((r) => r.href)).toEqual([
      "/presidential/2016_11_06_pvr",
    ]);
    // …by the president's FAMILY name, which is the natural query for this corpus and only
    // reaches the prefix tier because the name parts are separate keys — twice for
    // Първанов, who won both 2001 and 2006…
    expect(hit("Плевнелиев").map((r) => r.href)).toEqual([
      "/presidential/2011_10_23_pvr",
    ]);
    expect(
      hit("Първанов")
        .map((r) => r.href)
        .sort(),
    ).toEqual(["/presidential/2001_11_11_pvr", "/presidential/2006_10_22_pvr"]);
    // …and by the VICE-president, because a ticket is a pair: a reader looking for Йотова is
    // looking for somebody who stood and won.
    expect(
      hit("Йотова")
        .map((r) => r.href)
        .sort(),
    ).toEqual(["/presidential/2016_11_06_pvr", "/presidential/2021_11_14_pvr"]);
    // A Latin-keyboard reader finds them too — the index's own transliteration. BOTH of
    // Радев's cycles, so a fold that reached only one of them cannot pass.
    expect(
      hit("Radev")
        .map((r) => r.href)
        .sort(),
    ).toEqual(["/presidential/2016_11_06_pvr", "/presidential/2021_11_14_pvr"]);
  });

  it("labels a row with the year, never with the folder id", () => {
    // „2021_11_14_pvr" is a key. This module's siblings learned the same lesson on `_mi`.
    const src = presidentialSearchSource(LABEL, []) as IndexSource;
    for (const row of src.index!.rows) {
      expect(row.label, row.href).not.toContain("_pvr");
      expect(row.label, row.href).toMatch(/^\d{4} — /);
      // ⚠ Every row lands on the PRESIDENTIAL surface. A `_pvr` id routed through the
      // parliamentary builder resolves to `/elections/2021_11_14_pvr`, a 404 — the same
      // implicit-`else` trap the hub and the header each had.
      expect(row.href).toMatch(/^\/presidential\/\d{4}_\d{2}_\d{2}_pvr$/);
      expect(row.href).not.toContain("/elections/");
    }
    expect(new Set(src.index!.rows.map((r) => r.href)).size).toBe(
      catalogue.length,
    );
  });

  it("orders newest first, like every other cycle list on this hub", () => {
    const src = presidentialSearchSource(LABEL, []) as IndexSource;
    expect(src.index!.rows[0].href).toBe("/presidential/2021_11_14_pvr");
    expect(src.index!.rows.at(-1)!.href).toBe("/presidential/2001_11_11_pvr");
  });
});
