import { ReactNode } from "react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";

export const SVGMapContainer = ({
  size,
  children,
}: {
  size: MapCoordinates;
  children: ReactNode;
}) => {
  return (
    <svg
      className="absolute top-0 left-0 overflow-hidden bg-transparent"
      width={size[0]}
      height={size[1]}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${size[0]} ${size[1]}`}
    >
      <defs>
        <filter id="colored-bg" x="-5%" width="110%" y="0%" height="100%">
          <feFlood floodColor="rgba(0,0,0,0.5)" />
          <feComposite operator="over" in="SourceGraphic"></feComposite>
        </filter>
      </defs>
      {children}
    </svg>
  );
};
