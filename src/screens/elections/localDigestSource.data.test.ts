// @vitest-environment node
//
// §Phase 5 item 4b — the gate the plan calls the worst failure in the phase.
//
// ⚠ A DIGEST NAMING ONE MAYOR WHILE THE TAB ONE CLICK AWAY NAMES ANOTHER is wrong about a named
// individual, renders at a 200, and no row count moves. So this runs over the PUBLISHED local
// municipality corpus and checks that what the digest cell would state is what the Местни tab's
// own producer says — every município, not a fixture.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { localDigestCell, localDigestFromSurface } from "./placeDigestFacts";
import { isSplitControl } from "@/data/elections/surfaceTypes";
import type { ElectionSurfaceV1 } from "@/data/elections/surfaceTypes";

const CYCLE = "2023_10_29_mi";
const DIR = path.join(process.cwd(), "data", CYCLE, "surface", "municipality");
const has = fs.existsSync(DIR);
const surfaces = (): ElectionSurfaceV1[] =>
  fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map(
      (f) =>
        JSON.parse(
          fs.readFileSync(path.join(DIR, f), "utf8"),
        ) as ElectionSurfaceV1,
    );

describe("the Местни cell re-derives from the producer the tab renders", () => {
  it("picks the ELECTED row, not the first one", () => {
    // ⚠ FIXTURE-INDEPENDENT ON PURPOSE, and the corpus is why. A runoff municipality's surface
    // emits only the DECISIVE round, so its leader IS the winner and `preview[0]` coincides with
    // the elected row on all 289 — which means the published corpus cannot tell the two rules
    // apart, and a probe that swaps `find(isElected)` for `[0]` leaves every corpus arm green.
    // The input below puts the winner second, which no published artifact does.
    const s = {
      kind: "local",
      place: { level: "municipality", id: "TEST" },
      ballots: [
        {
          kind: "municipality_mayor",
          preview: [
            { partyId: "p_1", candidateName: "Първи", votes: 9, pct: 45 },
            {
              partyId: "p_2",
              candidateName: "Избраният",
              votes: 8,
              pct: 40,
              isElected: true,
            },
          ],
        },
      ],
    } as unknown as ElectionSurfaceV1;
    const src = localDigestFromSurface(s);
    expect(src?.mayorName).toBe("Избраният");
    expect(src?.mayorPartyId).toBe("p_2");
  });

  it("states NO council rather than a council of zero", () => {
    // ⚠ ALSO FIXTURE-INDEPENDENT: every published município carries a council ballot, so the
    // corpus cannot tell `?? null` from `?? 0` either — and „0 от 0 съветника" beside a named
    // município is a claim a reader believes.
    const s = {
      kind: "local",
      place: { level: "municipality", id: "TEST" },
      ballots: [
        {
          kind: "municipality_mayor",
          preview: [
            {
              partyId: "p_1",
              candidateName: "Кметът",
              votes: 9,
              pct: 60,
              isElected: true,
            },
          ],
        },
      ],
    } as unknown as ElectionSurfaceV1;
    const src = localDigestFromSurface(s);
    expect(src?.mayorName).toBe("Кметът");
    expect(src?.councilLeadSeats).toBeNull();
    expect(src?.councilSeatsTotal).toBeNull();
    expect(src?.councilLeadPartyId).toBeNull();
  });

  it.runIf(has)(
    "agrees with the corpus on every município's elected mayor",
    () => {
      let checked = 0;
      for (const s of surfaces()) {
        const mayor = s.ballots.find((b) => b.kind === "municipality_mayor");
        const elected = mayor?.preview.find((e) => e.isElected);
        const src = localDigestFromSurface(s);
        if (!elected) {
          expect(src?.mayorName, s.place.id).toBeFalsy();
          continue;
        }
        checked++;
        expect(src?.mayorName, s.place.id).toBe(elected.candidateName);
        expect(src?.mayorPartyId, s.place.id).toBe(elected.partyId ?? null);
      }
      // Non-vacuity: „every artifact with no elected row yields no name" is satisfied by a corpus
      // in which none has one.
      expect(checked).toBeGreaterThan(200);
    },
  );

  it.runIf(has)(
    "takes the council lead and total from the council ballot itself",
    () => {
      for (const s of surfaces()) {
        const council = s.ballots.find((b) => b.kind === "municipal_council");
        const src = localDigestFromSurface(s);
        expect(src?.councilLeadPartyId, s.place.id).toBe(
          council?.preview[0]?.partyId ?? null,
        );
        expect(src?.councilSeatsTotal, s.place.id).toBe(
          council?.seatsTotal ?? null,
        );
        // ⚠ NULL, NEVER 0, for an absent council — „0 от 0 съветника" is a claim a reader believes.
        if (!council) expect(src?.councilLeadSeats, s.place.id).toBeNull();
      }
    },
  );

  it.runIf(has)(
    "agrees with the surface's OWN split_control fact, everywhere",
    () => {
      // ⚠ ITEM 4: PRODUCED ONCE, READ TWICE. The surface states split control as a FACT and the
      // digest states it in one line; if the two could disagree, one page would say the mayor and
      // the council match while the strip above it said they differ.
      let split = 0;
      for (const s of surfaces()) {
        const cell = localDigestCell({
          place: { level: "municipality", obshtina: s.place.id },
          cycle: CYCLE,
          source: localDigestFromSurface(s),
        });
        const fact = s.facts.some((f) => f.code === "split_control");
        if (!cell) continue;
        const differs = isSplitControl(
          cell.mayorPartyId,
          cell.councilLeadPartyId,
        );
        if (fact) split++;
        expect(differs, `${s.place.id}: digest and fact disagree`).toBe(fact);
        // …and "matches" is never true at the same time.
        expect(cell.mayorMatchesCouncil && differs, s.place.id).toBe(false);
      }
      // Non-vacuity: the agreement is worthless if no município is split.
      expect(split).toBeGreaterThan(10);
    },
  );

  it.runIf(has)("refuses a parliamentary surface outright", () => {
    // The cell is about the LOCAL result. Handed the wrong kind it must produce nothing rather
    // than read a mayor out of a party list that has none.
    const parl = { ...surfaces()[0], kind: "parliamentary" as const };
    expect(localDigestFromSurface(parl)).toBeUndefined();
  });
});
