// The 4 procurement headline KPIs (contracts, total awarded, contractors,
// connected people), scoped to the active ?pscope window. Extracted so both the
// /procurement hub and the /procurement/overview analytics page show the same
// at-a-glance strip from one deduped useProcurementOverview call. Renders a
// skeleton while loading and nothing when the window has no contracts (the host
// page owns the empty-state messaging).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Receipt, Users, Building2, Coins } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useProcurementOverview } from "@/data/procurement/useProcurementOverview";
import { formatEur } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");

const SkeletonCard: FC = () => (
  <div className="h-[140px] animate-pulse rounded-xl border bg-card p-4 shadow-sm">
    <div className="mb-3 h-3 w-24 rounded bg-muted" />
    <div className="h-7 w-32 rounded bg-muted" />
  </div>
);

export const ProcurementKpiRow: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useProcurementOverview();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }
  if (!data || data.totals.contracts === 0) return null;
  const totals = data.totals;

  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      data-og="procurement-stats"
    >
      <StatCard
        label={t("procurement_index_contracts") || "Contracts"}
        hint={
          t("procurement_index_contracts_hint") ||
          "Signed contracts + amendments within this election's period."
        }
      >
        <div className="flex items-baseline gap-2">
          <Receipt className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="text-2xl font-bold tabular-nums">
            {numFmt.format(totals.contracts + totals.amendments)}
          </span>
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {numFmt.format(totals.contracts)}{" "}
          {t("procurement_index_contracts_main") || "primary contracts"} +{" "}
          {numFmt.format(totals.amendments)}{" "}
          {t("procurement_index_amendments_full") ||
            "supplementary agreements (amendments)"}
        </div>
      </StatCard>

      <StatCard
        label={t("procurement_index_total_awarded") || "Total awarded"}
        hint={t("procurement_index_total_hint") || ""}
      >
        <div className="flex items-baseline gap-2">
          <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="text-2xl font-bold tabular-nums break-words lg:text-xl xl:text-2xl">
            {formatEur(totals.totalEur)}
          </span>
        </div>
      </StatCard>

      <StatCard
        label={t("procurement_index_contractors") || "Contractors"}
        hint={
          t("procurement_index_contractors_hint") ||
          "Distinct companies that won at least one contract in the period."
        }
      >
        <div className="flex items-baseline gap-2">
          <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="text-2xl font-bold tabular-nums">
            {numFmt.format(totals.contractorCount)}
          </span>
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {t("procurement_index_contractors_from") || "from"}{" "}
          {numFmt.format(totals.awarderCount)}{" "}
          {t("procurement_index_state_awarders") || "state awarders"}
        </div>
      </StatCard>

      <StatCard
        label={t("procurement_index_connected") || "Connected people"}
        hint={
          t("procurement_index_connected_hint") ||
          "MPs and public officials whose declared business interests intersect with contract winners during this period."
        }
        className="ring-1 ring-amber-200/60 dark:ring-amber-800/40"
      >
        <div className="flex items-baseline gap-2">
          <Users className="h-5 w-5 shrink-0 text-amber-600" />
          <span className="text-2xl font-bold tabular-nums">
            {numFmt.format((totals.mpCount ?? 0) + (totals.officialCount ?? 0))}
          </span>
          <span className="text-sm text-muted-foreground">
            {t("procurement_index_connected_people") || "people"}
          </span>
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {numFmt.format(totals.mpCount ?? 0)}{" "}
          {t("procurement_index_mp_count_short") || "MPs"} ·{" "}
          {numFmt.format(totals.officialCount ?? 0)}{" "}
          {t("procurement_index_officials_count") || "officials"}
        </div>
        <div className="text-xs font-medium tabular-nums">
          {formatEur(totals.connectedTotalEur ?? 0)}
        </div>
      </StatCard>
    </div>
  );
};
