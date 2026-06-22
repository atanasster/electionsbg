import { GeoFeature } from "@/screens/components/maps/mapTypes";
import { useTouch } from "@/ux/TouchProvider";
import { useRef, useState } from "react";

export const FeatureMap: React.FC<
  React.PropsWithChildren<
    React.ComponentProps<"path"> & {
      geoPath: d3.GeoPath;
      fillColor?: string;
      feature: GeoFeature;
      onClick?: () => void;
      onCursor?: () => string;
      opacity?: number;
      // Opt-in keyboard access: when set (alongside onClick), the region
      // becomes a focusable button — Tab to it, Enter/Space to activate, with a
      // visible focus ring. Left undefined for the high-cardinality section
      // maps (thousands of paths) where a giant tab order would hurt; the
      // low-count choropleths (28 oblasts) opt in.
      ariaLabel?: string;
    }
  >
> = ({
  geoPath,
  feature,
  fillColor = "grey",
  onCursor,
  onClick,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  opacity,
  ariaLabel,
}) => {
  const [active, setActive] = useState<boolean>(false);
  const keyboard = !!ariaLabel && !!onClick;
  const [isLongPress, setIsLongPress] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const isTouch = useTouch();
  const handleTouchStart = (e: React.TouchEvent<SVGPathElement>) => {
    timerRef.current = setTimeout(() => {
      setIsLongPress(false);
      handleMouseEnter({
        pageX: e.touches[0].pageX,
        pageY: e.touches[0].pageY,
      } as unknown as React.MouseEvent<SVGPathElement>);
    }, 1500);
  };

  const handleTouchEnd = () => {
    clearTimeout(timerRef.current);
    if (isLongPress) {
      setActive(false);
    }
    setIsLongPress(false);
  };

  const handleMouseEnter = (e: React.MouseEvent<SVGPathElement>) => {
    setActive(true);
    if (onMouseEnter) onMouseEnter(e);
  };

  return (
    <g>
      <path
        fill={fillColor}
        fillOpacity={opacity}
        onContextMenu={(e) => e.preventDefault()}
        stroke="hsl(var(--border))"
        strokeWidth={active ? 2.5 : 1}
        cursor={onCursor ? onCursor() : "pointer"}
        // Keyboard focus ring via CSS :focus-visible (index.css) when the
        // region opts into keyboard access.
        className={keyboard ? "path kbd-focus-ring" : "path"}
        tabIndex={keyboard ? 0 : undefined}
        role={keyboard ? "button" : undefined}
        aria-label={keyboard ? ariaLabel : undefined}
        onKeyDown={
          keyboard
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick?.();
                }
              }
            : undefined
        }
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseEnter={handleMouseEnter}
        onMouseMove={(e) => {
          if (onMouseMove) onMouseMove(e);
        }}
        onMouseLeave={(e) => {
          setActive(false);
          if (!isTouch) {
            if (onMouseLeave) onMouseLeave(e);
          }
        }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        d={geoPath(feature as any) as string}
        onClick={(e) => {
          if (onClick) onClick(e);
        }}
      />
    </g>
  );
};
