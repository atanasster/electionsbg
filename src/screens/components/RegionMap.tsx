import { RegionFeature } from "@/data/mapTypes";
import { useState } from "react";

export const RegionMap: React.FC<
  React.PropsWithChildren<{
    path: d3.GeoPath;
    name: string;
    fillColor?: string;
    feature: RegionFeature;
    onCursor?: () => string;
    onMouseEnter?: (e: React.MouseEvent<SVGPathElement, MouseEvent>) => void;
    onMouseMove?: (e: React.MouseEvent<SVGPathElement, MouseEvent>) => void;
    onMouseLeave?: (e: React.MouseEvent<SVGPathElement, MouseEvent>) => void;
    onClick?: (e: React.MouseEvent<SVGPathElement, MouseEvent>) => void;
  }>
> = ({
  path,
  name,
  feature,
  fillColor = "grey",
  onCursor,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  onClick,
}) => {
  const [active, setActive] = useState<boolean>(false);
  return (
    <path
      fill={fillColor}
      stroke="rgb(182, 182, 182)"
      strokeWidth={active ? 2.5 : 1}
      cursor={onCursor ? onCursor() : "pointer"}
      id={name}
      className="path"
      onMouseEnter={(e) => {
        setActive(true);
        if (onMouseEnter) onMouseEnter(e);
      }}
      onMouseMove={(e) => {
        if (onMouseMove) onMouseMove(e);
      }}
      onMouseLeave={(e) => {
        setActive(false);
        if (onMouseLeave) onMouseLeave(e);
      }}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      d={path(feature as any) as string}
      onClick={(e) => {
        if (onClick) onClick(e);
      }}
      //style={{ filter: active ? "drop-shadow(2px 2px 1px rgb(5, 5, 5)" : "" }}
    />
  );
};
