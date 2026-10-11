import type { GeoPath } from "d3-geo";
import { GeoFeature } from "@/screens/components/maps/mapTypes";
import { useTouch } from "@/ux/TouchProvider";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export const FeatureMap: React.FC<
  React.PropsWithChildren<
    React.ComponentProps<"path"> & {
      geoPath: GeoPath;
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
      // Opt-in re-fill transition (`.motion-fill`, docs/plans/motion-v1.md). Off by
      // default: a fill transition repaints every path for its whole duration, which the
      // high-cardinality maps cannot afford, and a caller that paints a placeholder fill
      // while loading must not fade from it. Pass it only once the real fill is known.
      animateFill?: boolean;
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
  animateFill = false,
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
        className={cn(
          "path",
          animateFill && "motion-fill",
          keyboard && "kbd-focus-ring",
        )}
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
