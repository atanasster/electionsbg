// Every presidential page BELOW the country — region, municipality, settlement, section and
// „чужбина" — through one component parameterised by level.
//
// ⚠ ONE COMPONENT, NOT FIVE, BECAUSE THE FIVE DIFFER IN NOTHING A SCREEN OWNS. They differ in
// which route param carries the id, which is a routing fact, and in what the surface declares
// — facts, ranked columns, whether a map slot exists — which the DESCRIPTOR owns and the shell
// reads. Five copies would be five places for the same three lines to drift, and the level is
// already the axis every gate in this family enumerates.
//
// ⚠ THERE IS NO LEGACY BODY TO FALL BACK TO, and that is what makes the `fallback` here
// different from every other caller of `ElectionSurfaceBoundary`. A parliamentary or local
// place page renders its own composition when the artifact is missing; a presidential place
// page has nothing else to show, so the fallback is a stated absence — „this cycle's place
// pages are not published" — rather than `null`, which would render a heading over nothing.
//
// ⚠ NO `PlaceHeader`, BUT `PlaceViewNav` IS MOUNTED — presidential is now a fifth `PlaceView`
// (`placeViews.ts`), so the pill row appears on every place page site-wide, this one included.
// The full `PlaceHeader` is still NOT used here: it resolves identity from settlements.json /
// municipalities.json / regions.json / GRAO and its `PlaceLevel` has no "abroad" member, none
// of which fits this screen's own identity resolution (`useSurfaceLabels`) or its five levels.
// Reusing it would be a much larger, riskier rewrite for no benefit over the bespoke header
// below, which already carries the year/date/round the way `PlaceHeader`'s narrative would.
//
// The pill row itself is rendered only for region/municipality/settlement — the three levels
// where this screen already has an exact oblast/obshtina/ekatte to hand it. `section` drops
// through `ElectionResultsShell`'s own drill-up rather than through the pill row (its parent
// settlement id is not directly in this screen's props), and `abroad` has no PlaceRef at all
// (one page, no id) — both simply render no pills, same as any place where fewer than two
// views resolve. The cost of skipping `PlaceHeader` entirely is stated rather than hidden: a
// reader here gets a link back to the country page and nothing upward, so the parent and child
// navigation `ElectionResultsShell` does not draw is missing at this level. Closing it properly
// means a parent link built from `surface.place.parent`, which the artifact already carries and
// nothing reads.
//
// ⚠ THE ABROAD ID IS A CONSTANT, NOT A ROUTE PARAM. `/presidential/:cycle/abroad` carries no
// id; the artifact needs one, and `PRESIDENTIAL_ABROAD_ID` is the single value the producer and
// this screen agree on. A value invented at either end is a page fetching a file nobody wrote.

import { FC } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ElectionSurfaceBoundary } from "@/screens/elections/ElectionSurfaceBoundary";
import { ElectionResultsShell } from "@/screens/elections/ElectionResultsShell";
import { ElectionScopeBar } from "@/screens/elections/ElectionScopeBar";
import { ElectionSurfaceSkeleton } from "@/screens/elections/ElectionSurfaceSkeleton";
import { PlaceViewNav } from "@/screens/components/PlaceViewNav";
import type { PlaceRef } from "@/data/local/placeViews";
import { useSurfaceLabels } from "@/data/elections/useSurfaceLabels";
import {
  PRESIDENTIAL_ABROAD_ID,
  presidentialUrl,
} from "@/data/elections/presidentialRoutes";
import { findPresidentialEntry } from "@/data/presidentialCatalogue";
import { useTicketsByNumber } from "@/data/presidential/useTickets";
import { personHrefForTicket } from "@/data/presidential/ticketPersons";
import { PresidentialPlaceTransfer } from "./PresidentialPlaceTransfer";
import { PresidentialPlaceNeighborhoods } from "./PresidentialPlaceNeighborhoods";
import type { ElectionPlaceLevel } from "@/data/elections/surfaceTypes";

/** The levels this screen serves.
 *
 *  ⚠ `country` IS EXCLUDED IN THE TYPE, not merely in a lookup table. It is served by
 *  `PresidentialCycleScreen`, which reads the canonical summary rather than an artifact —
 *  listing it here would offer a second page for the same place, built from a different
 *  source. As a comment on a `Record` keyed by the full union, the gap was laundered through
 *  a cast: `level="country"` resolved `params[undefined]`, gave the boundary no id, and fell
 *  silently through to the "not published" body. The compiler refuses it now. */
export type PresidentialPlaceLevel = Exclude<ElectionPlaceLevel, "country">;

/** Which route param carries this level's id. `abroad` has none — its route takes no id. */
const ID_PARAM: Record<Exclude<PresidentialPlaceLevel, "abroad">, string> = {
  region: "oblast",
  municipality: "obshtina",
  settlement: "ekatte",
  section: "code",
};

/** How many fact cards the level's descriptor fills, so the skeleton reserves what the page
 *  actually renders. ⚠ RESERVING MORE IS THE LAYOUT SHIFT IN THE OTHER DIRECTION — a box that
 *  nothing fills is as bad as one that appears late. */
const FACT_SLOTS: Record<PresidentialPlaceLevel, number> = {
  region: 4,
  municipality: 4,
  settlement: 4,
  // ⚠ Abroad publishes NO turnout fact — there is no registered-voter denominator outside the
  // country — so its strip is one card shorter by design (decision 6).
  abroad: 3,
  section: 4,
};

/** The levels whose map slot `MAP_ADAPTERS` actually fills.
 *
 *  ⚠ IT MIRRORS THE REGISTRY AND IS NOT DERIVED FROM IT ON PURPOSE. Importing `MAP_ADAPTERS`
 *  here would put the registry — and the `import()` edges to every adapter — into this screen's
 *  static closure, which is the one thing the lazy indirection exists to prevent. The pairing is
 *  held by `presidentialMaps.test.ts` instead, so the two cannot drift silently. */
const MAPPED_LEVELS = new Set<PresidentialPlaceLevel>([
  "region",
  "municipality",
  "settlement",
]);

export const PresidentialPlaceScreen: FC<{
  level: PresidentialPlaceLevel;
}> = ({ level }) => {
  const params = useParams();
  const { t } = useTranslation();
  const { placeLabel } = useSurfaceLabels();
  const cycle = params.cycle;
  // ⚠ CALLED UNCONDITIONALLY, above the `!cycle` early return — React hook order. It is a
  // no-op for an empty cycle and its result is only read inside the render prop.
  const tickets = useTicketsByNumber(cycle ?? "");
  const id =
    level === "abroad" ? PRESIDENTIAL_ABROAD_ID : params[ID_PARAM[level]];

  if (!cycle) return null;

  const entry = findPresidentialEntry(cycle);
  const countryTo = presidentialUrl(cycle, "country");
  // ⚠ THE CODE, NEVER A BLANK. `placeLabel` falls back to the id at every level, because a
  // blank place name on a result page is a heading about nowhere. `id` can still be absent
  // here — a route param is `string | undefined` until React Router has matched — and that
  // is the one case with nothing to name, which the boundary then reports as `loading`.
  const name = id ? placeLabel(level, id) : "";

  // The pill row's PlaceRef, for the three levels this screen has an exact id for — see the
  // file header for why `section` and `abroad` render no pills.
  const placeRef: PlaceRef | null =
    id && level === "region"
      ? { level: "region", oblast: id }
      : id && level === "municipality"
        ? { level: "municipality", obshtina: id }
        : id && level === "settlement"
          ? { level: "settlement", ekatte: id }
          : null;

  return (
    <section className="my-4 space-y-6">
      <header>
        {countryTo ? (
          <Link
            className="text-sm text-muted-foreground underline"
            to={countryTo}
          >
            {t("presidential_cycle_title")}
          </Link>
        ) : null}
        <h1 className="text-xl font-semibold">{name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          {placeRef ? (
            <PlaceViewNav
              active="presidential"
              level={placeRef.level}
              ekatte={placeRef.ekatte}
              obshtina={placeRef.obshtina}
              oblast={placeRef.oblast}
              align="start"
            />
          ) : null}
          {/* ⚠ THE ROUND-1 DATE, NOT THE CYCLE ID — `cycleIsoDate` returns "" for a `_pvr`
              folder and `formatDate` would print the folder name verbatim. A cycle the build
              does not catalogue simply gets no scope line rather than a fabricated one. */}
          {entry ? (
            <ElectionScopeBar cycle={entry.round1Date} status="final" />
          ) : null}
        </div>
      </header>
      <ElectionSurfaceBoundary
        kind="presidential"
        level={level}
        cycle={cycle}
        id={id}
        skeleton={
          <ElectionSurfaceSkeleton
            facts={FACT_SLOTS[level]}
            // ⚠ RESERVE WHAT THE PAGE RENDERS, WHICH IS NOT WHAT THE DESCRIPTOR DECLARES.
            // Every level except `section` declares a map slot; three have an adapter to fill
            // it (`presidential/region|municipality|settlement/winner`). A section has no
            // geography to answer a question about — the repo's canonical map-free page — and
            // `abroad` declares a slot `MAP_ADAPTERS` deliberately does not serve (no
            // country→continent crosswalk), so reserving 360px on those two is the layout shift
            // in the other direction.
            withMap={MAPPED_LEVELS.has(level)}
          />
        }
        fallback={
          <p className="text-sm text-muted-foreground">
            {t("presidential_place_not_published")}
          </p>
        }
      >
        {(s) => (
          <ElectionResultsShell
            surface={s}
            scope="header"
            // ⚠ THE SHELL CANNOT RESOLVE EITHER OF THESE, for the same reason: a presidential
            // ranked row is a PERSON with `partyId: null` — its nominator may be a party, a
            // coalition or an инициативен комитет, so resolving all three to a canonical party
            // would mislabel two — and the party corpus the shell reads colours and links from
            // therefore has nothing to say about it. The ballot number rides in `localPartyNum`.
            //
            // ⚠ THE LINK RULE IS `personHrefForTicket` AND NOTHING ELSE — the same resolver
            // `PresidentialPersonName` uses on the country page, so one candidate cannot be a
            // link on one page and plain text on the other. It REFUSES a shared name (17 of the
            // 140 names across the five ballots; „Иван Стефанов Иванов" is fifteen people), and
            // an undefined href renders as plain text, which is the honest answer rather than a
            // link that attributes this candidacy to somebody who merely shares a name.
            rowColor={(r) =>
              r.localPartyNum === undefined
                ? undefined
                : tickets.get(r.localPartyNum)?.color
            }
            rowHref={(r) =>
              r.candidateName
                ? (personHrefForTicket(r.candidateName) ?? undefined)
                : undefined
            }
          />
        )}
      </ElectionSurfaceBoundary>
      {/* ⚠ OUTSIDE THE BOUNDARY, DELIBERATELY. The transfer shard and the place surface are
          different artifacts with different publish paths, so an oblast whose surface has not
          shipped can still have its estimate — and gating one on the other would hide a file
          that is there. It self-hides in every state but `ready`.

          ⚠ WHICH LEVELS HAVE AN ARM IS THE COMPONENT'S OWN RULE (`TRANSFER_LEVELS`), not a
          `level === "region"` written here: that is a fact about the corpus, and this screen
          has no other reason to hold one. */}
      <PresidentialPlaceTransfer cycle={cycle} level={level} id={id} />
      {/* ⚠ OUTSIDE THE BOUNDARY FOR THE SAME REASON AS THE TRANSFER ABOVE — a different
          artifact with a different publish path — and self-hiding at every level and place
          that has no catalogued district, which is almost all of them. */}
      <PresidentialPlaceNeighborhoods cycle={cycle} level={level} id={id} />
    </section>
  );
};
