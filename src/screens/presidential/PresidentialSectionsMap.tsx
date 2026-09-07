// A settlement's polling stations, as markers coloured by the leading TICKET.
//
// ⚠⚠ THE COORDINATES ARE BORROWED FROM THE PARLIAMENTARY ARCHIVE, and that is the one thing to
// understand before trusting this map. The presidential section shard carries `code`, `ekatte`,
// `protocol` and `votes` and NOTHING to plot with; a station's location is a property of the
// station rather than of the election, so it is joined on the 9-digit CIK code from the
// parliamentary settlement shard the site already publishes.
//
// Measured 2026-09-07 over a 150-settlement sample of the 2021 presidential corpus, against
// four different parliamentary cycles: 96.9%-97.7% of sections find a coordinate, best against
// the same-day 2021_11_14 vote. The spread is under a point, which is the evidence that these
// are station geography rather than a cycle's own data — so which parliamentary cycle the
// reader happens to have selected barely moves the answer, and the ~3% that miss are stations
// that did not exist in the cycle being joined against.
//
// ⚠ A MISSED STATION IS OMITTED, NEVER PLACED APPROXIMATELY. There is no honest fallback
// position for a polling station, and a marker at a guessed point is a claim about where people
// voted. The count of what could not be placed is rendered under the map, so „12 of 14 stations"
// is visible rather than a silent gap — a map that quietly drops 3% looks complete.
//
// ⚠ ITS TWO NOTE KEYS LIVE IN `translation.json`, NOT THE `presidential` BUNDLE, and the prefix
// does not decide that — `bundles.ts` does: „a key named from a SHARED module is core, whatever
// its prefix". This component is reached through `MAP_ADAPTERS`, which every route that renders
// the election shell can reach, so `bundle_reachability.test.ts` fails if they sit in the
// bundle. The same rule already moved the two `presidential_map_region_label*` keys.
//
// ⚠ IT DOES NOT REUSE `SectionsMap`. That component is bound to the parliamentary party model
// — `usePartyInfo`, `PartyVotesXS`, `results.votes[].partyNum` — so feeding it these stations
// would colour a presidential page by parliamentary parties. Same reason
// `PresidentialRegionsMap` does not wrap `RegionsMap`.

import { FC, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";

// Dynamic import keeps leaflet's CSS out of the render-blocking entry HTML; see LeafletMap.tsx.
import("leaflet/dist/leaflet.css");
import { useTranslation } from "react-i18next";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useSettlementVotes } from "@/data/settlements/useSettlementVotes";
import {
  sectionLeaders,
  usePresidentialSectionRollup,
} from "@/data/presidential/useSectionRollup";
import { useTicketsByNumber } from "@/data/presidential/useTickets";
import { MAP_BOX_HEIGHT_CLASS } from "@/screens/components/maps/MeasuredMapBox";
import { formatInt, formatPct } from "@/lib/currency";

/** ⚠ NEUTRAL, NEVER ANOTHER PAIR'S COLOUR — a ticket the ingest could not colour must not
 *  borrow one. Same rule as the country map's `NO_LEADER`. */
const NO_TICKET = "#9ca3af";

export const PresidentialSectionsMap: FC<{
  cycle: string;
  round: 1 | 2;
  ekatte: string;
}> = ({ cycle, round, ekatte }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { findSettlement } = useSettlementsInfo();
  const place = findSettlement(ekatte);
  const rollup = usePresidentialSectionRollup(cycle, round, place?.oblast);
  const tickets = useTicketsByNumber(cycle);
  // The parliamentary shard for the SAME settlement — read only for its stations' coordinates.
  const { settlement } = useSettlementVotes(ekatte);

  const leaders = useMemo(
    () =>
      rollup.status === "ready"
        ? sectionLeaders(rollup.rows, ekatte)
        : new Map<string, { number: number; votes: number; share: number }>(),
    [rollup, ekatte],
  );

  const points = useMemo(() => {
    const coords = new Map<string, { lat: number; lon: number }>();
    for (const s of settlement?.sections ?? [])
      if (typeof s.latitude === "number" && typeof s.longitude === "number")
        coords.set(String(s.section), { lat: s.latitude, lon: s.longitude });
    return [...leaders.entries()].flatMap(([code, lead]) => {
      const at = coords.get(code);
      return at ? [{ code, lead, ...at }] : [];
    });
  }, [leaders, settlement]);

  // See the header: nothing is drawn until the shard has ANSWERED, so „no votes here" is never
  // asserted about a station while its file is still in flight.
  if (rollup.status === "loading")
    return (
      <div
        className={`w-full animate-pulse rounded bg-muted ${MAP_BOX_HEIGHT_CLASS}`}
        aria-hidden="true"
      />
    );
  if (points.length === 0)
    return (
      <p className="text-sm text-muted-foreground" data-map-no-data>
        {t("election_map_no_data_here")}
      </p>
    );

  const bounds: LatLngBoundsExpression = points.map((p) => [p.lat, p.lon]);
  const unplaced = leaders.size - points.length;

  return (
    <div data-presidential-sections-map>
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [24, 24], maxZoom: 15 }}
        scrollWheelZoom={false}
        className={`w-full rounded ${MAP_BOX_HEIGHT_CLASS}`}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map((p) => {
          const ticket = tickets.get(p.lead.number);
          return (
            <CircleMarker
              key={p.code}
              center={[p.lat, p.lon]}
              radius={7}
              pathOptions={{
                color: "#fff",
                weight: 1.5,
                fillColor: ticket?.color ?? NO_TICKET,
                fillOpacity: 0.9,
              }}
            >
              <Tooltip>
                <div className="text-left">
                  <div className="font-semibold">{p.code}</div>
                  <div>
                    {ticket?.president ?? p.lead.number} ·{" "}
                    {formatPct(p.lead.share, lang, 1)} ·{" "}
                    {formatInt(p.lead.votes, lang)}
                  </div>
                  {/* ⚠ THE ROUND IS NAMED. This page shows two of these maps, of electorates
                      that differ; a marker with no round on it answers an unstated question. */}
                  <div className="opacity-70">
                    {t("election_round", { round })}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
      {/* ⚠ THE OMISSION IS COUNTED, not hidden — see the header. */}
      <p className="mt-1 text-xs text-muted-foreground" data-map-basis>
        {unplaced > 0
          ? t("presidential_sections_map_note_partial", {
              shown: points.length,
              total: leaders.size,
            })
          : t("presidential_sections_map_note", { total: points.length })}
      </p>
    </div>
  );
};
