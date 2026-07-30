// The 3 headline KPIs for /procurement/contractors.
//   1. Обща стойност (Σ€)   — REACTIVE: rides the table's server aggregate (onData),
//      so it moves with the CPV / MP-tied filters and the search box.
//   2. Концентрация (топ-10) — market concentration, from the per-scope blob.
//   3. Свързани с депутати   — share of value to MP-tied companies, from the blob.
// KPIs 2–3 are SCOPE-level (whole 'ALL' division), deliberately not reactive to the
// filters — same split the contracts browser uses. When a filter is active they carry
// a "за целия обхват" hint so they don't read as stale beside the reactive money card.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Coins, PieChart, Landmark } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEur, formatEurCompact } from "@/lib/currency";
import type { ContractorScopeKpis } from "@/data/procurement/useContractorScopeKpis";

const pct = (share: number | undefined): string =>
  share == null ? "—" : `${(share * 100).toFixed(1)}%`;

export const ContractorsKpiStrip: FC<{
  /** Reactive Σ€ from the table's server aggregate (onData). */
  sumTotalEur?: number;
  /** Per-scope KPI blob (null while loading or when the matview is absent). */
  kpis?: ContractorScopeKpis | null;
  /** A CPV / MP-tied filter is active → caption the scope-level cards. */
  filtersActive: boolean;
}> = ({ sumTotalEur, kpis, filtersActive }) => {
  const { t, i18n } = useTranslation();
  const scopeHint = filtersActive
    ? t("contractors_kpi_scope_hint") ||
      "За целия обхват — не се влияе от филтрите."
    : undefined;

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard
        label={t("contractors_kpi_total") || "Обща стойност"}
        hint={
          t("contractors_kpi_total_hint") ||
          "Сума на договорите в текущия обхват и филтри."
        }
      >
        <div className="flex items-baseline gap-2">
          <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span
            className="text-lg font-bold tabular-nums md:text-xl"
            title={formatEur(sumTotalEur ?? 0, i18n.language)}
          >
            {formatEurCompact(sumTotalEur ?? 0, i18n.language)}
          </span>
        </div>
      </StatCard>

      <StatCard
        label={t("contractors_kpi_top10") || "Концентрация (топ-10 дял)"}
        hint={
          scopeHint ||
          t("contractors_kpi_top10_hint") ||
          "Дял от стойността, спечелен от 10-те най-големи изпълнители."
        }
      >
        <div className="flex items-baseline gap-2">
          <PieChart className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="text-lg font-bold tabular-nums md:text-xl">
            {pct(kpis?.top10Share)}
          </span>
        </div>
      </StatCard>

      <StatCard
        label={t("contractors_kpi_mp_tied") || "Свързани с депутати"}
        hint={
          scopeHint ||
          t("contractors_kpi_mp_tied_hint") ||
          "Дял от стойността към компании със свързани лица в парламента."
        }
      >
        <div className="flex items-baseline gap-2">
          <Landmark className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="text-lg font-bold tabular-nums md:text-xl">
            {pct(kpis?.mpTiedShare)}
          </span>
          {kpis?.mpTiedCount != null ? (
            <span className="text-xs text-muted-foreground">
              {kpis.mpTiedCount.toLocaleString("bg-BG")}{" "}
              {t("contractors_kpi_mp_tied_companies") || "компании"}
            </span>
          ) : null}
        </div>
      </StatCard>
    </div>
  );
};
