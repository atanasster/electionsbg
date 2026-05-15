// Below md the side-by-side графика's labels overlap and the bridge stops
// reading. Stacked fallback: revenue grouped-bars → balance card → spending
// grouped-bars. Reuses the existing budget tile bar visual language (same
// proportional bars the ministry programs block uses) so it doesn't look
// foreign.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown } from "lucide-react";
import { formatEur } from "@/lib/currency";
import type { BudgetFlowModel, FlowGraph, FlowNode } from "./budgetFlowModel";

const COLOR_REVENUE = "#10b981";
const COLOR_SPENDING = "#f43f5e";
const COLOR_EU = "#2563eb";

const colorFor = (n: FlowNode): string => {
  if (n.id === "spending-section-III") return COLOR_EU;
  return n.side === "revenue" ? COLOR_REVENUE : COLOR_SPENDING;
};

// Walk the flow graph by group: every depth-0 node (group or standalone leaf)
// gets one bar; subgroups expand to show their leaf children below.
interface GroupRow {
  group: FlowNode;
  children: FlowNode[];
}

const groupedNodes = (graph: FlowGraph): GroupRow[] => {
  const out: GroupRow[] = [];
  for (const n of graph.nodes) {
    if (n.type === "total") continue;
    if (n.isPhantom) continue;
    if (n.type === "group") {
      const children = graph.nodes.filter(
        (c) => c.type === "leaf" && !c.isPhantom && c.groupLabel === n.label,
      );
      out.push({ group: n, children });
    } else if (n.type === "leaf" && n.groupLabel == null) {
      out.push({ group: n, children: [] });
    }
  }
  return out;
};

const Side: FC<{
  graph: FlowGraph;
  totalLabel: string;
  totalColor: string;
  asOfHeading: string;
}> = ({ graph, totalLabel, totalColor, asOfHeading }) => {
  const total = graph.totalEur;
  const rows = groupedNodes(graph);
  const max = Math.max(1, ...rows.map((r) => r.group.valueEur));
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-sm font-semibold">{totalLabel}</span>
        <span
          className="text-base font-bold tabular-nums"
          style={{ color: totalColor }}
        >
          {formatEur(total)}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-2">{asOfHeading}</p>
      <ul className="space-y-2.5">
        {rows.map((row) => {
          const w = (row.group.valueEur / max) * 100;
          const pct = ((row.group.valueEur / total) * 100).toFixed(1);
          return (
            <li
              key={row.group.id}
              className="border-t border-border/50 first:border-t-0 pt-2 first:pt-0"
            >
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium truncate">{row.group.label}</span>
                <span className="tabular-nums shrink-0">
                  {formatEur(row.group.valueEur)}{" "}
                  <span className="text-muted-foreground">({pct}%)</span>
                </span>
              </div>
              <div className="mt-0.5 h-1.5 rounded bg-muted overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${w}%`,
                    backgroundColor: colorFor(row.group),
                  }}
                />
              </div>
              {row.children.length > 0 ? (
                <ul className="mt-1 ml-2 space-y-0.5">
                  {row.children.map((leaf) => (
                    <li
                      key={leaf.id}
                      className="text-[11px] text-muted-foreground flex items-baseline justify-between gap-2"
                    >
                      <span className="truncate">{leaf.label}</span>
                      <span className="tabular-nums shrink-0">
                        {formatEur(leaf.valueEur)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export const BudgetFlowMobile: FC<{ model: BudgetFlowModel }> = ({ model }) => {
  const { t } = useTranslation();
  const { revenueEur, spendingEur, balanceEur, isDeficit } = model.balance;
  const asOf = `${t("budget_breakdown_asof") || "as of"} ${model.asOf}`;

  return (
    <div className="space-y-3">
      <Side
        graph={model.revenue}
        totalLabel={t("budget_flow_total_revenue") || "Revenue"}
        totalColor={COLOR_REVENUE}
        asOfHeading={asOf}
      />
      <div
        className={
          isDeficit
            ? "rounded-md border border-rose-200 dark:border-rose-800/60 bg-rose-50/40 dark:bg-rose-950/20 p-3 flex items-center gap-3"
            : "rounded-md border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-3 flex items-center gap-3"
        }
      >
        <ArrowDown
          className={
            isDeficit
              ? "h-5 w-5 text-rose-600 shrink-0"
              : "h-5 w-5 text-emerald-600 shrink-0 rotate-180"
          }
        />
        <div className="flex-1 min-w-0">
          <div
            className={
              isDeficit
                ? "text-sm font-semibold text-rose-700 dark:text-rose-300"
                : "text-sm font-semibold text-emerald-700 dark:text-emerald-300"
            }
          >
            {formatEur(Math.abs(balanceEur))}{" "}
            {isDeficit
              ? t("budget_deficit") || "deficit"
              : t("budget_surplus") || "surplus"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {((Math.abs(balanceEur) / Math.max(spendingEur, 1)) * 100).toFixed(
              1,
            )}
            % {t("budget_flow_of_spending") || "of spending"} ·{" "}
            {isDeficit
              ? t("budget_flow_deficit_hint") ||
                "Closed by financing (borrowing or reserves)."
              : t("budget_flow_surplus_hint") ||
                "Reduces debt or funds reserves."}
          </div>
        </div>
      </div>
      <Side
        graph={model.spending}
        totalLabel={t("budget_flow_total_spending") || "Spending"}
        totalColor={COLOR_SPENDING}
        asOfHeading={`${formatEur(revenueEur)} ${t("budget_flow_in") || "in"} → ${formatEur(spendingEur)} ${t("budget_flow_out") || "out"}`}
      />
    </div>
  );
};
