import { FC, useMemo } from "react";
import { cn } from "@/lib/utils";

type Props = {
  values: number[];
  color?: string;
  className?: string;
  ariaLabel?: string;
  showEndDot?: boolean;
};

// Lightweight inline-SVG sparkline. Renders a filled area under a polyline.
// Avoids Recharts so it can be used per-row in tables without paying the
// vendor-charts bundle cost or the per-instance render overhead.
export const Sparkline: FC<Props> = ({
  values,
  color = "currentColor",
  className,
  ariaLabel,
  showEndDot = true,
}) => {
  const { linePath, areaPath, endPoint } = useMemo(() => {
    if (values.length === 0) {
      return { linePath: "", areaPath: "", endPoint: null };
    }
    const W = 100;
    const H = 32;
    const PAD_Y = 2;
    const max = Math.max(...values, 1);
    // Single-point edge case — center it.
    const stepX = values.length > 1 ? W / (values.length - 1) : 0;
    const points = values.map((v, i) => {
      const x = values.length > 1 ? i * stepX : W / 2;
      const ratio = v / max;
      const y = H - PAD_Y - ratio * (H - 2 * PAD_Y);
      return [x, y] as const;
    });
    const line = points
      .map(
        ([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`,
      )
      .join(" ");
    const area = `${line} L${points[points.length - 1][0].toFixed(2)},${H} L${points[0][0].toFixed(2)},${H} Z`;
    return {
      linePath: line,
      areaPath: area,
      endPoint: points[points.length - 1],
    };
  }, [values]);

  if (values.length === 0) return null;

  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      className={cn("inline-block w-full h-8", className)}
    >
      <path d={areaPath} fill={color} fillOpacity={0.18} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {showEndDot && endPoint && (
        <circle
          cx={endPoint[0]}
          cy={endPoint[1]}
          r={1.8}
          fill={color}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
};
