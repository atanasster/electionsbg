// Revenue composition donut for the selected fiscal year. Pulls the КФП
// snapshot for that FY and shows where the money came from: depth-1 leaves
// under "Данъчни приходи" (tax types — VAT, income, excise, corporate, ...)
// plus the non-tax subtotal and grants. Smallest tax types collapse into
// "Other tax" so the donut stays at ~7 slices. Renders nothing when the
// selected FY has no snapshot, or when executed totals are all zero (the
// snapshot exists but the period is too early to populate revenue).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Coins } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { useKfp } from "@/data/budget/useBudget";
import type { KfpSnapshot, KfpSnapshotLine } from "@/data/budget/types";

// Tailwind-friendly palette. Reuse hues from BudgetTrendTile (emerald for
// revenue, plus shaded variants) so the budget pillar feels coherent.
const SLICE_COLORS = [
  "#059669", // emerald-600
  "#10b981", // emerald-500
  "#34d399", // emerald-400
  "#6ee7b7", // emerald-300
  "#a7f3d0", // emerald-200
  "#fbbf24", // amber-400 (non-tax)
  "#f59e0b", // amber-500 (grants)
];

// Top N tax types to keep as their own slice; the rest collapse into one.
const TAX_TOP_N = 4;

interface Slice {
  key: string;
  labelBg: string;
  labelEn: string;
  value: number;
  color: string;
}

// Prefer the December snapshot at the selected FY (complete year). When the
// FY is still in progress (no -12 snapshot yet), fall back to the latest
// December snapshot at any prior FY — Q1 of the in-progress year is too
// seasonal to represent composition (VAT collects monthly, corporate tax is
// almost entirely a post-year-end true-up, so Q1 of an open year reads as
// "tax is 95% VAT" which is misleading). If no December snapshot exists at
// all, fall through to the latest available snapshot at the selected FY.
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

const buildSlices = (snapshot: KfpSnapshot): Slice[] => {
  const revenueSection = snapshot.sections.find((s) => s.code === "I");
  if (!revenueSection) return [];

  // Depth-1 leaves under "Данъчни приходи" (label may vary slightly across
  // years — match by the depth-0 subtotal that immediately precedes them).
  // We walk the flat array tracking the current depth-0 group; depth-1
  // non-subtotal lines belong to that group.
  let currentGroup: KfpSnapshotLine | null = null;
  const taxLeaves: KfpSnapshotLine[] = [];
  let nonTax: KfpSnapshotLine | null = null;
  let grants: KfpSnapshotLine | null = null;
  for (const ln of revenueSection.lines) {
    if (ln.depth === 0) {
      currentGroup = ln;
      // "Данъчни приходи" is the tax subtotal; "Неданъчни приходи" is non-tax;
      // "Помощи" is grants (a leaf at depth 0, not a subtotal).
      if (ln.isSubtotal && ln.labelBg.startsWith("Неданъчни")) nonTax = ln;
      else if (!ln.isSubtotal && ln.labelBg.startsWith("Помощи")) grants = ln;
      continue;
    }
    if (
      ln.depth === 1 &&
      !ln.isSubtotal &&
      currentGroup?.labelBg.startsWith("Данъчни")
    ) {
      taxLeaves.push(ln);
    }
  }

  const amount = (ln: KfpSnapshotLine): number =>
    ln.executed?.amountEur ?? ln.planned?.amountEur ?? 0;

  const taxRanked = [...taxLeaves].sort((a, b) => amount(b) - amount(a));
  const top = taxRanked.slice(0, TAX_TOP_N);
  const tail = taxRanked.slice(TAX_TOP_N);
  const tailSum = tail.reduce((s, ln) => s + amount(ln), 0);

  const slices: Slice[] = top.map((ln, i) => ({
    key: `tax-${i}`,
    labelBg: ln.labelBg,
    labelEn: ln.labelEn,
    value: amount(ln),
    color: SLICE_COLORS[i],
  }));
  if (tailSum > 0) {
    slices.push({
      key: "tax-other",
      labelBg: "Други данъци",
      labelEn: "Other taxes",
      value: tailSum,
      color: SLICE_COLORS[TAX_TOP_N],
    });
  }
  if (nonTax) {
    slices.push({
      key: "non-tax",
      labelBg: nonTax.labelBg,
      labelEn: nonTax.labelEn,
      value: amount(nonTax),
      color: SLICE_COLORS[5],
    });
  }
  if (grants && amount(grants) > 0) {
    slices.push({
      key: "grants",
      labelBg: grants.labelBg,
      labelEn: grants.labelEn,
      value: amount(grants),
      color: SLICE_COLORS[6],
    });
  }
  return slices.filter((s) => s.value > 0);
};

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  return formatEur(v);
};

const SliceTooltip: FC<{
  active?: boolean;
  payload?: Array<{ payload: Slice & { share: number } }>;
  lang: "bg" | "en";
}> = ({ active, payload, lang }) => {
  if (!active || !payload?.[0]) return null;
  const s = payload[0].payload;
  const label = lang === "bg" ? s.labelBg : s.labelEn || s.labelBg;
  return (
    <div className="rounded-md border bg-popover px-2 py-1.5 text-popover-foreground shadow-sm text-xs">
      <div className="font-semibold">{label}</div>
      <div className="tabular-nums">
        {formatEur(s.value)} · {s.share.toFixed(1)}%
      </div>
    </div>
  );
};

export const BudgetRevenueCompositionTile: FC<{ fiscalYear: number }> = ({
  fiscalYear,
}) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: kfp } = useKfp();

  const { slices, total, asOf, snapFy } = useMemo(() => {
    if (!kfp)
      return {
        slices: [] as Slice[],
        total: 0,
        asOf: null as string | null,
        snapFy: null as number | null,
      };
    const snap = pickSnapshot(kfp.snapshots, fiscalYear);
    if (!snap) return { slices: [], total: 0, asOf: null, snapFy: null };
    const sl = buildSlices(snap);
    const tot = sl.reduce((s, x) => s + x.value, 0);
    return { slices: sl, total: tot, asOf: snap.asOf, snapFy: snap.fiscalYear };
  }, [kfp, fiscalYear]);

  if (slices.length === 0 || total <= 0) return null;

  const data = slices.map((s) => ({ ...s, share: (s.value / total) * 100 }));

  return (
    <Card className="my-4" data-og="budget-revenue-composition">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Coins className="h-4 w-4" />
          {t("budget_revenue_composition_title") || "Where revenue comes from"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {(t("budget_fy_heading") || "Fiscal year") +
            " " +
            (snapFy ?? fiscalYear)}
          {asOf ? ` · ${t("budget_ministries_asof") || "as of"} ${asOf}` : null}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
          <div style={{ height: 200, width: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={1}
                  stroke="var(--card)"
                  strokeWidth={1.5}
                >
                  {data.map((d) => (
                    <Cell key={d.key} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip content={<SliceTooltip lang={lang} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="space-y-1 text-xs">
            {data.map((d) => {
              const label = lang === "bg" ? d.labelBg : d.labelEn || d.labelBg;
              return (
                <li key={d.key} className="flex items-baseline gap-2">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: d.color }}
                  />
                  <span className="flex-1 truncate" title={label}>
                    {label}
                  </span>
                  <span className="tabular-nums shrink-0 font-medium">
                    {compactEur(d.value)}
                  </span>
                  <span className="tabular-nums shrink-0 text-muted-foreground w-10 text-right">
                    {d.share.toFixed(1)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="text-[11px] text-muted-foreground/80 mt-2">
          {t("budget_revenue_composition_caption") ||
            "Tax revenue broken down by major type, plus non-tax revenue and grants. Source: Ministry of Finance via data.egov.bg (КФП)."}
        </p>
      </CardContent>
    </Card>
  );
};
