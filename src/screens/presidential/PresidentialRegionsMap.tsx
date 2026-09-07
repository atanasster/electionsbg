// The presidential country map — 31 oblasts, filled with the LEADING TICKET's colour.
//
// ⚠ IT DOES NOT WRAP `RegionsMap`, and that is the one decision worth recording. The
// parliamentary country map is bound to the parliamentary party model at every level:
// `MapElement` calls `usePartyInfo().topVotesParty(votes)` to pick a fill, `useMapElements`
// takes `ElectionResults`, and the whole tile reads the cycle out of `ElectionContext`. A
// presidential ticket has no `partyId` by design — its nominator may be a party, a coalition
// or an инициативен комитет, so resolving all three to a party would mislabel two — so there
// is nothing for that path to colour by. Threading a colour resolver through four shared
// components to serve one kind would put a branch in the busiest maps on the site; this draws
// on the same primitives (`FeatureMap`, `getDataProjection`, `SVGMapContainer`) one level down.
//
// ⚠ THE COLOUR COMES FROM `tickets.json`, never from a palette chosen here. The ingest already
// resolved each pair's colour — a party's own where the nominator has one, a neutral-palette
// slot otherwise (17 of 2021's 23) — and a second choice would give one pair two colours.
//
// ⚠⚠ IT IS MOUNTED ONLY WHEN THE ROLL-UP HAS ANSWERED. Every feature with no leader takes the
// „няма подадени гласове" label, which is a statement of FACT about a named place — and while
// the roll-up was merely loading, or absent (the common case: `data/*_pvr` is gitignored and
// has no bucket copy), that made all 31 of them false, rendered directly above a ranking table
// showing 2.6 million votes. `RoundPanel` gates the mount on `status === "ready"`; inside a
// ready roll-up the label is true, and that is the only state this component is asked about.
//
// ⚠ COLOUR IS NEVER THE ONLY ENCODING, and there are two text twins. `PresidentialTicketRanking`
// shares the canvas row with this map and PRECEDES it in the DOM (§4: the ranked result comes
// first, and on mobile that is the visual order too); `PresidentialRegionsList` follows the
// canvas with the per-region answer. The second one is also the only route from the country page
// down to a region, which is why it and this map appear and disappear together.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { GeoPermissibleObjects } from "d3-geo";
import { useNavigate } from "react-router-dom";
import { useRegionsMap } from "@/data/regions/useRegionsMap";
import { useRegions } from "@/data/regions/useRegions";
import { FeatureMap } from "@/screens/components/maps/FeatureMap";
import { SVGMapContainer } from "@/screens/components/maps/SVGMapContainer";
import { MeasuredMapBox } from "@/screens/components/maps/MeasuredMapBox";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { useTooltip } from "@/ux/useTooltip";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import { regionDisplayName } from "@/data/presidential/regionName";
import { formatPct } from "@/lib/currency";
import type { PresidentialTicket } from "@/data/presidential/useTickets";
import type { RegionJSONProps } from "@/screens/components/maps/mapTypes";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";

/** ⚠ THE FALLBACK IS A NEUTRAL GREY, NEVER ANOTHER PAIR'S COLOUR. A place with no leader —
 *  nobody voted — and a ticket the ingest could not colour must not borrow one. */
const NO_LEADER = "hsl(var(--muted))";

export type RegionLeader = {
  number: number;
  votes: number;
  shareOfTicketVotes: number;
};

export type PresidentialRegionsMapProps = {
  cycle: string;
  round: 1 | 2;
  /** ⚠ FROM A ROLL-UP THAT RESOLVED. See the header: a place missing from a READY roll-up
   *  genuinely cast no votes; a place missing because nothing has loaded yet has not. */
  leaders: Map<string, RegionLeader>;
  tickets: Map<number, PresidentialTicket>;
};

export const PresidentialRegionsMap: FC<PresidentialRegionsMapProps> = (
  props,
) => (
  <MeasuredMapBox>{(size) => <Inner {...props} size={size} />}</MeasuredMapBox>
);

const Inner: FC<PresidentialRegionsMapProps & { size: MapCoordinates }> = ({
  size,
  cycle,
  round,
  leaders,
  tickets,
}) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language?.startsWith("bg") ?? true;
  const mapGeo = useRegionsMap();
  const { findRegion } = useRegions();
  const navigate = useNavigate();
  const { tooltip, ...tooltipEvents } = useTooltip();

  // ⚠ THE GEOMETRY IS CHECKED, NOT ASSUMED. `useRegionsMap` fetches `/regions_map.json` with
  // no shape guard of its own, so anything the bucket answers with — an HTML error page, a
  // truncated file, a 200 carrying some other JSON — arrives here as an object with no
  // `features`, and `mapGeo.features.map` is then a `TypeError` inside the render. With no
  // error boundary anywhere in `src/` that unmounts the React ROOT: a white screen for the
  // whole SPA rather than a missing map. Returning null loses the map and keeps the page.
  const features = Array.isArray(mapGeo?.features) ? mapGeo.features : null;
  const { path } = useMemo(
    () => getDataProjection(mapGeo as GeoPermissibleObjects, size),
    [mapGeo, size],
  );
  if (!features) return null;
  return (
    <>
      <SVGMapContainer
        size={size}
        supportsShiftArrows={false}
        supportsNames={false}
      >
        {features.map((feature, i) => {
          const props = feature.properties as RegionJSONProps;
          const code = props.nuts3;
          const lead = leaders.get(code);
          const ticket = lead ? tickets.get(lead.number) : undefined;
          const name = regionDisplayName(findRegion(code), isBg, code);
          // ⚠ THE LABEL NAMES THE PLACE AND ITS LEADER. „Пловдив" alone tells a screen reader
          // nothing the list beside it does not already say — the map's content IS who led
          // where — and without a label `FeatureMap` leaves the region MOUSE-ONLY, because it
          // derives keyboard access as `!!ariaLabel && !!onClick`.
          const label =
            ticket && lead
              ? t("presidential_map_region_label", {
                  place: name,
                  president: ticket.president,
                  pct: formatPct(lead.shareOfTicketVotes, i18n.language, 1),
                })
              : t("presidential_map_region_label_empty", { place: name });
          const to = presidentialUrl(cycle, "region", code);
          return (
            <FeatureMap
              key={code || i}
              geoPath={path}
              feature={feature}
              fillColor={ticket?.color ?? NO_LEADER}
              ariaLabel={to ? label : undefined}
              onClick={to ? () => navigate(to) : undefined}
              onMouseEnter={(e) =>
                tooltipEvents.onMouseEnter(
                  { pageX: e.pageX, pageY: e.pageY },
                  // ⚠ THE LABEL ALONE — it already opens with the place name, so a heading
                  // above it printed „Благоевград" twice.
                  <div className="text-left">
                    <div>{label}</div>
                    {/* ⚠ THE ROUND IS NAMED. Round 1 and the runoff are different electorates
                        — nationally 5.7 points apart in 2021 — so a map with no round on it
                        is a map of an unstated question. */}
                    <div className="opacity-70">
                      {t("election_round", { round })}
                    </div>
                  </div>,
                )
              }
              onMouseMove={tooltipEvents.onMouseMove}
              onMouseLeave={tooltipEvents.onMouseLeave}
            />
          );
        })}
      </SVGMapContainer>
      {tooltip}
    </>
  );
};
