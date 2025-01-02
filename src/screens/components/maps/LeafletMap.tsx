import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { FC, PropsWithChildren } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { zoomFromScale } from "./d3_utils";

export const LeafletMap: FC<
  PropsWithChildren<{
    size: MapCoordinates;
    scale: number;
    bounds: [[number, number], [number, number]];
  }>
> = ({ size, bounds, children, scale }) => {
  if (scale == 0) {
    return null;
  }
  const zoomLevel = zoomFromScale(scale);

  return (
    <div
      className={`absolute top-0 left-0`}
      style={{
        height: `${size[1]}px`,
        width: `${size[0]}px`,
      }}
    >
      <MapContainer
        key={JSON.stringify(scale)}
        className="w-full h-full"
        zoom={zoomLevel}
        center={[
          (bounds[1][1] + bounds[0][1]) / 2,
          (bounds[1][0] + bounds[0][0]) / 2,
        ]}
        dragging={false}
        zoomControl={false}
        doubleClickZoom={false}
        touchZoom={false}
        boxZoom={false}
        scrollWheelZoom={false}
        zoomSnap={0}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {children}
      </MapContainer>
    </div>
  );
};
