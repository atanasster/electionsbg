import { FC, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { LatLngBoundsExpression } from "leaflet";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { SectionInfo } from "@/data/dataTypes";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useTranslation } from "react-i18next";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { PartyVotesXS } from "../PartyVotesXS";

export const SectionsMap: FC<{
  sections: SectionInfo[];
  size: MapCoordinates;
  markerVariant?: "default" | "problem";
  tooltipBadge?: string;
}> = ({ sections, size, markerVariant = "default", tooltipBadge }) => {
  const { t } = useTranslation();
  const { topVotesParty } = usePartyInfo();
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
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map((s) => {
          const topParty = topVotesParty(s.results.votes);
          const fillColor = topParty?.color || "lightslategrey";
          const isProblem = markerVariant === "problem";
          const strokeColor = isProblem ? "#dc2626" : fillColor;
          return (
            <CircleMarker
              key={s.section}
              center={[s.latitude as number, s.longitude as number]}
              radius={isProblem ? 8 : 6}
              pathOptions={{
                color: strokeColor,
                fillColor,
                fillOpacity: 0.7,
                weight: isProblem ? 3 : 1,
              }}
              eventHandlers={{
                click: () => navigate({ pathname: `/section/${s.section}` }),
              }}
            >
              <Tooltip
                direction="top"
                offset={[0, -4]}
                className="section-tooltip"
              >
                <div className="text-left">
                  {tooltipBadge && (
                    <div className="text-xs text-center font-semibold text-negative pb-1">
                      ⚠ {tooltipBadge}
                    </div>
                  )}
                  <div className="text-sm text-center font-semibold pb-1">
                    {s.section}
                  </div>
                  {s.address && (
                    <div className="text-xs text-center pb-1 opacity-90">
                      {s.address}
                    </div>
                  )}
                  <PartyVotesXS votes={s.results.votes} />
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
};
