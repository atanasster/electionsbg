// A cabinet (governments) timeline strip aligned under a simple date-axis chart.
// Wraps the shared CabinetStrip: fetches the cabinets, filters them to the
// chart's visible [fromDate, toDate] window, converts to the fractional-year
// x-domain CabinetStrip expects, and pads left/right so the coloured bands line
// up with the plot area of a Recharts chart above it (padLeft = the chart's left
// margin + YAxis width; padRight = the chart's right margin). Any date-based
// trend chart can drop this in for "which government was in office" context —
// first used under the /consumption/fuel price chart.
//
// CabinetStrip clamps each cabinet's tenure to the passed xDomain, so a cabinet
// that started before fromDate (or is still in office past toDate) still tiles
// edge-to-edge across exactly the window while its tooltip keeps the real dates.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useGovernments } from "@/data/governments/useGovernments";
import { toFractionalYear } from "@/screens/components/governments/governmentTimelineUtils";
import { CabinetStrip } from "@/screens/components/governments/GovernmentTimeline";

export const ChartCabinetStrip: FC<{
  /** ISO date of the chart's first x value. */
  fromDate: string;
  /** ISO date of the chart's last x value. */
  toDate: string;
  /** Left inset px to align with the plot area = chart left margin + YAxis width. */
  padLeft?: number;
  /** Right inset px = chart right margin. */
  padRight?: number;
  className?: string;
}> = ({ fromDate, toDate, padLeft = 0, padRight = 0, className }) => {
  const { i18n } = useTranslation();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";
  const { data: governments } = useGovernments();

  if (!fromDate || !toDate || !governments?.length) return null;
  const x0 = toFractionalYear(fromDate);
  const x1 = toFractionalYear(toDate);
  if (!(x1 > x0)) return null;

  // Cabinets that overlap the window (CabinetStrip clamps their widths to it).
  const inWindow = governments.filter((g) => {
    const s = toFractionalYear(g.startDate);
    const e = g.endDate ? toFractionalYear(g.endDate) : x1;
    return e > x0 && s < x1;
  });
  if (!inWindow.length) return null;

  return (
    <div
      className={className}
      style={{ paddingLeft: padLeft, paddingRight: padRight }}
    >
      <CabinetStrip
        governments={inWindow}
        xDomain={[x0, x1]}
        lang={lang}
        fullWidth
      />
    </div>
  );
};
