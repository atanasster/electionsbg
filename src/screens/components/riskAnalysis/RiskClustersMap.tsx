import { FC, useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  useMap,
} from "react-leaflet";
import { LatLngBoundsExpression } from "leaflet";

// Dynamic import keeps leaflet's CSS out of the render-blocking entry HTML;
// see SectionsMap.tsx / LeafletMap.tsx for the rationale.
import("leaflet/dist/leaflet.css");
import { useTranslation } from "react-i18next";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import type { RiskMapSection } from "@/data/riskScore/useRiskClusters";
import { BAND_COLOR } from "@/screens/components/riskScore/bandColors";
import { useNavigateParams } from "@/ux/useNavigateParams";

// Re-fit the viewport whenever the marker set changes (e.g. the user
// toggles a band off) — MapContainer only honours `bounds` on mount.
const FitBounds: FC<{ bounds: LatLngBoundsExpression }> = ({ bounds }) => {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [20, 20] });
  }, [map, bounds]);
  return null;
};

// Geographic plot of every elevated-or-above section. Sections that belong
// to a detected cluster are drawn larger with a dark ring so the knots
// stand out from the scattered lone outliers.
export const RiskClustersMap: FC<{
  sections: RiskMapSection[];
  size: MapCoordinates;
}> = ({ sections, size }) => {
  const { t } = useTranslation();
  const navigate = useNavigateParams();

  const bounds: LatLngBoundsExpression | undefined = useMemo(() => {
    if (!sections.length) return undefined;
    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;
    sections.forEach((s) => {
      if (s.lat < minLat) minLat = s.lat;
      if (s.lat > maxLat) maxLat = s.lat;
      if (s.lng < minLng) minLng = s.lng;
      if (s.lng > maxLng) maxLng = s.lng;
    });
    return [
      [minLat, minLng],
      [maxLat, maxLng],
    ];
  }, [sections]);

  if (!sections.length || !bounds) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground"
        style={{ height: `${size[1]}px`, width: `${size[0]}px` }}
      >
        {t("no_map_data")}
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
        <FitBounds bounds={bounds} />
        {sections.map((s) => {
          const color = BAND_COLOR[s.band];
          const clustered = !!s.clusterId;
          return (
            <CircleMarker
              key={s.section}
              center={[s.lat, s.lng]}
              radius={clustered ? 7 : 4}
              pathOptions={{
                color: clustered ? "#1f2937" : color,
                fillColor: color,
                fillOpacity: clustered ? 0.85 : 0.55,
                weight: clustered ? 2 : 1,
              }}
              eventHandlers={{
                click: () => navigate({ pathname: `/section/${s.section}` }),
              }}
            >
              <Tooltip
                direction="auto"
                offset={[0, -4]}
                className="section-tooltip"
              >
                <div className="text-left">
                  <div className="text-sm text-center font-semibold pb-0.5">
                    {s.section}
                  </div>
                  <div className="text-xs text-center">
                    {t(`risk_band_${s.band}`)} · {Math.round(s.score)}
                  </div>
                  {clustered && (
                    <div className="text-[10px] text-center text-negative pt-0.5">
                      {t("risk_cluster_member")}
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
