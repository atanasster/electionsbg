// The place digest's per-view selectors (§4.1, Phase 2 item 3b).
//
// A place has FOUR views and this plan covers two of them. The digest is what stops that being a
// dead end: on `/settlement/PDV22` a reader is shown the largest gain, the largest fall, turnout
// and the paper/machine split, and cannot learn who the mayor is without already knowing the
// Местни pill exists — which makes the plan's own validation task 2 answerable only by a reader
// who found the right tab.
//
// ⚠ EACH SELECTOR READS THE PRODUCER THAT DRAWS ITS OWN VIEW'S NUMBERS, and returns `undefined`
// — never a zero — for a view it cannot reach. A zero here is a claim: "0 seats", "0%", "no
// mayor" are all things a reader would believe about a named place, and all of them would be
// this code failing to find a file rather than the place having no result.
//
// ⚠ TWO CELLS CARRY A NUMBER AND TWO DO NOT, and the split is FORCED rather than chosen (§4.1).
// Управление's obvious cell — „N народни представители, X води" — has no bucket producer:
// `parties/by_region/*.json` carries votes and no seats, and `MandatesTile` reads its seat count
// from `/api/db/mp-roster`, which §5.1 forbids on the render path. Потребление's numbers are
// Cloud SQL only. So both are LINK cells that make no claim and therefore cannot go stale.

import {
  PLACE_DIGEST_MIN_CELLS,
  PLACE_DIGEST_ORDER,
  isSplitControl,
  partyIdOrNull,
  type PlaceDigestCell,
  type PlaceDigestLinkCell,
  type PlaceDigestLocalCell,
  type PlaceDigestParliamentaryCell,
  type ElectionSurfaceV1,
  type PlaceViewName,
} from "@/data/elections/surfaceTypes";
import {
  localUrl,
  placeViewUrl,
  presidentialViewUrl,
  type PlaceRef,
} from "@/data/local/placeViews";

/** The winner row a parliamentary figure cell states — the FIRST ROW of the same ranked list the
 *  view already draws, never a second aggregation over the same votes (§4.1). */
export type ParliamentaryWinner = {
  partyId: string | null;
  pct: number;
  /** Margin over the runner-up, in points. */
  marginPct: number;
};

export const parliamentaryDigestCell = (args: {
  place: PlaceRef;
  cycle: string;
  winner?: ParliamentaryWinner;
}): PlaceDigestParliamentaryCell | undefined => {
  const to = placeViewUrl("parliamentary", args.place);
  // ⚠ NO ROUTE AND NO WINNER ARE BOTH `undefined`. A cell that links nowhere is worse than an
  // absent cell, and a cell with no figure is not a figure cell.
  if (!to || !args.winner) return undefined;
  return {
    kind: "figure",
    view: "parliamentary",
    to,
    cycle: args.cycle,
    winnerPartyId: args.winner.partyId,
    winnerPct: args.winner.pct,
    marginPct: args.winner.marginPct,
  };
};

/** What the Местни cell states, read from the one file that view draws it from. */
export type LocalDigestSource = {
  mayorName?: string | null;
  mayorPartyId?: string | null;
  councilLeadPartyId?: string | null;
  councilLeadSeats?: number | null;
  councilSeatsTotal?: number | null;
};

export const localDigestCell = (args: {
  place: PlaceRef;
  cycle: string;
  source?: LocalDigestSource;
}): PlaceDigestLocalCell | undefined => {
  const to = localUrl(args.place, args.cycle);
  const s = args.source;
  // ⚠ THE MAYOR'S NAME IS THE CELL. Without it there is nothing to state — and an empty string
  // rendered beside "Кмет" is a claim that the office is vacant.
  if (!to || !s?.mayorName) return undefined;
  return {
    kind: "figure",
    view: "local",
    to,
    cycle: args.cycle,
    // Bulgarian in both languages, never transliterated (§5.3).
    mayorName: s.mayorName,
    mayorPartyId: partyIdOrNull(s.mayorPartyId),
    councilLeadPartyId: partyIdOrNull(s.councilLeadPartyId),
    // ⚠ AND THE SAME RULE ONE FIELD DOWN. `?? 0` here would publish „0 от 0 съветника" about a
    // named municipality whenever the council result did not load — the mayor is the cell, the
    // council line is drawn only when both numbers are real.
    councilLeadSeats: s.councilLeadSeats ?? null,
    councilSeatsTotal: s.councilSeatsTotal ?? null,
    // ⚠ ONE RULE, TWO READERS. The split-control standout states exactly this, so both read
    // `isSplitControl` from the shared module rather than each deciding it — and "matches" is
    // its negation only when BOTH parties are known, which is why the guard is not `!==`.
    mayorMatchesCouncil:
      Boolean(partyIdOrNull(s.mayorPartyId)) &&
      Boolean(partyIdOrNull(s.councilLeadPartyId)) &&
      !isSplitControl(s.mayorPartyId, s.councilLeadPartyId),
  };
};

/** The two views whose numbers this plan cannot reach. A LINK makes no claim, so it cannot go
 *  stale — which is the whole reason they are links rather than figures. */
export const linkDigestCell = (
  view: Exclude<PlaceDigestLinkCell["view"], "presidential">,
  place: PlaceRef,
): PlaceDigestLinkCell | undefined => {
  const to = placeViewUrl(view, place);
  if (!to) return undefined;
  return {
    kind: "link",
    view,
    to,
    descriptorKey:
      view === "governance"
        ? "place_digest_governance_desc"
        : "place_digest_consumption_desc",
  };
};

/** Presidential's own link cell — separate from `linkDigestCell` because, unlike governance/
 *  consumption, its URL needs a CYCLE (`presidentialViewUrl`, not the generic `placeViewUrl`
 *  dispatcher — see that function's own header for why). Absent `cycle` drops the cell, the
 *  same "no route, no card" rule every other cell here follows. */
export const presidentialDigestCell = (
  place: PlaceRef,
  cycle?: string,
): PlaceDigestLinkCell | undefined => {
  const to = cycle ? presidentialViewUrl(place, cycle) : null;
  if (!to) return undefined;
  return {
    kind: "link",
    view: "presidential",
    to,
    descriptorKey: "place_digest_presidential_desc",
  };
};

export type PlaceDigestInput = {
  place: PlaceRef;
  /** The parliamentary cycle the figure cell is for. */
  parliamentaryCycle: string;
  /** The local cycle, when one covers this place. Absent drops the Местни cell entirely. */
  localCycle?: string;
  /** The presidential cycle, when one covers this place. Absent drops the Президент cell
   *  entirely — same rule as `localCycle`. */
  presidentialCycle?: string;
  winner?: ParliamentaryWinner;
  local?: LocalDigestSource;
  /** The view the reader is already on — its cell restates the page (§7.1). */
  currentView?: PlaceViewName;
};

/** ⚠ BELOW TWO CELLS THERE IS NO DIGEST (§4.1). §7.1 drops the reader's own view and an
 *  unreachable view drops its own, so a parliamentary page in a place with no local cycle is
 *  down to two and a section page to zero. One or two cells in a four-column grid restate the
 *  pills directly above them.
 *
 *  ⚠ AND A SECTION HAS NONE AT ALL. Governance, consumption and local all stop above the polling
 *  station, so the floor would do it anyway — but saying so here means the rule does not depend
 *  on the arithmetic happening to work out. */
export const buildPlaceDigest = (
  input: PlaceDigestInput,
): PlaceDigestCell[] => {
  if (input.place.level === "section") return [];
  const byView = new Map<PlaceViewName, PlaceDigestCell | undefined>([
    ["governance", linkDigestCell("governance", input.place)],
    [
      "parliamentary",
      parliamentaryDigestCell({
        place: input.place,
        cycle: input.parliamentaryCycle,
        winner: input.winner,
      }),
    ],
    [
      "presidential",
      presidentialDigestCell(input.place, input.presidentialCycle),
    ],
    [
      "local",
      input.localCycle
        ? localDigestCell({
            place: input.place,
            cycle: input.localCycle,
            source: input.local,
          })
        : undefined,
    ],
    ["consumption", linkDigestCell("consumption", input.place)],
  ]);

  // Order is `PlaceViewNav`'s own, read from the constant rather than restated, so the digest
  // and the pills above it cannot disagree about the sequence.
  const cells = PLACE_DIGEST_ORDER.filter((v) => v !== input.currentView)
    .map((v) => byView.get(v))
    .filter((c): c is PlaceDigestCell => c !== undefined);

  return cells.length < PLACE_DIGEST_MIN_CELLS ? [] : cells;
};

/** The Местни cell's figures, read out of the LOCAL SURFACE — the same artifact the Местни tab
 *  itself renders (§Phase 5 item 4b).
 *
 *  ⚠ THIS IS THE PHASE WHERE THE FAILURE IS WORST, and the plan says so outright: "a digest
 *  naming one mayor while the tab one click away names another is wrong about a named
 *  individual, renders at a 200, and no row count moves". So the cell does not get its own
 *  resolver and does not read a stored copy — it re-derives from the producer, which makes the
 *  two physically incapable of disagreeing.
 *
 *  ⚠ AND `split_control` IS PRODUCED ONCE AND READ TWICE (item 4). The surface carries it as a
 *  FACT and this cell states the same thing in one line; both come from this one artifact, and
 *  `isSplitControl` is the single rule underneath.
 *
 *  ⚠ THE MAYOR IS THE `isElected` ROW AND NOTHING ELSE, and an artifact with no elected row
 *  yields NO NAME so the cell drops rather than naming a loser.
 *
 *  ⚠ THE PUBLISHED CORPUS CANNOT TELL THAT RULE FROM „the first row", which is why the gate on
 *  it is fixture-independent. A runoff municipality's surface emits only the DECISIVE round, so
 *  its leader IS the winner and the two coincide on all 289 — swapping the rule leaves every
 *  corpus assertion green. The rule still matters: it is what the ordering guarantee rests on,
 *  and nothing in the schema requires the elected row to be first. */
export const localDigestFromSurface = (
  surface: ElectionSurfaceV1 | undefined,
): LocalDigestSource | undefined => {
  if (!surface || surface.kind !== "local") return undefined;
  const mayor = surface.ballots.find((b) => b.kind === "municipality_mayor");
  const council = surface.ballots.find((b) => b.kind === "municipal_council");
  const elected = mayor?.preview.find((e) => e.isElected);
  const lead = council?.preview[0];
  return {
    mayorName: elected?.candidateName ?? null,
    mayorPartyId: elected?.partyId ?? null,
    councilLeadPartyId: lead?.partyId ?? null,
    // ⚠ NULL, NEVER 0, when the council ballot is absent. „0 от 0 съветника" beside a named
    // município is a claim a reader believes; the mayor half of the cell stands on its own.
    councilLeadSeats: lead?.seats ?? null,
    councilSeatsTotal: council?.seatsTotal ?? null,
  };
};
