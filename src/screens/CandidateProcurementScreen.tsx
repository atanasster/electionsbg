// Standalone per-MP procurement detail page (/candidate/:id/procurement).
// Reached from the "See all" link on the MpConnectedContractsTile on the
// candidate dashboard. Lists every contractor connected to this MP with the
// underlying relation(s), totals, byYear, and the top awarders that paid
// each contractor.

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
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
import { useResolvedCandidate } from "@/data/candidates/useResolvedCandidate";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { useMpConnectedContracts } from "@/data/parliament/useMpConnectedContracts";
import { CandidateHeader } from "./components/candidates/CandidateHeader";
import { ErrorSection } from "./components/ErrorSection";
import { summarizeRelations } from "./components/candidates/procurement/relationLabel";
import type { ProcurementByYear } from "@/data/dataTypes";
import { formatEur, formatEurWithOther } from "@/lib/currency";

// Per-company inline by-year chart. Compact (180px tall), no Card wrapper —
// embeds inline next to the company's relation/contract metadata.
const InlineByYearChart: FC<{
  rows: ProcurementByYear[];
}> = ({ rows }) => {
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

export const CandidateProcurementScreen: FC = () => {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { canonical } = useResolvedCandidate(id);
  const { isEn, nameForBg } = useCandidateName();
  const fallback =
    id && !id.startsWith("mp-") && !id.startsWith("c-")
      ? decodeURIComponent(id)
      : null;
  const lookupName = canonical?.name ?? fallback;
  const displayName = canonical
    ? isEn
      ? canonical.name_en
      : canonical.name
    : nameForBg(fallback);
  const { entries, summary, isLoading } = useMpConnectedContracts(lookupName);

  // Min/max year across every company's by-year breakdown — surfaces a period
  // qualifier on the stats line ("за периода 2011–2026") so the totals aren't
  // read as current-parliament-only.
  let minYear: string | null = null;
  let maxYear: string | null = null;
  for (const e of entries) {
    for (const r of e.byYear) {
      if (!minYear || r.year < minYear) minYear = r.year;
      if (!maxYear || r.year > maxYear) maxYear = r.year;
    }
  }

  if (!lookupName) return null;

  if (!isLoading && entries.length === 0) {
    return (
      <ErrorSection
        title={displayName}
        description={
          t("procurement_no_connected_long") ||
          "No public-procurement contracts were found for companies connected to this candidate. Either the MP's known business graph doesn't intersect the АОП dataset yet, or no such company won a contract during the ingested period."
        }
      />
    );
  }

  return (
    <>
      <CandidateHeader
        displayName={displayName}
        lookupName={lookupName}
        cikRows={canonical?.cikRows}
        subtitle={
          t("procurement_page_title") ||
          "Connected companies with public-procurement contracts"
        }
        seoDescription={`Public-procurement contracts awarded to companies connected to ${displayName}`}
      />
      <div className="w-full max-w-5xl mx-auto px-4 pb-12 space-y-6">
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {t("procurement_page_intro") ||
              "Each row is a company that received a public-procurement contract AND has a recorded business linkage (Commerce Registry role or property-declaration stake) to this MP."}
          </p>
          {entries.length > 0 ? (
            <p className="text-sm">
              <strong>{entries.length}</strong>{" "}
              {t("procurement_page_companies") || "company/-ies"} ·{" "}
              <strong>{summary.contractCount}</strong>{" "}
              {t("procurement_page_contracts") || "contract(s)"} ·{" "}
              <strong>
                {formatEurWithOther(
                  summary.totalEur,
                  summary.totalOther,
                  i18n.language,
                )}
              </strong>{" "}
              {t("procurement_page_total_awarded") || "total awarded"}
              {minYear && maxYear ? (
                <span className="text-muted-foreground">
                  {" · "}
                  {minYear === maxYear ? minYear : `${minYear}–${maxYear}`}{" "}
                  <span className="text-xs">
                    (
                    {t("procurement_page_period_hint") ||
                      "across the full available period"}
                    )
                  </span>
                </span>
              ) : null}
            </p>
          ) : null}
        </header>

        <ul className="flex flex-col gap-3">
          {entries.map((e) => (
            <li
              key={e.contractorEik}
              className="rounded-xl border bg-card p-4 shadow-sm"
            >
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
              <div className="mt-1 text-xs">
                <span className="font-medium text-muted-foreground">
                  {t("procurement_page_relation") || "Relation"}:
                </span>{" "}
                {summarizeRelations(t, e.relations)}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {e.contractCount}{" "}
                {t("procurement_page_contracts") || "contract(s)"}
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
                        <Link
                          to={`/awarder/${a.eik}`}
                          className="hover:underline"
                        >
                          {a.name}
                        </Link>{" "}
                        <span className="text-muted-foreground tabular-nums">
                          (
                          {formatEurWithOther(
                            a.totalEur,
                            a.totalOther,
                            i18n.language,
                          )}
                          , {a.contractCount}{" "}
                          {t("procurement_page_contracts") || "contract(s)"})
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-muted-foreground/80">
          {t("procurement_page_source_hint") ||
            "Source: data.egov.bg (АОП OCDS). MP linkages from cacbg property declarations and Commerce Registry filings. Connections describe what the MP has declared or is on record for — they are not in themselves an accusation of wrongdoing."}
        </p>
      </div>
    </>
  );
};
