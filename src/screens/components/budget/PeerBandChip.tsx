// Small inline chip that places a Bulgarian value inside the EU distribution.
// Used on the headline cards and on each COFOG row to give every figure on
// the /budget page a one-line peer reference: "BG 2.9% · EU avg 6.1% · 25/27".
//
// The "bar" is a 1D scatter: BG dot positioned by rank within the n member
// states that reported. A faint amber tick marks the EU27 average for context.
// All three readings are intentional — number, rank, visual position — so the
// chip stays meaningful even when the cell next to it is small.

import { FC } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  bgValue: number;
  euAvg: number | null;
  rank: number;
  total: number;
  // How to format the raw values (different across COFOG % of GDP vs.
  // headline % of total). Kept as a function so the chip stays presentational.
  format?: (value: number) => string;
  // Tooltip year hint, e.g. "2024".
  year?: number | null;
  // Optional CSS class for layout placement inside the parent row.
  className?: string;
}

const defaultFmt = (v: number): string => `${v.toFixed(1)}%`;

export const PeerBandChip: FC<Props> = ({
  bgValue,
  euAvg,
  rank,
  total,
  format = defaultFmt,
  year,
  className,
}) => {
  const { t } = useTranslation();
  // Position 0..1 on the bar. Rank 1 = highest = right edge; rank=total = left.
  const pos = total > 1 ? 1 - (rank - 1) / (total - 1) : 0.5;
  // EU-avg tick is decorative — its job is to tell direction ("BG is below EU"
  // vs "above"), not absolute distribution position. Offset a fixed nudge to
  // either side of the BG dot based on the sign of (euAvg − bgValue). This
  // works correctly for negative bgValue (deficit metrics) too.
  const tickPos =
    euAvg != null
      ? Math.max(0.05, Math.min(0.95, pos + Math.sign(euAvg - bgValue) * 0.18))
      : null;
  const rankCopy = `${t("budget_peer_rank") || "rank"} ${rank}/${total}`;
  const yearCopy = year ? ` · ${year}` : "";

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums ${className ?? ""}`}
      title={`${t("budget_peer_tooltip_bg") || "BG"} ${format(bgValue)}${euAvg != null ? ` · ${t("budget_peer_tooltip_eu_avg") || "EU27 average"} ${format(euAvg)}` : ""} · ${rankCopy}${yearCopy}`}
    >
      <span className="relative inline-block h-1 w-12 rounded-full bg-muted overflow-hidden">
        {tickPos != null ? (
          <span
            className="absolute top-1/2 -translate-y-1/2 h-2 w-px bg-amber-500/70"
            style={{ left: `${tickPos * 100}%` }}
          />
        ) : null}
        <span
          className="absolute top-1/2 -translate-y-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-indigo-500 ring-2 ring-card"
          style={{ left: `${pos * 100}%` }}
        />
      </span>
      <span>{rankCopy}</span>
    </span>
  );
};
