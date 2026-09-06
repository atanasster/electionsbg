// The presidential group in the `/elections` search box.
//
// ⚠ THE SOURCE IS LIVE SINCE T5, and the RULE it was withheld under is what this file now
// pins. A result that navigates to a route which does not exist is worse than a query that
// finds nothing — the reader has been TOLD the page is there — so the source consults
// `KINDS_WITHOUT_SURFACE` rather than a constant, and both directions of that are asserted:
// an empty list produces the group, a list naming the kind still refuses it. The second arm
// is what keeps the withholding mechanism honest now that nothing is withheld.

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
  it("is produced now that the kind has a surface", () => {
    expect(presidentialSearchSource(LABEL)).not.toBeNull();
    // ⚠ THE DEFAULT IS THE REAL LIST, and it is empty — so this is only meaningful beside the
    // refusal arm below, which proves the group is produced BECAUSE nothing withholds it
    // rather than because the check was removed.
    expect(KINDS_WITHOUT_SURFACE).toEqual([]);
  });

  it("still refuses when a kind IS withheld — the mechanism, not the current state", () => {
    // ⚠ THIS IS THE ONE THAT CANNOT GO VACUOUS. With the list empty, „produces the group" is
    // satisfied by deleting the check; feeding the withheld list back in is what proves the
    // check is there. It is also the shape a fourth kind arrives in.
    expect(presidentialSearchSource(LABEL, ["presidential"])).toBeNull();
  });

  it("reads the REAL withheld list by default, not a copy of it", () => {
    // ⚠ The seam is what makes the index testable, and it is also where a hardcoded default
    // would hide: `presidentialSearchSource(LABEL)` must consult the same constant the hub,
    // the header and the tile registry do, or the group appears — or fails to — on its own
    // schedule. Both directions, driven from that constant.
    // The list is empty today, so passing it EXPLICITLY must give the same answer as passing
    // nothing — that equality is what says the default is the constant rather than a copy.
    expect(
      presidentialSearchSource(LABEL, KINDS_WITHOUT_SURFACE),
    ).not.toBeNull();
    expect(
      presidentialSearchSource(LABEL, [
        ...KINDS_WITHOUT_SURFACE,
        "presidential",
      ]),
    ).toBeNull();
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
    const servable = electionsHubSources(null, cycle, labels).map((s) => s.id);
    // Places FIRST — the finder is a place box that also knows the cycles, not the reverse.
    expect(servable.at(-1)).toBe("election-presidential");
    // …and the withheld composition still drops it, so the append is conditional rather than
    // unconditional — the one difference a passing suite could otherwise not see.
    const withheld = electionsHubSources(null, cycle, labels, [
      "presidential",
    ]).map((s) => s.id);
    expect(withheld).not.toContain("election-presidential");
    expect(servable.slice(0, -1)).toEqual(withheld);
  });

  it("finds every cycle by year, by president and by vice-president", () => {
    // ⚠ THE SEAM, kept explicit even though the default now produces the source: it is what
    // let the whole index — every href, every search key — be tested while the group was
    // withheld, and it is how the next withheld kind gets the same treatment.
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
