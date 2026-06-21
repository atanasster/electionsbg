// Shared per-company procurement card — one contractor a person (MP or
// official) is tied to, with the relation summary, euro total, contract count,
// a by-year bar+line chart and the top awarders. Used by both the MP
// procurement page (CandidateProcurementScreen) and the official profile
// (OfficialProcurementSection) so the two render identically. The relation
// summary is precomputed by the caller (MP and official relation shapes differ)
// and passed in as a string.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ProcurementByYear } from "@/data/dataTypes";
import { formatEur, formatEurWithOther } from "@/lib/currency";

// Per-company inline by-year chart. Compact (160px tall), no Card wrapper —
// embeds inline inside the contractor card.
export const InlineByYearChart: FC<{ rows: ProcurementByYear[] }> = ({
  rows,
}) => {
  const { t } = useTranslation();
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => a.year.localeCompare(b.year));
  const data = sorted.map((r) => ({
    year: r.year,
    eur: r.totalEur,
    contractCount: r.contractCount,
  }));
  return (
    <div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground mb-1 leading-none">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-[#d97706]" />
          {t("procurement_page_chart_legend_amount") || "bar: €"}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-[2px] bg-[#2563eb]" />
          {t("procurement_page_chart_legend_count") || "line: contracts"}
        </span>
      </div>
      <div style={{ height: 160, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              className="stroke-border"
            />
            <XAxis
              dataKey="year"
              tickLine={false}
              axisLine={false}
              fontSize={10}
              className="fill-muted-foreground"
            />
            <YAxis
              yAxisId="eur"
              tickFormatter={(v: number) =>
                v >= 1_000_000_000
                  ? `€${(v / 1_000_000_000).toFixed(1)}B`
                  : v >= 1_000_000
                    ? `€${(v / 1_000_000).toFixed(0)}M`
                    : v >= 1_000
                      ? `€${(v / 1_000).toFixed(0)}k`
                      : `€${v}`
              }
              tickLine={false}
              axisLine={false}
              fontSize={10}
              className="fill-muted-foreground"
              width={48}
            />
            <YAxis
              yAxisId="count"
              orientation="right"
              tickLine={false}
              axisLine={false}
              fontSize={10}
              className="fill-muted-foreground"
              width={28}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <div className="rounded-md border bg-popover px-2 py-1.5 text-popover-foreground shadow-sm text-xs">
                    <div className="font-semibold">
                      {payload[0].payload.year}
                    </div>
                    <div className="tabular-nums">
                      {formatEur(payload[0].payload.eur)}
                    </div>
                    <div className="text-muted-foreground tabular-nums">
                      {payload[0].payload.contractCount.toLocaleString("bg-BG")}{" "}
                      {t("procurement_page_contracts") || "contracts"}
                    </div>
                  </div>
                ) : null
              }
            />
            <Bar
              yAxisId="eur"
              dataKey="eur"
              fill="#d97706"
              radius={[2, 2, 0, 0]}
            />
            <Line
              yAxisId="count"
              type="monotone"
              dataKey="contractCount"
              stroke="#2563eb"
              strokeWidth={2}
              dot={{ r: 2.5, fill: "#2563eb" }}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export type ConnectedContractorEntry = {
  contractorEik: string;
  contractorName: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
  byYear: ProcurementByYear[];
  topAwarders: Array<{
    eik: string;
    name: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
  }>;
};

export const ConnectedContractorCard: FC<{
  entry: ConnectedContractorEntry;
  relationSummary: string;
}> = ({ entry: e, relationSummary }) => {
  const { t, i18n } = useTranslation();
  return (
    <li className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Receipt className="h-4 w-4 text-muted-foreground" />
        <Link
          to={`/company/${e.contractorEik}`}
          className="text-base font-semibold hover:underline"
        >
          {e.contractorName}
        </Link>
        <span className="text-xs text-muted-foreground">
          EIK {e.contractorEik}
        </span>
        <span className="ml-auto text-sm tabular-nums font-medium">
          {formatEurWithOther(e.totalEur, e.totalOther, i18n.language)}
        </span>
      </div>
      {relationSummary ? (
        <div className="mt-1 text-xs">
          <span className="font-medium text-muted-foreground">
            {t("procurement_page_relation") || "Relation"}:
          </span>{" "}
          {relationSummary}
        </div>
      ) : null}
      <div className="mt-2 text-xs text-muted-foreground">
        {e.contractCount} {t("procurement_page_contracts") || "contract(s)"}
        {e.awardCount > 0
          ? ` · ${e.awardCount} ${t("procurement_page_awards") || "award(s)"}`
          : ""}
      </div>

      {e.byYear.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-medium text-muted-foreground mb-1">
            {t("procurement_page_by_year") || "By year"}
          </div>
          <InlineByYearChart rows={e.byYear} />
        </div>
      ) : null}

      {e.topAwarders.length > 0 ? (
        <details className="mt-2 text-xs" open>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {t("procurement_page_top_awarders") || "Top awarders"}
          </summary>
          <ul className="mt-1 pl-4 list-disc space-y-0.5">
            {e.topAwarders.map((a) => (
              <li key={a.eik}>
                <Link to={`/awarder/${a.eik}`} className="hover:underline">
                  {a.name}
                </Link>{" "}
                <span className="text-muted-foreground tabular-nums">
                  ({formatEurWithOther(a.totalEur, a.totalOther, i18n.language)}
                  , {a.contractCount}{" "}
                  {t("procurement_page_contracts") || "contract(s)"})
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
};
