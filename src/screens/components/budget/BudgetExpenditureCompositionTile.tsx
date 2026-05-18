// Expenditure composition for the selected fiscal year — horizontal bars
// ranked by amount, mirroring BudgetMinistriesTile's visual language but
// grouped by economic category instead of spending unit. Pulls the КФП
// snapshot for that FY and surfaces:
//   - depth-1 leaves under "Разходи" (direct spend: personnel, operations,
//     social, subsidies, capital, ...)
//   - the "Лихви - общо" depth-1 subtotal as a single "Interest" row (its
//     external/domestic children would otherwise double-count)
//   - depth-2 leaves under "Трансфери (нето) > Предоставени на:" (transfers
//     to municipalities, social security funds, universities/BAS, ...)
// "Получени от:" lines and the "Резерв" placeholder are skipped — they net
// negative or carry no execution. Renders nothing when the FY has no
// snapshot or no executed totals yet.
//
// `expanded` mode (used on the /budget deep-dive screen) appends a YoY %
// column against the prior December snapshot so the same data reads as a
// drill-down rather than a summary.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { PieChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { useKfp } from "@/data/budget/useBudget";
import type { KfpSnapshot, KfpSnapshotLine } from "@/data/budget/types";

const TRANSFERS_PARENT_BG = "Предоставени"; // "Предоставени на:" — transfers granted
const INTEREST_PREFIX_BG = "Лихви"; // "Лихви - общо" — kept as one row

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  return formatEur(v);
};

const fmtYoy = (pct: number): string =>
  `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;

// On the spending side a positive YoY means spending grew — neutral framing,
// neither inherently good nor bad. Pick muted colours to avoid implying a
// value judgement.
const yoyClass = (pct: number): string =>
  pct > 0
    ? "text-rose-600 dark:text-rose-400"
    : pct < 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-muted-foreground";

// Same rule as the revenue tile: prefer the December snapshot at the
// selected FY; fall back to the latest prior December snapshot when the
// in-progress year has no -12 yet. See BudgetRevenueCompositionTile for the
// rationale (Q1 composition over-represents whichever categories collect
// monthly and under-represents annual-true-up categories).
const pickSnapshot = (
  snapshots: KfpSnapshot[],
  fiscalYear: number,
): KfpSnapshot | null => {
  const decAtFy = snapshots.find(
    (s) => s.fiscalYear === fiscalYear && s.period.endsWith("-12"),
  );
  if (decAtFy) return decAtFy;
  const priorDec = snapshots
    .filter((s) => s.fiscalYear < fiscalYear && s.period.endsWith("-12"))
    .reduce<KfpSnapshot | null>(
      (latest, s) =>
        latest == null || s.fiscalYear > latest.fiscalYear ? s : latest,
      null,
    );
  if (priorDec) return priorDec;
  const matching = snapshots.filter((s) => s.fiscalYear === fiscalYear);
  if (matching.length === 0) return null;
  return matching.reduce((latest, s) =>
    s.period > latest.period ? s : latest,
  );
};

const pickPriorSnapshot = (
  snapshots: KfpSnapshot[],
  baselineFy: number,
): KfpSnapshot | null =>
  snapshots.find(
    (s) => s.fiscalYear === baselineFy - 1 && s.period.endsWith("-12"),
  ) ?? null;

interface Row {
  key: string;
  labelBg: string;
  labelEn: string;
  planned: number | null;
  executed: number | null;
}

const buildRows = (snapshot: KfpSnapshot): Row[] => {
  const section = snapshot.sections.find((s) => s.code === "II");
  if (!section) return [];

  // Walk lines in order, maintaining ancestor[] indexed by depth so we can
  // tell which subtree a depth-2 leaf belongs to. (Section depth-0 lines like
  // "Разходи" and "Трансфери (нето)" don't need to be skipped explicitly —
  // they're subtotals and our include rules ignore subtotals.)
  const ancestor: KfpSnapshotLine[] = [];
  const rows: Row[] = [];
  let i = 0;
  for (const ln of section.lines) {
    ancestor.length = ln.depth;

    const isInterestSubtotal =
      ln.isSubtotal &&
      ln.depth === 1 &&
      ln.labelBg.startsWith(INTEREST_PREFIX_BG);
    const isDirectSpendLeaf = !ln.isSubtotal && ln.depth === 1;
    const isTransferDestination =
      !ln.isSubtotal &&
      ln.depth === 2 &&
      ancestor[1]?.labelBg.startsWith(TRANSFERS_PARENT_BG);

    if (isInterestSubtotal || isDirectSpendLeaf || isTransferDestination) {
      rows.push({
        key: `r-${i}-${ln.labelBg}`,
        labelBg: ln.labelBg,
        labelEn: ln.labelEn,
        planned: ln.planned?.amountEur ?? null,
        executed: ln.executed?.amountEur ?? null,
      });
    }

    ancestor[ln.depth] = ln;
    i += 1;
  }

  // Rank by executed amount (fall back to planned for in-progress years where
  // executed is null). Drop rows that are entirely empty.
  return rows
    .filter((r) => (r.executed ?? r.planned ?? 0) > 0)
    .sort(
      (a, b) => (b.executed ?? b.planned ?? 0) - (a.executed ?? a.planned ?? 0),
    );
};

// Lookup table from labelBg → headline amount for YoY joins. Built from the
// prior snapshot's same set of rows so we don't have to re-walk the tree per
// row at render time.
const buildPriorIndex = (
  snapshot: KfpSnapshot | null,
): Map<string, number> | null => {
  if (!snapshot) return null;
  const m = new Map<string, number>();
  for (const r of buildRows(snapshot)) {
    const v = r.executed ?? r.planned ?? 0;
    if (v > 0) m.set(r.labelBg, v);
  }
  return m;
};

export const BudgetExpenditureCompositionTile: FC<{
  fiscalYear: number;
  expanded?: boolean;
}> = ({ fiscalYear, expanded = false }) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: kfp } = useKfp();

  const { rows, asOf, max, snapFy, priorIndex, priorFy } = useMemo(() => {
    if (!kfp)
      return {
        rows: [] as Row[],
        asOf: null as string | null,
        max: 0,
        snapFy: null as number | null,
        priorIndex: null as Map<string, number> | null,
        priorFy: null as number | null,
      };
    const snap = pickSnapshot(kfp.snapshots, fiscalYear);
    if (!snap)
      return {
        rows: [],
        asOf: null,
        max: 0,
        snapFy: null,
        priorIndex: null,
        priorFy: null,
      };
    const r = buildRows(snap);
    const m = r.reduce(
      (acc, x) => Math.max(acc, x.executed ?? 0, x.planned ?? 0),
      0,
    );
    const prior = expanded
      ? pickPriorSnapshot(kfp.snapshots, snap.fiscalYear)
      : null;
    return {
      rows: r,
      asOf: snap.asOf,
      max: m,
      snapFy: snap.fiscalYear,
      priorIndex: buildPriorIndex(prior),
      priorFy: prior?.fiscalYear ?? null,
    };
  }, [kfp, fiscalYear, expanded]);

  if (rows.length === 0) return null;

  return (
    <Card className="my-4" data-og="budget-expenditure-composition">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PieChart className="h-4 w-4" />
          {t("budget_expenditure_composition_title") || "Where the money goes"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {(t("budget_fy_heading") || "Fiscal year") +
            " " +
            (snapFy ?? fiscalYear)}
          {asOf ? ` · ${t("budget_ministries_asof") || "as of"} ${asOf}` : null}
          {!expanded ? (
            <>
              {" · "}
              <Link to="/budget" className="text-primary hover:underline">
                {t("dashboard_section_budget_link") || "see details"}
              </Link>
            </>
          ) : null}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-1.5">
          {rows.map((r) => {
            const baseline = r.planned ?? r.executed ?? 0;
            const baseWidth = max > 0 ? (baseline / max) * 100 : 0;
            const execShare =
              r.executed != null && baseline > 0
                ? Math.min(100, (r.executed / baseline) * 100)
                : 0;
            const execPct =
              r.executed != null && r.planned != null && r.planned > 0
                ? (r.executed / r.planned) * 100
                : null;
            const label = lang === "bg" ? r.labelBg : r.labelEn || r.labelBg;
            const headline = r.executed ?? r.planned ?? 0;
            const priorVal = priorIndex?.get(r.labelBg) ?? null;
            const yoy =
              expanded && priorVal != null && priorVal > 0
                ? ((headline - priorVal) / priorVal) * 100
                : null;
            return (
              <li key={r.key} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate" title={label}>
                    {label}
                  </span>
                  <span className="tabular-nums shrink-0 font-medium">
                    {compactEur(headline)}
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full rounded bg-rose-500/25"
                    style={{ width: `${baseWidth}%` }}
                  >
                    {r.executed != null ? (
                      <div
                        className="h-full rounded bg-rose-500/80"
                        style={{ width: `${execShare}%` }}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    {execPct != null ? (
                      <>
                        {execPct.toFixed(1)}%{" "}
                        <span className="opacity-70">
                          {t("budget_ministries_of_amended") || "of plan"}
                        </span>
                      </>
                    ) : null}
                  </span>
                  {expanded ? (
                    <span
                      className={
                        yoy != null ? yoyClass(yoy) : "text-muted-foreground/60"
                      }
                      title={
                        priorFy
                          ? `${t("budget_yoy_vs") || "vs"} ${priorFy}`
                          : undefined
                      }
                    >
                      {yoy != null ? fmtYoy(yoy) : "—"}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {expanded && priorFy ? (
          <p className="text-[11px] text-muted-foreground/80 mt-2">
            {t("budget_yoy_note", { year: priorFy }) ||
              `YoY vs fiscal year ${priorFy}`}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};
