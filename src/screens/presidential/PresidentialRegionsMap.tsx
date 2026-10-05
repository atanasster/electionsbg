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
// ⚠ ITS TWO LABEL KEYS LIVE IN `translation.json`, NOT IN THE `presidential` BUNDLE, and the
// prefix does not decide that — `bundles.ts` does: „a key named from a SHARED module is core,
// whatever its prefix". `presidential_map_region_label` and its `_empty` twin are now also
// named by `PresidentialChildMap`, which the elections map REGISTRY reaches, so every route can
// reach them and `bundle_reachability.test.ts` fails if they sit in the bundle. Same reason the
// five `presidential_map_q_who_led_*` keys have always been core.
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
// ⚠ IT IS DRAWN LIKE THE PARLIAMENTARY COUNTRY MAP, from the same parts: the Leaflet base layer
// under a half-opacity fill, a pin per oblast sized by the votes cast there (`MapMarker`, which is
// already election-agnostic), the world inset in the corner linking to the abroad results
// (`WorldSilhouette`, shared with `WorldLink`), and a hover card listing the leading tickets with
// their votes and share — for BOTH rounds, since the reader's question on hover is „how did this
// place vote", and the two rounds answer it differently. Before, it was a flat SVG whose tooltip
// was one sentence about the leader, which made the two country pages read as two products.
//
// ⚠ COLOUR IS NEVER THE ONLY ENCODING. `PresidentialTicketRanking` shares the canvas row with
// this map and PRECEDES it in the DOM (§4: the ranked result comes first), and every region
// carries an aria-label naming its leader, which also makes it keyboard-operable.

import { FC, ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { GeoPermissibleObjects } from "d3-geo";
import { useNavigate } from "react-router-dom";
import { useRegionsMap } from "@/data/regions/useRegionsMap";
import { useRegions } from "@/data/regions/useRegions";
import { FeatureMap } from "@/screens/components/maps/FeatureMap";
import { SVGMapContainer } from "@/screens/components/maps/SVGMapContainer";
import { MeasuredMapBox } from "@/screens/components/maps/MeasuredMapBox";
import { LeafletMap } from "@/screens/components/maps/LeafletMap";
import { MapMarker } from "@/screens/components/maps/MapMarker";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { WorldSilhouette } from "@/screens/components/regions/WorldSilhouette";
import { useOptions } from "@/layout/dataview/OptionsContext";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { useTooltip } from "@/ux/useTooltip";
import { Tooltip } from "@/ux/Tooltip";
import { Link } from "@/ux/Link";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import { regionDisplayName } from "@/data/presidential/regionName";
import { formatPct } from "@/lib/currency";
import {
  foldPlace,
  type RollupEntry,
  type RoundRollup,
} from "@/data/presidential/useRoundRollup";
import type { PresidentialTicket } from "@/data/presidential/useTickets";
import type { RegionJSONProps } from "@/screens/components/maps/mapTypes";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";
import { PresidentialPlaceTip } from "./PresidentialPlaceTip";

/** ⚠ THE FALLBACK IS A NEUTRAL GREY, NEVER ANOTHER PAIR'S COLOUR. A place with no leader —
 *  nobody voted — and a ticket the ingest could not colour must not borrow one. */
const NO_LEADER = "hsl(var(--muted))";

export type RegionLeader = {
  number: number;
  votes: number;
  shareOfTicketVotes: number;
};

/** One round's data for the hover cards: the oblast roll-up and, when loaded, the abroad one. */
export type PresidentialMapRound = {
  round: 1 | 2;
  regions?: RoundRollup;
  abroad?: RoundRollup;
};

export type PresidentialRegionsMapProps = {
  cycle: string;
  round: 1 | 2;
  /** ⚠ FROM A ROLL-UP THAT RESOLVED. See the header: a place missing from a READY roll-up
   *  genuinely cast no votes; a place missing because nothing has loaded yet has not. */
  leaders: Map<string, RegionLeader>;
  tickets: Map<number, PresidentialTicket>;
  /** Every round the cycle has, for the hover card. Optional — without it the card shows only
   *  the leader sentence, which is what a caller with one roll-up in hand can honestly say. */
  rounds?: PresidentialMapRound[];
};

/** All abroad sections of one round folded into one place — the world inset is ONE place. */
const foldAbroad = (rollup?: RoundRollup): RollupEntry | undefined => {
  if (!rollup) return undefined;
  const sums = new Map<number, number>();
  for (const e of rollup.entries)
    for (const v of e.results.votes)
      sums.set(v.partyNum, (sums.get(v.partyNum) ?? 0) + v.totalVotes);
  return {
    key: "abroad",
    results: {
      votes: [...sums].map(([partyNum, totalVotes]) => ({
        partyNum,
        totalVotes,
      })),
    },
  };
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
  rounds,
}) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language?.startsWith("bg") ?? true;
  const mapGeo = useRegionsMap();
  const { findRegion } = useRegions();
  const navigate = useNavigate();
  const { tooltip, ...tooltipEvents } = useTooltip();
  const { withNames } = useOptions();

  // Each round's oblast rows by code, for the hover card.
  const byRound = useMemo(
    () =>
      (rounds ?? []).map((r) => ({
        round: r.round,
        entries: new Map(
          (r.regions?.entries ?? []).map((e) => [e.key, e] as const),
        ),
        abroad: foldAbroad(r.abroad),
      })),
    [rounds],
  );
  // The pins are sized by the votes cast in the round ON SCREEN — the same „how much happened
  // here" quantity the parliamentary pins carry. `foldPlace` is the one definition of the total.
  const totals = useMemo(() => {
    const out = new Map<string, number>();
    const shown = byRound.find((r) => r.round === round);
    if (shown)
      for (const [k, e] of shown.entries) out.set(k, foldPlace(e).total);
    return out;
  }, [byRound, round]);
  const [minVotes, maxVotes] = useMemo(() => {
    const vals = [...totals.values()].filter((v) => v > 0);
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 0];
  }, [totals]);

  // ⚠ THE GEOMETRY IS CHECKED, NOT ASSUMED. `useRegionsMap` fetches `/regions_map.json` with
  // no shape guard of its own, so anything the bucket answers with — an HTML error page, a
  // truncated file, a 200 carrying some other JSON — arrives here as an object with no
  // `features`, and `mapGeo.features.map` is then a `TypeError` inside the render. With no
  // error boundary anywhere in `src/` that unmounts the React ROOT: a white screen for the
  // whole SPA rather than a missing map. Returning null loses the map and keeps the page.
  const features = Array.isArray(mapGeo?.features) ? mapGeo.features : null;
  const { path, projection, bounds, scale } = useMemo(
    () => getDataProjection(mapGeo as GeoPermissibleObjects, size),
    [mapGeo, size],
  );
  if (!features) return null;

  const tipFor = (
    title: string,
    entryOf: (r: (typeof byRound)[number]) => RollupEntry | undefined,
  ) =>
    byRound.length ? (
      <PresidentialPlaceTip
        title={title}
        tickets={tickets}
        current={round}
        rounds={byRound.map((r) => ({ round: r.round, entry: entryOf(r) }))}
      />
    ) : null;

  return (
    <div className="flex w-full">
      <div className="relative">
        <LeafletMap size={size} bounds={bounds} scale={scale} />
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
                opacity={withNames ? undefined : 0.5}
                ariaLabel={to ? label : undefined}
                onClick={to ? () => navigate(to) : undefined}
                onMouseEnter={(e) =>
                  tooltipEvents.onMouseEnter(
                    { pageX: e.pageX, pageY: e.pageY },
                    tipFor(name, (r) => r.entries.get(code)) ?? (
                      // No roll-ups were handed in: the leader sentence, with the ROUND named —
                      // a map of an unstated round is a map of an unstated question.
                      <div className="text-left">
                        <div>{label}</div>
                        <div className="opacity-70">
                          {t("election_round", { round })}
                        </div>
                      </div>
                    ),
                  )
                }
                onMouseMove={tooltipEvents.onMouseMove}
                onMouseLeave={tooltipEvents.onMouseLeave}
              />
            );
          })}
          {features.map((feature, i) => {
            const code = (feature.properties as RegionJSONProps).nuts3;
            return (
              <MapMarker
                key={`pin-${code || i}`}
                projection={projection}
                info={findRegion(code)}
                minVotes={minVotes}
                maxVotes={maxVotes}
                value={totals.get(code)}
              />
            );
          })}
        </SVGMapContainer>
        <AbroadInset
          size={size}
          cycle={cycle}
          tickets={tickets}
          tip={tipFor(t("abroad"), (r) => r.abroad)}
          entry={byRound.find((r) => r.round === round)?.abroad}
        />
      </div>
      {tooltip}
    </div>
  );
};

/** The world inset — the parliamentary map's corner link to the abroad results, coloured by
 *  the pair that led abroad in the round on screen. ⚠ Grey until the abroad roll-up loads,
 *  never another pair's colour. */
const AbroadInset: FC<{
  size: MapCoordinates;
  cycle: string;
  tickets: Map<number, PresidentialTicket>;
  tip: ReactNode;
  entry?: RollupEntry;
}> = ({ size, cycle, tickets, tip, entry }) => {
  const { t } = useTranslation();
  const isXLarge = useMediaQueryMatch("xl");
  const isMedium = useMediaQueryMatch("md");
  const to = presidentialUrl(cycle, "abroad");
  if (!to) return null;
  const width: number = isXLarge ? 160 : isMedium ? 120 : 100;
  const height = 0.7 * width;
  const best = entry ? foldPlace(entry).best : undefined;
  const color =
    best && best.totalVotes > 0 ? tickets.get(best.partyNum)?.color : undefined;
  const silhouette = (
    <WorldSilhouette
      fillColor={color}
      width={width}
      height={height}
      className="border-2 hover:border-muted-foreground rounded-xl p-1 bg-card"
    />
  );
  return (
    <Link
      to={to}
      aria-label={t("abroad")}
      data-map-abroad-inset
      style={{
        position: "absolute",
        left: size[0] - width,
        top: size[1] - height,
      }}
    >
      {tip ? <Tooltip content={tip}>{silhouette}</Tooltip> : silhouette}
    </Link>
  );
};
