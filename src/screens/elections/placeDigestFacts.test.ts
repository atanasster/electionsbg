// The digest's selectors: what each cell may state, and what it must refuse to state.
//
// ⚠ THE CENTRAL RULE IS THAT ABSENCE IS `undefined`, NEVER ZERO. Every cell here names a real
// place, so "0 seats", "0%" and an empty mayor name are all claims a reader would believe —
// and every one of them is this code failing to find a producer rather than the place having
// no result. A selector that returns a zero is indistinguishable from one that found a zero.

import { describe, expect, it } from "vitest";
import {
  buildPlaceDigest,
  linkDigestCell,
  localDigestCell,
  parliamentaryDigestCell,
} from "./placeDigestFacts";
import {
  PLACE_DIGEST_FIGURE_VIEWS,
  PLACE_DIGEST_LINK_VIEWS,
  PLACE_DIGEST_MIN_CELLS,
  PLACE_DIGEST_ORDER,
  isSplitControl,
} from "@/data/elections/surfaceTypes";
import { localUrl, placeViewUrl } from "@/data/local/placeViews";
import type { PlaceRef } from "@/data/local/placeViews";

const MUNI: PlaceRef = { level: "municipality", obshtina: "PAZ19" };
const CYCLE = "2026_04_19";
const LOCAL = "2023_10_29_mi";

const winner = { partyId: "p_20", pct: 39.84, marginPct: 20.08 };
const local = {
  mayorName: "Петър Николаев Куленски",
  mayorPartyId: "p_6",
  councilLeadPartyId: "p_151",
  councilLeadSeats: 10,
  councilSeatsTotal: 41,
};

describe("routes come from the router, never a template", () => {
  it("uses placeViewUrl / localUrl for every cell", () => {
    // The same rule the generator follows: a hand-built path keeps working until the routing
    // rule moves, and then nothing compares the two.
    expect(
      parliamentaryDigestCell({ place: MUNI, cycle: CYCLE, winner })!.to,
    ).toBe(placeViewUrl("parliamentary", MUNI));
    expect(
      localDigestCell({ place: MUNI, cycle: LOCAL, source: local })!.to,
    ).toBe(localUrl(MUNI, LOCAL));
    expect(linkDigestCell("governance", MUNI)!.to).toBe(
      placeViewUrl("governance", MUNI),
    );
    expect(linkDigestCell("consumption", MUNI)!.to).toBe(
      placeViewUrl("consumption", MUNI),
    );
  });

  it("returns undefined rather than a cell that links nowhere", () => {
    // A place with no obshtina resolves to no route on these views.
    const nowhere: PlaceRef = { level: "municipality" };
    expect(linkDigestCell("governance", nowhere)).toBeUndefined();
    expect(
      parliamentaryDigestCell({ place: nowhere, cycle: CYCLE, winner }),
    ).toBeUndefined();
  });
});

describe("a missing producer yields undefined, not a zero", () => {
  it("drops the parliamentary cell when there is no winner row", () => {
    expect(
      parliamentaryDigestCell({ place: MUNI, cycle: CYCLE }),
    ).toBeUndefined();
  });

  it("drops the local cell when no mayor is named", () => {
    // ⚠ AN EMPTY NAME BESIDE „Кмет" IS A CLAIM THAT THE OFFICE IS VACANT.
    for (const source of [
      undefined,
      {},
      { mayorName: "" },
      { mayorName: null },
    ])
      expect(
        localDigestCell({ place: MUNI, cycle: LOCAL, source }),
        JSON.stringify(source),
      ).toBeUndefined();
  });

  it("never invents a seat count", () => {
    // ⚠ THE MAYOR IS THE CELL AND THE COUNCIL IS A SECOND LINE, so a mayor who IS named keeps
    // the cell while an unreachable council result carries NULL. `?? 0` publishes „0 от 0
    // съветника" about a named municipality — a real number a reader believes, and one this
    // code produced by failing to find a file rather than by counting seats.
    const c = localDigestCell({
      place: MUNI,
      cycle: LOCAL,
      source: { mayorName: "Х" },
    })!;
    expect(c.mayorName).toBe("Х");
    expect(c.councilLeadSeats).toBeNull();
    expect(c.councilSeatsTotal).toBeNull();
    // …and it claims no party it does not have.
    expect(c.councilLeadPartyId).toBeNull();
    expect(c.mayorMatchesCouncil).toBe(false);
  });

  it("keeps a genuine zero distinguishable from an unknown one", () => {
    // The distinction only exists if BOTH are representable: a lead party that really won no
    // seats is 0, and a council we could not read is null. One type for both loses the case.
    const c = localDigestCell({
      place: MUNI,
      cycle: LOCAL,
      source: { ...local, councilLeadSeats: 0, councilSeatsTotal: 41 },
    })!;
    expect(c.councilLeadSeats).toBe(0);
    expect(c.councilSeatsTotal).toBe(41);
  });
});

describe("`mayorMatchesCouncil` is ONE rule, read twice", () => {
  it("agrees with the split-control standout, by construction", () => {
    // ⚠ `PlaceDigestLocalCell`'s own comment: "produced ONCE and read twice — the split-control
    // standout states the same thing, so the two must not be computed separately."
    const cases: [string | null, string | null][] = [
      ["p_6", "p_6"],
      ["p_6", "p_151"],
      ["independent", "p_151"],
      [null, "p_151"],
      ["p_6", null],
    ];
    for (const [m, c] of cases) {
      const cell = localDigestCell({
        place: MUNI,
        cycle: LOCAL,
        source: { ...local, mayorPartyId: m, councilLeadPartyId: c },
      })!;
      const split = isSplitControl(m, c);
      // "matches" is the negation of split ONLY when both parties are known — never both true.
      expect(cell.mayorMatchesCouncil && split, `${m}/${c}`).toBe(false);
      if (m && c && m !== "independent" && c !== "independent")
        expect(cell.mayorMatchesCouncil, `${m}/${c}`).toBe(!split);
    }
  });

  it("claims neither match nor split when a party is unknown", () => {
    // ⚠ THE THIRD STATE. An independent mayor does not "match" the council and does not
    // "differ" from it — publishing either is a claim derived from a missing value.
    const c = localDigestCell({
      place: MUNI,
      cycle: LOCAL,
      source: { ...local, mayorPartyId: "independent" },
    })!;
    expect(c.mayorMatchesCouncil).toBe(false);
    expect(isSplitControl("independent", local.councilLeadPartyId)).toBe(false);
    expect(c.mayorPartyId).toBeNull();
  });
});

describe("the digest as a whole", () => {
  const full = () =>
    buildPlaceDigest({
      place: MUNI,
      parliamentaryCycle: CYCLE,
      localCycle: LOCAL,
      winner,
      local,
    });

  it("renders one cell per reachable view, in PlaceViewNav's order", () => {
    expect(full().map((c) => c.view)).toEqual([...PLACE_DIGEST_ORDER]);
  });

  it("carries a number in exactly the figure views, and none in the links", () => {
    // The split is forced by where each fact lives (§4.1), so the cell KINDS are read from the
    // same constants the renderer uses rather than a second list.
    for (const c of full()) {
      if (c.kind === "figure")
        expect(PLACE_DIGEST_FIGURE_VIEWS, c.view).toContain(c.view);
      else expect(PLACE_DIGEST_LINK_VIEWS, c.view).toContain(c.view);
    }
    // ⚠ NOT "the serialized cell contains no digit" — the ROUTE carries the place code, so
    // `/governance/PAZ19` fails that and every municipality in the country would too. What a
    // link cell must not carry is a QUANTITY: its fields are exactly the link shape, and not
    // one of them is a number. A figure field added to it fails on both halves.
    const link = full().find((c) => c.kind === "link")!;
    expect(Object.keys(link).sort()).toEqual([
      "descriptorKey",
      "kind",
      "to",
      "view",
    ]);
    expect(Object.values(link).some((v) => typeof v === "number")).toBe(false);
  });

  it("drops the cell for the view the reader is already on (§7.1)", () => {
    const cells = buildPlaceDigest({
      place: MUNI,
      parliamentaryCycle: CYCLE,
      localCycle: LOCAL,
      winner,
      local,
      currentView: "parliamentary",
    });
    expect(cells.map((c) => c.view)).not.toContain("parliamentary");
    expect(cells).toHaveLength(3);
  });

  it("renders NOTHING below the two-cell floor", () => {
    // One or two cells in a four-column grid restate the pills directly above them.
    const two = buildPlaceDigest({
      place: MUNI,
      parliamentaryCycle: CYCLE,
      currentView: "governance",
      winner,
    });
    expect(two).toHaveLength(PLACE_DIGEST_MIN_CELLS);

    const one = buildPlaceDigest({
      place: MUNI,
      parliamentaryCycle: CYCLE,
      currentView: "governance",
      winner: undefined,
    });
    // governance dropped as current, parliamentary has no winner, no local cycle → 1 left.
    expect(one).toEqual([]);
  });

  it("gives a polling section no digest at all (§4.1)", () => {
    // Stated rather than left to the floor's arithmetic: governance, consumption and local all
    // stop above the station, so the rule must not depend on the count happening to work out.
    expect(
      buildPlaceDigest({
        place: { level: "section", ekatte: "55155" },
        parliamentaryCycle: CYCLE,
        localCycle: LOCAL,
        winner,
        local,
      }),
    ).toEqual([]);
  });

  it("drops Местни entirely when no local cycle covers the place", () => {
    const cells = buildPlaceDigest({
      place: MUNI,
      parliamentaryCycle: CYCLE,
      winner,
      local,
    });
    expect(cells.map((c) => c.view)).not.toContain("local");
    expect(cells.length).toBeGreaterThanOrEqual(PLACE_DIGEST_MIN_CELLS);
  });

  it("resolves Sofia through the router's own special cases", () => {
    // A hand-built `/local/<cycle>/<obshtina>` gets the city aggregate wrong.
    const sofia: PlaceRef = { level: "municipality", obshtina: "SOF00" };
    const cell = localDigestCell({
      place: sofia,
      cycle: LOCAL,
      source: local,
    })!;
    expect(cell.to).toBe(`/local/${LOCAL}/SOF`);
    expect(cell.to).not.toContain("SOF00");
  });

  it("emits no prose — codes, ids and one candidate name (§5.2, §5.3)", () => {
    // A person's name is the one exception and it is deliberate: it is Bulgarian in both
    // languages because the reader is matching it against a ballot.
    let blob = JSON.stringify(full());
    blob = blob.split(local.mayorName).join("");
    expect(blob).not.toMatch(/[Ѐ-ӿ]/);
  });
});
