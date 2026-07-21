// Shared Leaflet child that fits the map view to a bounds box once the container
// has a non-zero size — a map mounted in a hidden / zero-height box would otherwise
// fit to nothing. One-shot (a `done` flag), driven by a ResizeObserver so it fires
// as soon as layout settles. Used by SectorPointMap and the project route map.

import { FC, useEffect } from "react";
import { useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";

export const FitBounds: FC<{
  bounds: LatLngBoundsExpression;
  padding?: [number, number];
}> = ({ bounds, padding = [24, 24] }) => {
  const map = useMap();
  const [px, py] = padding;
  useEffect(() => {
    const el = map.getContainer();
    let done = false;
    const fit = () => {
      if (done || el.clientHeight <= 0 || el.clientWidth <= 0) return;
      done = true;
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [px, py] });
      ro.disconnect();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [map, bounds, px, py]);
  return null;
};
