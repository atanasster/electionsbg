// Multi-year balance & debt projection tile for the policy simulator: the
// scenario's first-year delta rolled forward to 2030 over the EC Spring 2026
// baseline (engine: src/lib/bgFiscalProjection.ts). Bars = balance % of GDP,
// lines = debt % of GDP, both paths; the −3% Maastricht line anchors the
// EDP context. Chart idioms follow BudgetTrendTile (same palette family).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { FiscalProjection } from "@/lib/bgFiscalProjection";
import { fmtCompactEur, fmtDelta, fmtPct1 } from "./budgetFormat";

interface ChartDatum {
  year: number;
  balScen: number;
  balBase: number;
  debtScen: number;
  debtBase: number;
}

// Recharts injects active/payload; the rest arrives via the content element.
const ProjTooltip: FC<{
  active?: boolean;
  payload?: Array<{ payload: ChartDatum }>;
  labelMap: Record<string, string>;
  fmt: (v: number) => string;
  anyChange: boolean;
}> = ({ active, payload, labelMap, fmt, anyChange }) => {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-2 py-1.5 text-popover-foreground shadow-sm text-xs space-y-0.5">
      <div className="font-semibold">{d.year}</div>
      <div className="tabular-nums text-rose-600">
        {labelMap.balScen}: {fmt(d.balScen)}%
      </div>
      {anyChange ? (
        <div className="tabular-nums text-muted-foreground">
          {labelMap.balBase}: {fmt(d.balBase)}%
        </div>
      ) : null}
      <div className="tabular-nums text-indigo-600 dark:text-indigo-400">
        {labelMap.debtScen}: {fmt(d.debtScen)}%
      </div>
      {anyChange ? (
        <div className="tabular-nums text-muted-foreground">
          {labelMap.debtBase}: {fmt(d.debtBase)}%
        </div>
      ) : null}
    </div>
  );
};

export const PolicyFiscalProjection: FC<{
  projection: FiscalProjection;
  /** Whether the scenario deviates from current law (drives baseline-only
   *  rendering when it does not). */
  anyChange: boolean;
  lang: string;
  locale: string;
}> = ({ projection, anyChange, lang, locale }) => {
  const { t } = useTranslation();
  const pct = (v: number): string => fmtPct1(v, locale);

  const fy = projection.years[0];
  const last = projection.years[projection.years.length - 1];
  const data: ChartDatum[] = [
    {
      year: projection.anchorYear,
      balScen: projection.anchor.balancePctGdp,
      balBase: projection.anchor.balancePctGdp,
      debtScen: projection.anchor.debtPctGdp,
      debtBase: projection.anchor.debtPctGdp,
    },
    ...projection.years.map((y) => ({
      year: y.year,
      balScen: y.balancePctGdp,
      balBase: y.baselineBalancePctGdp,
      debtScen: y.debtPctGdp,
      debtBase: y.baselineDebtPctGdp,
    })),
  ];

  const seriesLabel: Record<string, string> = {
    balScen: t("budget_policy_proj_leg_bal_scen"),
    balBase: t("budget_policy_proj_leg_bal_base"),
    debtScen: t("budget_policy_proj_leg_debt_scen"),
    debtBase: t("budget_policy_proj_leg_debt_base"),
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingDown className="h-4 w-4" />
          {t("budget_policy_proj_title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Headline: FY balance and end-of-horizon debt, baseline → scenario */}
        <div className="grid gap-2 sm:grid-cols-3 text-xs">
          <div className="rounded-md bg-muted/40 px-2 py-1.5">
            <div className="text-muted-foreground">
              {t("budget_policy_proj_fy_label", { year: fy.year })}
            </div>
            <div className="font-semibold tabular-nums">
              {anyChange ? (
                <>
                  <span className="text-muted-foreground font-normal">
                    {pct(fy.baselineBalancePctGdp)}% →{" "}
                  </span>
                  {pct(fy.balancePctGdp)}%
                </>
              ) : (
                <>{pct(fy.baselineBalancePctGdp)}%</>
              )}
              <span className="text-muted-foreground font-normal">
                {" "}
                ({fmtCompactEur(fy.balanceEur, lang, true)})
              </span>
            </div>
          </div>
          <div className="rounded-md bg-muted/40 px-2 py-1.5">
            <div className="text-muted-foreground">
              {t("budget_policy_proj_debt_label", { year: last.year })}
            </div>
            <div className="font-semibold tabular-nums">
              {anyChange ? (
                <>
                  <span className="text-muted-foreground font-normal">
                    {pct(last.baselineDebtPctGdp)}% →{" "}
                  </span>
                  {pct(last.debtPctGdp)}%
                </>
              ) : (
                <>{pct(last.baselineDebtPctGdp)}%</>
              )}
              <span className="text-muted-foreground font-normal">
                {" "}
                {t("budget_policy_proj_of_gdp")}
              </span>
            </div>
          </div>
          <div className="rounded-md bg-muted/40 px-2 py-1.5">
            <div className="text-muted-foreground">
              {t("budget_policy_proj_interest_label")}
            </div>
            <div
              className={
                "font-semibold tabular-nums " +
                (projection.extraInterestEur > 5e6
                  ? "text-red-700 dark:text-red-400"
                  : projection.extraInterestEur < -5e6
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "")
              }
            >
              {anyChange ? fmtDelta(projection.extraInterestEur, lang) : "—"}
            </div>
          </div>
        </div>

        {/* Macro assumption chips (first projection year) */}
        <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
          {t("budget_policy_proj_macro", {
            year: fy.year,
            growth: pct(fy.realGrowthPct),
            hicp: pct(fy.hicpPct),
            unemp: pct(fy.unemploymentPct),
            gdp: fmtCompactEur(fy.gdpEur, lang),
          })}
        </p>

        <div className="mt-3 h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              {/* Floors/ceilings give extreme scenarios room instead of
                  clipping bars; the Maastricht lines extend the domain when
                  a path approaches them. */}
              <YAxis
                yAxisId="bal"
                domain={[(min: number) => Math.floor(min) - 1, 1]}
                allowDecimals={false}
                tick={{ fontSize: 11 }}
                width={36}
                tickFormatter={(v: number) => `${v}%`}
              />
              <YAxis
                yAxisId="debt"
                orientation="right"
                domain={[0, (max: number) => Math.ceil((max + 4) / 10) * 10]}
                allowDecimals={false}
                tick={{ fontSize: 11 }}
                width={36}
                tickFormatter={(v: number) => `${v}%`}
              />
              <RechartsTooltip
                content={
                  <ProjTooltip
                    labelMap={seriesLabel}
                    fmt={(v) => pct(v)}
                    anyChange={anyChange}
                  />
                }
                cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              />
              <ReferenceLine
                yAxisId="bal"
                y={-3}
                stroke="#e11d48"
                strokeDasharray="2 3"
                label={{
                  value: t("budget_policy_proj_ref3"),
                  position: "insideBottomLeft",
                  fontSize: 10,
                  fill: "#e11d48",
                }}
              />
              <ReferenceLine
                yAxisId="debt"
                y={60}
                stroke="#6366f1"
                strokeDasharray="2 3"
                strokeOpacity={0.6}
                ifOverflow="extendDomain"
                label={{
                  value: t("budget_policy_proj_ref60"),
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "#6366f1",
                }}
              />
              <Bar yAxisId="bal" dataKey="balScen" barSize={18}>
                {data.map((d) => (
                  <Cell
                    key={d.year}
                    fill={d.balScen < 0 ? "#fb7185" : "#34d399"}
                    fillOpacity={d.year === projection.anchorYear ? 0.45 : 0.85}
                  />
                ))}
              </Bar>
              {anyChange ? (
                <Line
                  yAxisId="bal"
                  type="monotone"
                  dataKey="balBase"
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  dot={false}
                />
              ) : null}
              <Line
                yAxisId="debt"
                type="monotone"
                dataKey="debtScen"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
              {anyChange ? (
                <Line
                  yAxisId="debt"
                  type="monotone"
                  dataKey="debtBase"
                  stroke="#6366f1"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  dot={false}
                  strokeOpacity={0.5}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-[#fb7185]" />
            {seriesLabel.balScen}
          </span>
          {anyChange ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-0.5 w-3 bg-[#94a3b8]" />
              {seriesLabel.balBase}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-[#6366f1]" />
            {seriesLabel.debtScen}
          </span>
          {anyChange ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-0.5 w-3 bg-[#6366f1] opacity-50" />
              {seriesLabel.debtBase}
            </span>
          ) : null}
        </div>

        {/* Exact figures per year — nowrap keeps money values intact on
            narrow viewports; the wrapper scrolls instead. */}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full whitespace-nowrap text-xs tabular-nums">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2 font-normal">
                  {t("budget_policy_proj_th_year")}
                </th>
                <th className="py-1 pr-2 font-normal text-right">
                  {t("budget_policy_proj_th_gdp")}
                </th>
                <th className="py-1 pr-2 font-normal text-right">
                  {t("budget_policy_proj_th_balance")}
                </th>
                <th className="py-1 pr-2 font-normal text-right">
                  {t("budget_policy_proj_th_pctgdp")}
                </th>
                <th className="py-1 pr-2 font-normal text-right">
                  {t("budget_policy_proj_th_debt")}
                </th>
                <th className="py-1 font-normal text-right">
                  {t("budget_policy_proj_th_interest")}
                </th>
              </tr>
            </thead>
            <tbody>
              {projection.years.map((y) => (
                <tr key={y.year} className="border-t border-border/60">
                  <td className="py-1 pr-2">{y.year}</td>
                  <td className="py-1 pr-2 text-right text-muted-foreground">
                    {fmtCompactEur(y.gdpEur, lang)}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {fmtCompactEur(y.balanceEur, lang, true)}
                  </td>
                  <td
                    className={
                      "py-1 pr-2 text-right " +
                      (y.balancePctGdp < -3
                        ? "text-red-700 dark:text-red-400"
                        : "")
                    }
                  >
                    {pct(y.balancePctGdp)}%
                  </td>
                  <td className="py-1 pr-2 text-right">{pct(y.debtPctGdp)}%</td>
                  <td className="py-1 text-right">
                    {anyChange
                      ? fmtDelta(y.interestEur - y.baselineInterestEur, lang)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {t("budget_policy_proj_note")}
        </p>
      </CardContent>
    </Card>
  );
};
