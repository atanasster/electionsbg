import { FC } from "react";
import { useTranslation } from "react-i18next";
import type {
  RiskComponentId,
  RiskScoreRow,
} from "@/data/riskScore/useRiskScore";
import { formatPct } from "@/data/utils";

// SHAP-style horizontal contribution chart — each signal pushes the
// section's score up by its weighted contribution. Stacked horizontally
// so the eye reads "this is which signal contributed how much" without
// having to read numbers. Each bar is labeled with the signal name and
// its raw value so a journalist can ground-truth against the underlying
// reports.

import { SIGNAL_COLORS } from "./signalColors";

const formatRaw = (id: RiskComponentId, raw?: number): string => {
  if (raw === undefined) return "—";
  switch (id) {
    case "recount":
      return formatPct(raw * 100, 1);
    case "suemgMismatch":
      return formatPct(raw * 100, 1);
    case "invalidBallots":
    case "additionalVoters":
      return formatPct(raw, 1);
    case "concentrated":
      return formatPct(raw, 1);
    case "peerOutlier":
    case "swing":
      return `${raw.toFixed(2)}σ`;
  }
};

export const RiskWaterfall: FC<{ row: RiskScoreRow }> = ({ row }) => {
  const { t } = useTranslation();
  // Sort contributions so the largest bar is on the left — readers scan
  // left-to-right and the dominant signal is what they should learn first.
  const sorted = [...row.components].sort(
    (a, b) => b.contribution - a.contribution,
  );
  const total = sorted.reduce((s, c) => s + c.contribution, 0);

  return (
    <div className="space-y-2">
      {/* Stacked horizontal bar — visual sum of contributions */}
      <div className="flex h-4 w-full overflow-hidden rounded-md border bg-muted/30">
        {sorted.map((c) => (
          <div
            key={c.id}
            className="h-full transition-all"
            style={{
              width: `${(c.contribution / Math.max(total, 1)) * 100}%`,
              background: SIGNAL_COLORS[c.id],
            }}
            title={`${t(`risk_signal_${c.id}`)} +${c.contribution.toFixed(1)}`}
          />
        ))}
      </div>

      {/* Per-signal breakdown */}
      <ul className="space-y-1.5">
        {sorted.map((c) => (
          <li
            key={c.id}
            className="grid grid-cols-[12px_minmax(0,1fr)_auto_auto] items-center gap-x-3 text-xs"
          >
            <span
              className="block w-3 h-3 rounded-sm shrink-0"
              style={{ background: SIGNAL_COLORS[c.id] }}
            />
            <div className="min-w-0">
              <div className="truncate font-medium">
                {t(`risk_signal_${c.id}`)}
              </div>
              <div className="truncate text-[10px] text-muted-foreground">
                {t(`risk_signal_${c.id}_caption`)}
              </div>
            </div>
            <span className="tabular-nums text-muted-foreground font-mono text-[11px]">
              {formatRaw(c.id, c.rawValue)}
            </span>
            <span className="tabular-nums text-foreground font-semibold font-mono">
              +{c.contribution.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
