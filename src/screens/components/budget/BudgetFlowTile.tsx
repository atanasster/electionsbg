// Card wrapper for the budget-flow графика. Mounts on /budget as a full-width
// stacked section: the side-by-side Sankeys + balance bridge need breathing
// room that the xl:grid-cols-2 tile slots can't give them.
//
// Above md, renders BudgetFlowGraphic (the SVG composition). Below md, falls
// back to a stacked grouped-bars + balance card layout — the графика's labels
// would collide on a phone viewport.

import { FC, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitFork } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { formatEur } from "@/lib/currency";
import type { KfpSnapshot } from "@/data/budget/types";
import { snapshotToFlowModel } from "./budgetFlowModel";
import { BudgetFlowGraphic } from "./BudgetFlowGraphic";
import { BudgetFlowMobile } from "./BudgetFlowMobile";

// Below this width labels overlap; the SVG falls back to horizontal scroll
// inside the card, mirroring the procurement Sankey's mobile policy. The
// spending side now has a depth-2 outer subcategory column, so the minimum
// is larger than before — four columns plus a wider label gutter.
const MIN_GRAPHIC_WIDTH = 1100;
// Min / max graphic height. Within the range, height scales linearly with
// width (~0.5x) so wider canvases get more vertical room for labels without
// stretching to an awkward portrait shape on very wide screens.
const MIN_GRAPHIC_HEIGHT = 520;
const MAX_GRAPHIC_HEIGHT = 820;
const HEIGHT_FROM_WIDTH_RATIO = 0.5;
const heightForWidth = (width: number): number =>
  Math.round(
    Math.min(
      MAX_GRAPHIC_HEIGHT,
      Math.max(MIN_GRAPHIC_HEIGHT, width * HEIGHT_FROM_WIDTH_RATIO),
    ),
  );

const Legend: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
      <LegendDot
        color="#10b981"
        label={t("budget_flow_legend_revenue") || "Revenue"}
      />
      <LegendDot
        color="#f43f5e"
        label={t("budget_flow_legend_spending") || "Spending"}
      />
      <LegendDot
        color="#2563eb"
        label={t("budget_series_euContribution") || "EU budget contribution"}
      />
      <LegendHatch
        color="#fb7185"
        label={t("budget_flow_legend_deficit") || "Deficit (financing)"}
      />
    </div>
  );
};

const LegendDot: FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="inline-flex items-center gap-1.5">
    <span
      className="inline-block h-2.5 w-2.5 rounded-sm"
      style={{ backgroundColor: color }}
    />
    {label}
  </span>
);

const LegendHatch: FC<{ color: string; label: string }> = ({
  color,
  label,
}) => (
  <span className="inline-flex items-center gap-1.5">
    <span
      className="inline-block h-2.5 w-2.5 rounded-sm"
      style={{
        backgroundImage: `repeating-linear-gradient(45deg, ${color} 0 2px, transparent 2px 5px)`,
        backgroundColor: "transparent",
      }}
    />
    {label}
  </span>
);

export const BudgetFlowTile: FC<{ snapshot: KfpSnapshot }> = ({ snapshot }) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const isMd = useMediaQueryMatch("md");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setSize({ width: el.clientWidth, height: el.clientHeight });
    const ro = new ResizeObserver((entries) => {
      for (const ent of entries) {
        setSize({
          width: ent.contentRect.width,
          height: ent.contentRect.height,
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Cache labels by current language; t() identity changes on every render
  // and would otherwise re-create the model each tick, breaking the flow
  // graphic's animated tween (which compares previous vs current model).
  const revenueLabel = t("budget_flow_total_revenue") || "Revenue";
  const spendingLabel = t("budget_flow_total_spending") || "Spending";

  const model = useMemo(
    () =>
      snapshotToFlowModel(snapshot, lang, {
        revenueLabel,
        spendingLabel,
      }),
    [snapshot, lang, revenueLabel, spendingLabel],
  );

  const { revenueEur, spendingEur, balanceEur, isDeficit } = model.balance;

  return (
    <Card className="my-4" data-og="budget-flow">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <GitFork className="h-4 w-4" />
          {t("budget_flow_title") || "Budget flow"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("budget_breakdown_asof") || "as of"} {snapshot.asOf}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("budget_flow_intro") ||
            "Where the money comes from and where it goes — the gap is closed by financing."}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Legend />
          <div className="text-xs text-muted-foreground tabular-nums">
            <strong className="text-foreground tabular-nums">
              {formatEur(revenueEur)}
            </strong>{" "}
            {t("budget_flow_in") || "in"} ·{" "}
            <strong className="text-foreground tabular-nums">
              {formatEur(spendingEur)}
            </strong>{" "}
            {t("budget_flow_out") || "out"} ·{" "}
            <strong
              className={
                isDeficit
                  ? "text-rose-600 tabular-nums"
                  : "text-emerald-600 tabular-nums"
              }
            >
              {formatEur(Math.abs(balanceEur))}{" "}
              {isDeficit
                ? t("budget_deficit") || "deficit"
                : t("budget_surplus") || "surplus"}
            </strong>
          </div>
        </div>
        {isMd ? (
          (() => {
            const graphicWidth = Math.max(size.width, MIN_GRAPHIC_WIDTH);
            const graphicHeight = heightForWidth(graphicWidth);
            return (
              <div
                ref={containerRef}
                className="rounded-md border bg-card overflow-x-auto"
                style={{ height: graphicHeight }}
              >
                <div
                  style={{
                    minWidth: MIN_GRAPHIC_WIDTH,
                    height: graphicHeight,
                  }}
                >
                  {size.width > 0 ? (
                    <BudgetFlowGraphic
                      model={model}
                      width={graphicWidth}
                      height={graphicHeight}
                    />
                  ) : null}
                </div>
              </div>
            );
          })()
        ) : (
          <BudgetFlowMobile model={model} />
        )}
        <p className="text-[11px] text-muted-foreground/80">
          {t("budget_flow_source_hint") ||
            "Built from the КФП monthly snapshot. Subtotal hierarchy is reconstructed from the source's flat label column."}
        </p>
      </CardContent>
    </Card>
  );
};
