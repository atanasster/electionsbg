// The shared analysis strip above every contracts DbDataTable: the four reactive
// KPI cards (Σ€ total, contract/annex count, single-bidder %, direct-award %) and
// the clickable "Вид процедура" procedure-mix bar. Used by both the global
// /procurement/contracts browser and the per-entity /company|/awarder screens —
// they differ only in the count-card label (Договори vs Анекси) and in what feeds
// the figures, so everything data-shaped is a prop:
//   • Σ€ / count ride the table's own aggregates (via onData) — reactive to the
//     free-text search too;
//   • single-bidder % / direct % + the mix bar ride /api/db/facets (see
//     useContractsAnalytics) — they do NOT move with the search box.
// This collapses two near-identical KPI+mix JSX blocks the two screens shared.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Coins, FileText, Users } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { ProcedureMixBar } from "@/screens/components/procurement/ProcedureMixBar";
import { formatEur, formatEurCompact } from "@/lib/currency";
import type { MethodBucketFacet, ProcedureBucket } from "@/lib/cpvSectors";

export const ContractsAnalysisStrip: FC<{
  /** Reactive headline total (Σ €) from the table's server-side aggregates. */
  sumAmountEur?: number;
  /** Reactive row count from the table's aggregates (or its total). */
  count?: number;
  /** Facet-derived integrity KPIs — null when there's no denominator. */
  singleBidPct: number | null;
  directPct: number | null;
  /** Procedure-mix buckets + the clickable filter state. */
  groupedMethods: MethodBucketFacet[];
  procBucket: ProcedureBucket | null;
  onSelectBucket: (b: ProcedureBucket | null) => void;
  /** The count card's label (e.g. "Договори" or "Анекси"). */
  countLabel: ReactNode;
}> = ({
  sumAmountEur,
  count,
  singleBidPct,
  directPct,
  groupedMethods,
  procBucket,
  onSelectBucket,
  countLabel,
}) => {
  const { t, i18n } = useTranslation();
  return (
    <>
      {/* Reactive headline KPIs (Σ€/count follow the filters AND the free-text
          search) + integrity KPIs (single-bidder / direct-award share; facet-
          based, so they don't move with the search box). */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("contracts_kpi_total") || "Обща стойност"}>
          <div className="flex items-baseline gap-2">
            <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span
              className="text-lg font-bold tabular-nums md:text-xl"
              title={formatEur(sumAmountEur ?? 0, i18n.language)}
            >
              {formatEurCompact(sumAmountEur ?? 0, i18n.language)}
            </span>
          </div>
        </StatCard>
        <StatCard label={countLabel}>
          <div className="flex items-baseline gap-2">
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="text-lg font-bold tabular-nums md:text-xl">
              {(count ?? 0).toLocaleString("bg-BG")}
            </span>
          </div>
        </StatCard>
        <StatCard
          label={t("contracts_stat_single_bid") || "1 оферта"}
          hint={
            t("contracts_stat_single_bid_hint") ||
            "Дял от договорите с известен брой оферти, спечелени с една оферта."
          }
        >
          <div className="flex items-baseline gap-2">
            <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="text-lg font-bold tabular-nums md:text-xl">
              {singleBidPct == null ? "—" : `${singleBidPct.toFixed(0)}%`}
            </span>
          </div>
        </StatCard>
        <StatCard
          label={t("contracts_stat_direct") || "Пряко възлагане"}
          hint={
            t("contracts_stat_direct_hint") ||
            "Дял от договорите с посочена процедура, възложени пряко / без обявление."
          }
        >
          <div className="flex items-baseline gap-2">
            <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="text-lg font-bold tabular-nums md:text-xl">
              {directPct == null ? "—" : `${directPct.toFixed(0)}%`}
            </span>
          </div>
        </StatCard>
      </div>

      {/* Procedure-mix overview — filter-scoped and clickable: a segment/chip
          toggles the same bucket filter that narrows the table. */}
      <div className="mb-4">
        <ProcedureMixBar
          buckets={groupedMethods}
          selected={procBucket}
          onSelect={onSelectBucket}
          title={t("contracts_procedure_mix") || "Вид процедура"}
          note={
            t("contracts_procedure_mix_note") ||
            "Дял от договорите с посочена процедура."
          }
        />
      </div>
    </>
  );
};
