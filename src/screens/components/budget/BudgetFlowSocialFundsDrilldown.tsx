// Drill-down panel for the budget-flow Sankey's "Социалноосигурителни
// фондове" node. Mounts inside the BudgetFlowTile card when the user clicks
// the social-funds leaf; answers "where does the €8B+ in social-security
// transfers go?" with:
//
//   1. Fund-level breakdown — DOO (€12.6B) + Teachers Pension Fund (€53M) +
//      Bankruptcy Receivables (€1M).
//   2. DOO expense decomposition — Pensions (€11.1B, 88% of DOO) + short-
//      term benefits (sickness/maternity/unemployment, €1.4B) + operations.
//
// Pulls from data/budget/noi/funds.json. The drilldown's totals are GROSS
// fund spending, larger than КФП's net "Социалноосигурителни фондове" line
// (which is consolidated). A coverage banner explains the gap.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, HeartHandshake, X } from "lucide-react";
import { DrilldownLoadingShell } from "./DrilldownLoadingShell";
import { formatEur } from "@/lib/currency";
import { useNoiFunds } from "@/data/budget/useBudget";
import type {
  KfpSnapshot,
  NoiFundSnapshot,
  NoiExpenseLineId,
} from "@/data/budget/types";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return formatEur(v);
};

// Colour mapping for the expense categories — pensions are the headline (rose
// matches the Sankey spending side), benefits are a softer rose, operations
// are muted yellow.
const EXPENSE_COLOURS: Record<string, string> = {
  pensions: "#f43f5e",
  short_term_benefits: "#fb7185",
  personnel: "#fcd34d",
  operations: "#fde68a",
  other: "#e5e7eb",
};

export const BudgetFlowSocialFundsDrilldown: FC<{
  fiscalYear: number;
  snapshot: KfpSnapshot;
  onClose: () => void;
}> = ({ fiscalYear, snapshot, onClose }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const { data } = useNoiFunds();

  // Pick the year — exact match preferred, else the latest COMPLETE year.
  // The B1 ingest publishes a new fiscal year mid-cycle as a partial/shell
  // record (funds: [], revenue: 0), so the raw max would fall back to a year
  // with no per-fund detail at all. Same guard as flattenFundYear in
  // src/data/procurement/useNoi.tsx. An *exact* shell year is still honoured
  // above — the per-fund section below already degrades on funds.length === 0.
  const yearEntry = useMemo(() => {
    if (!data) return null;
    const exact = data.years.find((y) => y.fiscalYear === fiscalYear);
    if (exact) return exact;
    const usable = data.years.filter(
      (y) => y.funds.length > 0 && y.totals.revenue.amountEur > 0,
    );
    return [...usable].sort((a, b) => b.fiscalYear - a.fiscalYear)[0] ?? null;
  }, [data, fiscalYear]);

  // Sankey "Социалноосигурителни фондове" leaf value — what we're drilling
  // into. The КФП value is NET (post-consolidation); NOI gross expenditure
  // will be larger.
  const sankeyEur = useMemo(() => {
    const exp = snapshot.sections.find((s) => s.series === "expenditure");
    const row = exp?.lines.find(
      (l) =>
        l.depth === 2 &&
        (/осигурителни фондове|социалноосигурителни фондове/i.test(l.labelBg) ||
          /social\s*security\s*fund/i.test(l.labelEn ?? "")),
    );
    return row?.executed?.amountEur ?? row?.planned?.amountEur ?? null;
  }, [snapshot]);

  if (!yearEntry) {
    return (
      <DrilldownLoadingShell
        icon={HeartHandshake}
        title={t("noi_drilldown_title")}
        onClose={onClose}
        closeAriaLabel={t("noi_drilldown_close")}
      />
    );
  }

  const { totals, funds } = yearEntry;

  // Build the four big buckets we surface: pensions / short-term benefits /
  // operations (personnel + operations + capital + reserve etc.).
  const sumOf = (ids: NoiExpenseLineId[]): number =>
    funds.reduce((s, f) => {
      let inner = 0;
      for (const line of f.expenseLines) {
        if (ids.includes(line.id)) inner += line.executed?.amountEur ?? 0;
      }
      return s + inner;
    }, 0);

  const pensionsEur = totals.pensions.amountEur;
  const benefitsEur = totals.shortTermBenefits.amountEur;
  const personnelEur = sumOf(["personnel"]);
  const operationsEur = sumOf([
    "operations",
    "subsidies",
    "capital_assets",
    "capital_transfers",
    "abroad",
    "reserve",
    "interest",
  ]);
  const totalEur = totals.expenditure.amountEur;
  // Anything in social_total minus the pension + benefits already extracted
  // = other social (stipends, etc).
  const socialTotalEur = sumOf(["social_total"]);
  const otherSocialEur = Math.max(
    0,
    socialTotalEur - pensionsEur - benefitsEur,
  );

  const categories = [
    {
      key: "pensions",
      labelKey: "noi_cat_pensions",
      eur: pensionsEur,
      colour: EXPENSE_COLOURS.pensions,
    },
    {
      key: "short_term_benefits",
      labelKey: "noi_cat_short_term_benefits",
      eur: benefitsEur,
      colour: EXPENSE_COLOURS.short_term_benefits,
    },
    {
      key: "other_social",
      labelKey: "noi_cat_other_social",
      eur: otherSocialEur,
      colour: EXPENSE_COLOURS.other,
    },
    {
      key: "personnel",
      labelKey: "noi_cat_personnel",
      eur: personnelEur,
      colour: EXPENSE_COLOURS.personnel,
    },
    {
      key: "operations",
      labelKey: "noi_cat_operations",
      eur: operationsEur,
      colour: EXPENSE_COLOURS.operations,
    },
  ];

  return (
    <div className="rounded-md border bg-muted/30 p-3 my-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <HeartHandshake className="h-4 w-4" />
          {t("noi_drilldown_title")}
          <span className="text-xs text-muted-foreground font-normal">
            · {yearEntry.fiscalYear}
            {lang === "bg" ? " г." : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 hover:bg-muted"
          aria-label={t("noi_drilldown_close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Coverage banner — NOI gross expenditure is larger than the КФП
          consolidated line because КФП nets out the state subsidy + other
          inter-system flows. Show the comparison transparently. */}
      {sankeyEur != null && (
        <div className="mb-2 text-xs text-muted-foreground">
          {t("noi_drilldown_coverage", {
            gross: compactEur(totalEur),
            net: compactEur(sankeyEur),
          })}
        </div>
      )}

      {/* Expense-category tiles */}
      <div className="mb-3">
        <div className="text-xs font-medium mb-1">{t("noi_by_category")}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {categories.map((cat) => {
            const pct = totalEur > 0 ? (cat.eur / totalEur) * 100 : 0;
            return (
              <div key={cat.key} className="rounded border bg-card p-2 text-xs">
                <div
                  className="h-1 rounded-full mb-1"
                  style={{ backgroundColor: cat.colour }}
                />
                <div className="text-muted-foreground line-clamp-2">
                  {t(cat.labelKey)}
                </div>
                <div className="font-medium tabular-nums">
                  {compactEur(cat.eur)}
                </div>
                <div className="text-muted-foreground tabular-nums text-[10px]">
                  {pct >= 0.1 ? `${pct.toFixed(1)}%` : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Depth-3: pension types within the Пенсии bucket — sourced from the
          annual yearbook PDF (Table 6.3). Renders only when the yearbook has
          been ingested for this fiscal year. */}
      {yearEntry.pensionTypes && (
        <div className="mb-3 rounded border bg-card/50 p-2">
          <div className="text-xs font-medium mb-1">
            {t("noi_pensions_by_type")}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {[
              {
                key: "oldAge",
                i18nKey: "noi_ptype_old_age",
                eur: yearEntry.pensionTypes.oldAge.amountEur,
                colour: "#f43f5e",
              },
              {
                key: "disability",
                i18nKey: "noi_ptype_disability",
                eur: yearEntry.pensionTypes.disability.amountEur,
                colour: "#fb7185",
              },
              {
                key: "social",
                i18nKey: "noi_ptype_social",
                eur: yearEntry.pensionTypes.social.amountEur,
                colour: "#fda4af",
              },
              {
                key: "occupational",
                i18nKey: "noi_ptype_occupational",
                eur: yearEntry.pensionTypes.occupational.amountEur,
                colour: "#fcd34d",
              },
              {
                key: "other",
                i18nKey: "noi_ptype_other",
                eur: yearEntry.pensionTypes.other.amountEur,
                colour: "#e5e7eb",
              },
            ]
              .filter((p) => p.eur > 0)
              .map((p) => {
                const ptotal = yearEntry.pensionTypes!.total.amountEur;
                const pct = ptotal > 0 ? (p.eur / ptotal) * 100 : 0;
                return (
                  <div
                    key={p.key}
                    className="rounded border bg-card p-2 text-xs"
                  >
                    <div
                      className="h-1 rounded-full mb-1"
                      style={{ backgroundColor: p.colour }}
                    />
                    <div className="text-muted-foreground line-clamp-2">
                      {t(p.i18nKey)}
                    </div>
                    <div className="font-medium tabular-nums">
                      {compactEur(p.eur)}
                    </div>
                    <div className="text-muted-foreground tabular-nums text-[10px]">
                      {pct >= 0.1 ? `${pct.toFixed(1)}%` : ""}
                    </div>
                  </div>
                );
              })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {t("noi_pensions_by_type_caption")}
          </p>
        </div>
      )}

      {/* Per-fund list — only when we actually have B1 fund data.
          Yearbook-only years (e.g. 2023 with the pension yearbook PDF but
          no B1 XLS files) skip this section since funds is empty. */}
      {funds.length > 0 && (
        <div>
          <div className="text-xs font-medium mb-1">{t("noi_by_fund")}</div>
          <div className="space-y-0.5">
            {funds.map((f: NoiFundSnapshot) => {
              const eur = f.expenditure?.amountEur ?? 0;
              const pct = totalEur > 0 ? (eur / totalEur) * 100 : 0;
              const maxEur = funds[0]?.expenditure?.amountEur ?? 0;
              const widthPct = maxEur > 0 ? (eur / maxEur) * 100 : 0;
              const name = lang === "bg" ? f.fundLabelBg : f.fundLabelEn;
              return (
                <div
                  key={f.fundCode}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 rounded px-2 py-1 text-xs"
                >
                  <span className="truncate">
                    {name}
                    <span className="text-muted-foreground ml-1 text-[10px]">
                      {f.fundCode}
                    </span>
                  </span>
                  <span className="tabular-nums font-medium">
                    {compactEur(eur)}
                  </span>
                  <span className="tabular-nums text-muted-foreground w-12 text-right">
                    {pct >= 0.1 ? `${pct.toFixed(1)}%` : ""}
                  </span>
                  <div
                    className="col-span-3 h-0.5 rounded-full bg-rose-200/60"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("noi_drilldown_caveat")}
      </p>
    </div>
  );
};

// Trigger button — appears below the Sankey card header.
export const BudgetFlowSocialFundsTrigger: FC<{
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
      <HeartHandshake className="h-3 w-3" />
      {t("noi_flow_trigger")}
      <ChevronDown
        className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
};
