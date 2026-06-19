import { FC, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import { LatLngBoundsExpression } from "leaflet";

// Dynamic import keeps leaflet's CSS out of the render-blocking entry HTML;
// see LeafletMap.tsx / SectionsMap.tsx for the rationale.
import("leaflet/dist/leaflet.css");
import { useTranslation } from "react-i18next";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { formatThousands } from "@/data/utils";
import type { LocalSectionResult } from "@/data/local/types";

type Legend = Map<number, { name: string; color: string }>;

// Per-station section map for a local município — the local-elections
// counterpart of SectionsMap. One dot per polling station, coloured by the
// leading ballot list (`selectVotes(s)[0]`); click drills into the local
// section page. The same component plots either ballot: the caller supplies the
// vote selector (council `partyVotes` / mayor `mayorVotes` / район
// `rayonMayorVotes`), the matching legend, and the %-of-valid denominator.
// Coordinates are backfilled from the parliamentary section archive (see
// scripts/parsers_local/backfill_local_section_coords.ts), so sections without
// a match are silently skipped.
export const LocalSectionsMap: FC<{
  sections: LocalSectionResult[];
  legend: Legend;
  selectVotes: (
    s: LocalSectionResult,
  ) => { localPartyNum: number; votes: number }[];
  total: (s: LocalSectionResult) => number;
  size: MapCoordinates;
  cycle: string;
  obshtinaCode: string;
}> = ({ sections, legend, selectVotes, total, size, cycle, obshtinaCode }) => {
  const { t } = useTranslation();
  const navigate = useNavigateParams();

  const points = useMemo(
    () =>
      sections.filter(
        (s) =>
          typeof s.longitude === "number" && typeof s.latitude === "number",
      ),
    [sections],
  );

  const bounds: LatLngBoundsExpression | undefined = useMemo(() => {
    if (!points.length) return undefined;
    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;
    points.forEach((s) => {
      const lat = s.latitude as number;
      const lng = s.longitude as number;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    });
    return [
      [minLat, minLng],
      [maxLat, maxLng],
    ];
  }, [points]);

  if (!points.length || !bounds) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground"
        style={{ height: `${size[1]}px`, width: `${size[0]}px` }}
      >
        {t("no_map_data") || "No map data"}
      </div>
    );
  }

  return (
    <div
      className="relative"
      style={{ height: `${size[1]}px`, width: `${size[0]}px` }}
    >
      <MapContainer
        className="w-full h-full"
        bounds={bounds}
        boundsOptions={{ padding: [20, 20] }}
        scrollWheelZoom
        // Render the markers on a single canvas instead of one SVG node each —
        // Sofia has ~1,640 stations, which is far smoother as canvas.
        preferCanvas
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map((s) => {
          const votes = selectVotes(s);
          const lead = votes[0];
          const leadParty = lead ? legend.get(lead.localPartyNum) : undefined;
          const fillColor = leadParty?.color || "lightslategrey";
          const denom = total(s);
          return (
            <CircleMarker
              key={s.sectionCode}
              center={[s.latitude as number, s.longitude as number]}
              radius={6}
              pathOptions={{
                color: fillColor,
                fillColor,
                fillOpacity: 0.7,
                weight: 1,
              }}
              eventHandlers={{
                click: () =>
                  navigate({
                    pathname: `/local/${cycle}/${obshtinaCode}/section/${s.sectionCode}`,
                  }),
              }}
            >
              <Tooltip direction="auto" offset={[0, -4]}>
                {/* Cap the width + allow wrapping: a long unconstrained address
                    used to blow the tooltip wide enough to clip at the map's
                    edge (Leaflet tooltips don't auto-pan back into view). */}
                <div
                  className="text-left"
                  style={{ maxWidth: 230, whiteSpace: "normal" }}
                >
                  <div className="text-sm text-center font-semibold pb-1">
                    {s.sectionCode}
                  </div>
                  <div className="text-xs text-center pb-1 opacity-90 break-words">
                    {s.address || s.settlement}
                  </div>
                  <table className="w-full border-collapse text-[11px] leading-tight">
                    <tbody>
                      {votes.slice(0, 4).map((pv) => {
                        const p = legend.get(pv.localPartyNum);
                        const pct = denom > 0 ? (100 * pv.votes) / denom : 0;
                        return (
                          <tr key={pv.localPartyNum} className="font-medium">
                            <td className="py-0.5 pr-2">
                              <div className="flex items-center gap-1.5 max-w-[150px]">
                                <span
                                  aria-hidden
                                  className="inline-block h-2 w-2 rounded-sm shrink-0"
                                  style={{ backgroundColor: p?.color }}
                                />
                                <span className="truncate">
                                  {p?.name ?? `№ ${pv.localPartyNum}`}
                                </span>
                              </div>
                            </td>
                            <td className="py-0.5 pr-2 text-right tabular-nums opacity-90">
                              {formatThousands(pv.votes)}
                            </td>
                            <td className="py-0.5 text-right tabular-nums font-semibold">
                              {pct.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
};
