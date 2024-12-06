import { GeoFeature } from "@/data/mapTypes";
import { useRef, useState } from "react";

export const FeatureMap: React.FC<
  React.PropsWithChildren<
    React.ComponentProps<"path"> & {
      geoPath: d3.GeoPath;
      name: string;
      fillColor?: string;
      feature: GeoFeature;
      onClick?: () => void;
      onCursor?: () => string;
    }
  >
> = ({
  geoPath,
  name,
  feature,
  fillColor = "grey",
  onCursor,
  onClick,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  onTouchEnd,
}) => {
  const [active, setActive] = useState<boolean>(false);
  const [isLongPress, setIsLongPress] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const handleTouchStart = () => {
    timerRef.current = setTimeout(() => {
      setIsLongPress(true);
    }, 500);
  };

  const handleTouchEnd = (e: React.TouchEvent<SVGPathElement>) => {
    clearTimeout(timerRef.current);
    if (isLongPress) {
      // Handle long press
      if (onTouchEnd) onTouchEnd(e);
    } else if (onClick) {
      onClick();
    }
    setIsLongPress(false);
  };
  return (
    <>
      <path
        fill={fillColor}
        stroke="rgb(182, 182, 182)"
        strokeWidth={active ? 2.5 : 1}
        cursor={onCursor ? onCursor() : "pointer"}
        id={name}
        className="path"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
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
        d={geoPath(feature as any) as string}
        onClick={(e) => {
          if (onClick) onClick(e);
        }}
      />
    </>
  );
};
