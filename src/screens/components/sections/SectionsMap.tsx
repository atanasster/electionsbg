import { FC, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { LatLngBoundsExpression } from "leaflet";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { SectionInfo } from "@/data/dataTypes";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useTranslation } from "react-i18next";

export const SectionsMap: FC<{
  sections: SectionInfo[];
  size: MapCoordinates;
}> = ({ sections, size }) => {
  const { t } = useTranslation();
  const { topVotesParty } = usePartyInfo();

  const points = useMemo(
    () =>
      sections.filter(
        (s) => typeof s.longitude === "number" && typeof s.latitude === "number",
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
          const color = topParty?.color || "lightslategrey";
          const totalVotes = s.results.votes.reduce(
            (a, v) => a + (v.totalVotes || 0),
            0,
          );
          return (
            <CircleMarker
              key={s.section}
              center={[s.latitude as number, s.longitude as number]}
              radius={6}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.7,
                weight: 1,
              }}
            >
              <Tooltip direction="top" offset={[0, -4]}>
                <div className="text-xs">
                  <div className="font-semibold">{s.section}</div>
                  {s.address && <div>{s.address}</div>}
                  {topParty && (
                    <div>
                      <span
                        className="inline-block w-2 h-2 mr-1 rounded-full align-middle"
                        style={{ backgroundColor: color }}
                      />
                      {topParty.nickName} — {totalVotes} {t("votes") || "votes"}
                    </div>
                  )}
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
};
