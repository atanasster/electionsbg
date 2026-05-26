// Drill-down panel for the budget-flow Sankey's "Капиталови разходи" node.
// Mounts inside the BudgetFlowTile card when the user clicks the capital
// leaf; answers "where do the €1.85B in capital investments go?" with:
//
//   1. By oblast — 28 oblasts, sorted by total project value.
//   2. By project type — roads / water / education / etc (regex-classified).
//   3. Top 10 individual projects by cost.
//
// Source: data/budget/investment_program/{year}.json (the parsed Чл. 113
// Приложение III). Covers the municipal investment program — the slice the
// state budget allocates to per-project capital subsidies for the 265
// общини. The total (~€3.6B for 2025) is larger than the КФП "Капиталови
// разходи" line because that line is net of intra-system transfers; the
// coverage banner explains the gap.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, HardHat, X } from "lucide-react";
import { formatEur } from "@/lib/currency";
import {
  useInvestmentProgramIndex,
  useInvestmentProgram,
} from "@/data/budget/useBudget";
import type { KfpSnapshot } from "@/data/budget/types";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return formatEur(v);
};

const CATEGORY_COLOURS: Record<string, string> = {
  roads: "#f59e0b",
  water_sewage: "#0ea5e9",
  education: "#10b981",
  social: "#ef4444",
  sports: "#a855f7",
  culture: "#ec4899",
  buildings: "#84cc16",
  energy: "#facc15",
  other: "#94a3b8",
};

export const BudgetFlowCapitalDrilldown: FC<{
  fiscalYear: number;
  snapshot: KfpSnapshot;
  onClose: () => void;
}> = ({ fiscalYear, snapshot, onClose }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const { data: index } = useInvestmentProgramIndex();

  // Pick the fiscal year — exact match preferred, else latest available.
  const dataYear = useMemo(() => {
    if (!index || index.years.length === 0) return null;
    const exact = index.years.find((y) => y.fiscalYear === fiscalYear);
    if (exact) return exact.fiscalYear;
    const sorted = [...index.years].sort((a, b) => b.fiscalYear - a.fiscalYear);
    return sorted[0].fiscalYear;
  }, [index, fiscalYear]);

  const { data: program } = useInvestmentProgram(dataYear ?? undefined);

  // КФП "Капиталови разходи" — what we're drilling into.
  const sankeyCapitalEur = useMemo(() => {
    const exp = snapshot.sections.find((s) => s.series === "expenditure");
    const row = exp?.lines.find(
      (l) =>
        l.depth === 1 &&
        (/капиталови\s+разходи/i.test(l.labelBg) ||
          /capital\s+expenditure/i.test(l.labelEn ?? "")),
    );
    return row?.executed?.amountEur ?? row?.planned?.amountEur ?? null;
  }, [snapshot]);

  if (!program || dataYear == null) return null;

  const totalEur = program.grandTotal.amountEur;

  return (
    <div className="rounded-md border bg-muted/30 p-3 my-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <HardHat className="h-4 w-4" />
          {t("capital_drilldown_title")}
          <span className="text-xs text-muted-foreground font-normal">
            · {dataYear}
            {lang === "bg" ? " г." : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 hover:bg-muted"
          aria-label={t("capital_drilldown_close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {sankeyCapitalEur != null && (
        <div className="mb-2 text-xs text-muted-foreground">
          {t("capital_drilldown_coverage", {
            program: compactEur(totalEur),
            kfp: compactEur(sankeyCapitalEur),
            projectCount: program.projectCount,
          })}
        </div>
      )}

      {/* By category */}
      <div className="mb-3">
        <div className="text-xs font-medium mb-1">
          {t("capital_by_category")}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {program.byCategory.map((cat) => {
            const eur = cat.total.amountEur;
            const pct = totalEur > 0 ? (eur / totalEur) * 100 : 0;
            return (
              <div key={cat.key} className="rounded border bg-card p-2 text-xs">
                <div
                  className="h-1 rounded-full mb-1"
                  style={{
                    backgroundColor: CATEGORY_COLOURS[cat.key] ?? "#94a3b8",
                  }}
                />
                <div className="text-muted-foreground line-clamp-2">
                  {lang === "bg" ? cat.labelBg : cat.labelEn}
                </div>
                <div className="font-medium tabular-nums">
                  {compactEur(eur)}
                </div>
                <div className="text-muted-foreground tabular-nums text-[10px]">
                  {cat.count} · {pct >= 0.5 ? `${pct.toFixed(1)}%` : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* By oblast */}
      <div className="mb-3">
        <div className="text-xs font-medium mb-1">{t("capital_by_oblast")}</div>
        <div className="space-y-0.5">
          {program.byOblast.slice(0, 14).map((row) => {
            const eur = row.total.amountEur;
            const pct = totalEur > 0 ? (eur / totalEur) * 100 : 0;
            const maxEur = program.byOblast[0]?.total.amountEur ?? 0;
            const widthPct = maxEur > 0 ? (eur / maxEur) * 100 : 0;
            return (
              <div
                key={row.key}
                className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 rounded px-2 py-1 text-xs"
              >
                <span className="truncate">
                  {row.labelBg}
                  <span className="text-muted-foreground ml-1 text-[10px]">
                    {row.count}
                  </span>
                </span>
                <span className="tabular-nums font-medium">
                  {compactEur(eur)}
                </span>
                <span className="tabular-nums text-muted-foreground w-12 text-right">
                  {pct >= 0.5 ? `${pct.toFixed(1)}%` : ""}
                </span>
                <div
                  className="col-span-3 h-0.5 rounded-full bg-amber-200/60"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Top projects */}
      <div>
        <div className="text-xs font-medium mb-1">
          {t("capital_top_projects")}
        </div>
        <div className="space-y-0.5">
          {program.topProjects.slice(0, 10).map((p) => (
            <div
              key={p.projectId}
              className="grid grid-cols-[auto_1fr_auto] items-baseline gap-3 rounded px-2 py-1 text-xs"
              title={p.name}
            >
              <span className="tabular-nums text-muted-foreground text-[10px]">
                {p.projectId}
              </span>
              <span className="truncate">
                {p.name.slice(0, 70)}
                {p.name.length > 70 ? "…" : ""}
                <span className="text-muted-foreground ml-2 text-[10px]">
                  {p.municipalityNameBg ?? "—"}
                </span>
              </span>
              <span className="tabular-nums font-medium">
                {compactEur(p.cost.amountEur)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("capital_drilldown_caveat")}
      </p>
    </div>
  );
};

export const BudgetFlowCapitalTrigger: FC<{
  open: boolean;
  onClick: () => void;
}> = ({ open, onClick }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-muted/50"
    >
      <HardHat className="h-3 w-3" />
      {t("capital_flow_trigger")}
      <ChevronDown
        className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
};
