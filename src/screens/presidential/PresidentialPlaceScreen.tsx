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
// ⚠ NO `PlaceHeader`, AND THAT IS A DECISION RATHER THAN AN OMISSION — recorded here because
// every other caller of `ElectionSurfaceBoundary` has one. `PlaceHeader` takes a `PlaceView`
// (`placeViews.ts`), and there are exactly four: governance, parliamentary, local and
// consumption. Presidential is not one, and making it one adds a fifth pill to every place
// page on the site — including the ~4,000 settlements where no presidential surface is
// published — which is a site-wide change this family has no business making on its own. The
// cost is stated rather than hidden: a reader here gets a link back to the country page and
// nothing upward, so the parent and child navigation `ElectionResultsShell` does not draw is
// missing at this level. Closing it properly means either the fifth view or a parent link
// built from `surface.place.parent`, which the artifact already carries and nothing reads.
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
import { useSurfaceLabels } from "@/data/elections/useSurfaceLabels";
import {
  PRESIDENTIAL_ABROAD_ID,
  presidentialUrl,
} from "@/data/elections/presidentialRoutes";
import { findPresidentialEntry } from "@/data/presidentialCatalogue";
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

export const PresidentialPlaceScreen: FC<{
  level: PresidentialPlaceLevel;
}> = ({ level }) => {
  const params = useParams();
  const { t } = useTranslation();
  const { placeLabel } = useSurfaceLabels();
  const cycle = params.cycle;
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
        {/* ⚠ THE ROUND-1 DATE, NOT THE CYCLE ID — `cycleIsoDate` returns "" for a `_pvr`
            folder and `formatDate` would print the folder name verbatim. A cycle the build
            does not catalogue simply gets no scope line rather than a fabricated one. */}
        {entry ? (
          <ElectionScopeBar cycle={entry.round1Date} status="final" />
        ) : null}
      </header>
      <ElectionSurfaceBoundary
        kind="presidential"
        level={level}
        cycle={cycle}
        id={id}
        skeleton={
          <ElectionSurfaceSkeleton
            facts={FACT_SLOTS[level]}
            // ⚠ A SECTION DRAWS NO MAP — one polling station has no geography to answer a
            // question about, which is what makes this the repo's canonical map-free page.
            withMap={level !== "section"}
          />
        }
        fallback={
          <p className="text-sm text-muted-foreground">
            {t("presidential_place_not_published")}
          </p>
        }
      >
        {(s) => <ElectionResultsShell surface={s} scope="header" />}
      </ElectionSurfaceBoundary>
    </section>
  );
};
