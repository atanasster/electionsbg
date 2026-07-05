import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PieChart } from "lucide-react";
import { formatEur } from "@/lib/currency";
import { StatCard } from "@/screens/dashboard/StatCard";
import { PartyFinancingRow } from "@/data/financing/usePartiesFinancing";
import { PartyChip, SourceLegend } from "./financingShared";
import {
  SOURCE_COLOR,
  SOURCE_KEYS,
  SOURCE_LABEL_KEY,
  SourceKey,
} from "./financingConstants";

const value = (row: PartyFinancingRow, k: SourceKey): number =>
  k === "parties"
    ? row.fromParties
    : k === "donors"
      ? row.fromDonors
      : k === "candidates"
        ? row.fromCandidates
        : row.media;

// 100%-normalised stacked bars: each party's bar is full width (mix always
// readable), the € total is labelled at the end (scale). National = one bar per
// party; per-party = a single bar.
export const FundingMixBars: FC<{
  rows: PartyFinancingRow[];
  title?: string;
  hint?: string;
  bodyMaxHeight?: string;
  // On a party's own page the per-row party chip is redundant.
  hideChip?: boolean;
}> = ({ rows, title, hint, bodyMaxHeight, hideChip }) => {
  const { t, i18n } = useTranslation();
  const labels = useMemo(
    () =>
      Object.fromEntries(
        SOURCE_KEYS.map((k) => [k, t(SOURCE_LABEL_KEY[k])]),
      ) as Record<SourceKey, string>,
    [t],
  );
  const shown = rows.filter((r) => r.total > 0);
  if (shown.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <PieChart className="h-4 w-4" />
          <span>{title ?? t("financing_mix")}</span>
        </div>
      }
      hint={hint ?? t("financing_mix_hint")}
      bodyMaxHeight={bodyMaxHeight}
    >
      <div className="mb-2 mt-1">
        <SourceLegend labels={labels} />
      </div>
      <div className="flex flex-col gap-3">
        {shown.map((r) => (
          <div key={r.party} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              {hideChip ? (
                <span className="text-xs text-muted-foreground">
                  {t("income")}
                </span>
              ) : (
                <PartyChip party={r.info} />
              )}
              <span className="tabular-nums text-xs font-semibold">
                {formatEur(r.total, i18n.language)}
              </span>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              {SOURCE_KEYS.map((k) => {
                const v = value(r, k);
                const pct = r.total > 0 ? (100 * v) / r.total : 0;
                if (pct <= 0) return null;
                return (
                  <div
                    key={k}
                    className="h-full"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: SOURCE_COLOR[k],
                    }}
                    title={`${labels[k]}: ${formatEur(v, i18n.language)} (${pct.toFixed(0)}%)`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
