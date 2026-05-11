import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";

// Shared inset values consumed by CabinetStrip and the chart components.
// Keeping these in one place is what keeps the cabinet pills above the plot
// area aligned with the chart's X-axis below — they must total the same
// left/right offset.
//
//   left  = chart YAxis.width + LineChart margin.left  = strip paddingLeft
//   right = LineChart margin.right                     = strip paddingRight
//
// On phone-width viewports the desktop 44/32 padding eats ~20% of the
// container — too much. We shrink the YAxis tick labels, drop the left
// margin to zero, and shrink the right margin proportionally.

export type ChartInsets = {
  yAxisWidth: number;
  marginLeft: number;
  marginRight: number;
  paddingLeft: number;
  paddingRight: number;
};

// yAxisWidth has to fit signed 3-digit tick labels at fontSize 11 — "-30%"
// and similar — which Recharts measures at ~36px including its internal
// padding. We keep yAxisWidth equal to desktop so labels never clip; the
// mobile gain comes from dropping marginLeft (8→0) and shrinking the
// right margin (32→16). Strip paddingLeft stays in sync with chart's
// (marginLeft + yAxisWidth).
export const CHART_INSETS_MOBILE: ChartInsets = {
  yAxisWidth: 36,
  marginLeft: 0,
  marginRight: 16,
  paddingLeft: 36,
  paddingRight: 16,
};

export const CHART_INSETS_DESKTOP: ChartInsets = {
  yAxisWidth: 36,
  marginLeft: 8,
  marginRight: 32,
  paddingLeft: 44,
  paddingRight: 32,
};

export const useChartInsets = (): ChartInsets => {
  const isSmall = useMediaQueryMatch("sm");
  return isSmall ? CHART_INSETS_MOBILE : CHART_INSETS_DESKTOP;
};
