// Route map for a project file (§10 Phase 3, Tier D). When a curated file carries
// a `geo.line` polyline, the dossier renders this small Leaflet map above the
// timeline so a linear object (a motorway, a rail section) shows *where* it runs,
// not just its money. Self-contained (its own MapContainer + a single Polyline +
// shared fit-to-bounds), lazy-loaded by the screen so Leaflet only ships when a
// file has geometry, and client-mount-guarded so it never renders during prerender.
//
// Coordinates are [lat, lng] (Leaflet's native order), matching the spec's
// `geo.line`. The geometry is curated + sourced (an approximate corridor is
// labelled as such by the caller); it is never auto-derived from contract text.

import { FC, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import { FitBounds } from "@/screens/components/maps/FitBounds";
import { routeBounds } from "@/screens/components/maps/routeBounds";

// Leaflet's stylesheet is loaded dynamically so it lands in its own chunk; see
// LeafletMap.tsx for the rationale.
import("leaflet/dist/leaflet.css");

export const ProjectRouteMap: FC<{
  /** The route as [lat, lng] points (≥2). */
  line: [number, number][];
  height?: number;
  color?: string;
  /** Accessible name for the map region (e.g. the project title + "route"). */
  ariaLabel?: string;
}> = ({ line, height = 320, color = "#1D9E75", ariaLabel }) => {
  // Client-only: never construct a Leaflet map during SSR/prerender.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const bounds = useMemo(() => routeBounds(line), [line]);

  if (!mounted || !bounds) return null;
  return (
    <div
      className="w-full overflow-hidden rounded-xl border"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      <MapContainer
        className="h-full w-full"
        bounds={bounds}
        boundsOptions={{ padding: [24, 24] }}
        scrollWheelZoom={false}
      >
        <FitBounds bounds={bounds} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline
          positions={line}
          pathOptions={{ color, weight: 5, opacity: 0.85 }}
        />
      </MapContainer>
    </div>
  );
};

export default ProjectRouteMap;
