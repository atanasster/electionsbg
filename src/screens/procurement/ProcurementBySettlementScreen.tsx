// /procurement/by-settlement — landing page that lists every settlement
// with at least one local-tier contract on file, plus a "national
// procurement" card for the central tier (ministries, state agencies,
// national state companies) whose Sofia HQ is *not* a meaningful proxy
// for where the contract was spent.
//
// Methodology mirrors what's in scripts/procurement/by_settlement.ts and
// what the About page describes — see also [[project_procurement_geo]].

import { FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Building2,
  MapPin,
  Banknote,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Download,
  X,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Title } from "@/ux/Title";
import { Card, CardContent } from "@/ux/Card";
import { Button } from "@/components/ui/button";
import { useProcurementBySettlementIndex } from "@/data/procurement/useSettlementProcurement";
import { provinceToCanon } from "@/data/procurement/useProcurementByOblast";
import { ProcurementChoroplethTile } from "@/screens/components/procurement/ProcurementChoroplethTile";
import { ProcurementSectionHeader } from "@/screens/components/procurement/ProcurementSectionHeader";

const eurFmt = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });
const countFmt = new Intl.NumberFormat("bg-BG");

const PAGE_SIZE = 50;

// A single buyer accounting for the whole total is the norm for small towns
// (≈62% of settlements), so it's only worth flagging when the total is large
// enough to be surprising — e.g. Ковачево (€1.6B, one state-company HQ in a
// village). Below this it's just a town hall procuring for its own commune.
const SINGLE_BUYER_FLAG_EUR = 50_000_000;

// Average contract value is meaningless with a tiny denominator (a one-contract
// village would top the ranking with a fake "average"), so we only compute it
// for settlements with at least this many contracts. ~39% fall below the bar.
const AVG_MIN_CONTRACTS = 5;

type SettlementRow = {
  totalEur: number;
  contractCount: number;
  awarderCount: number;
};

// Mean contract value, or undefined when the sample is too thin to average.
const avgContractEur = (s: SettlementRow): number | undefined =>
  s.contractCount >= AVG_MIN_CONTRACTS
    ? s.totalEur / s.contractCount
    : undefined;

type SortKey =
  | "totalEur"
  | "contractCount"
  | "awarderCount"
  | "avgEur"
  | "name";

export const ProcurementBySettlementScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const q = useProcurementBySettlementIndex();
  const data = q.data;
  const [sortKey, setSortKey] = useState<SortKey>("totalEur");
  const [query, setQuery] = useState("");
  const [oblast, setOblast] = useState<{ code: string; name: string } | null>(
    null,
  );
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.settlements;
    if (oblast) {
      rows = rows.filter((s) => provinceToCanon(s.province) === oblast.code);
    }
    const qLower = query.trim().toLowerCase();
    if (qLower) {
      rows = rows.filter(
        (s) =>
          s.name.toLowerCase().includes(qLower) ||
          s.province.toLowerCase().includes(qLower) ||
          s.obshtina.toLowerCase().includes(qLower) ||
          s.ekatte.includes(qLower),
      );
    }
    const sorted = [...rows].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, "bg");
      if (sortKey === "avgEur") {
        // Settlements with too few contracts have no meaningful average —
        // push them to the bottom instead of letting them top the ranking.
        const av = avgContractEur(a) ?? -Infinity;
        const bv = avgContractEur(b) ?? -Infinity;
        return bv - av;
      }
      return (b[sortKey] as number) - (a[sortKey] as number);
    });
    return sorted;
  }, [data, query, sortKey, oblast]);

  // Biggest total in the current result set — drives the in-cell magnitude
  // bars. sqrt keeps small towns visible without Sofia swamping everything.
  const maxEur = useMemo(
    () => filtered.reduce((m, s) => Math.max(m, s.totalEur), 0),
    [filtered],
  );

  // Reset to the first page whenever the result set changes.
  useEffect(() => setPage(0), [query, sortKey, oblast]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const handleSelectOblast = (canon: string, name: string) =>
    setOblast((cur) => (cur?.code === canon ? null : { code: canon, name }));

  // Export the current filtered+sorted result set (every row, not just the
  // visible page). Semicolon-delimited to match the project's other CSVs and
  // so Bulgarian Excel doesn't split on the comma in numbers.
  const downloadCsv = () => {
    if (filtered.length === 0) return;
    const cols = [
      "EKATTE",
      t("procurement_settlement_col_name") || "Settlement",
      t("procurement_settlement_col_municipality") || "Municipality",
      t("procurement_settlement_col_province") || "Province",
      t("procurement_settlement_col_eur") || "Total EUR",
      t("procurement_settlement_col_contracts") || "Contracts",
      t("procurement_settlement_col_buyers") || "Buyers",
      t("procurement_settlement_col_avg") || "Avg contract EUR",
    ];
    const esc = (v: string) =>
      /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const lines = [cols.join(";")];
    for (const s of filtered) {
      const avg = avgContractEur(s);
      lines.push(
        [
          s.ekatte,
          esc(s.name),
          esc(s.obshtina),
          esc(s.province),
          Math.round(s.totalEur),
          s.contractCount,
          s.awarderCount,
          avg != null ? Math.round(avg) : "",
        ].join(";"),
      );
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `procurement_by_settlement${oblast ? `_${oblast.code}` : ""}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (q.isLoading || !data) {
    return (
      <div>
        <Title>
          {t("procurement_settlement_title") || "Procurement by settlement"}
        </Title>
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  const localShareOfMoney =
    data.totalEur / (data.totalEur + data.national.totalEur);

  // A sortable column header: click sets the sort key. Numeric columns sort
  // descending (down arrow); the name column sorts A→Z (up arrow).
  const sortHeader = (
    key: SortKey,
    label: string,
    opts: { align?: "left" | "right"; className?: string } = {},
  ) => {
    const align = opts.align ?? "left";
    const active = sortKey === key;
    return (
      <th
        scope="col"
        aria-sort={
          active ? (key === "name" ? "ascending" : "descending") : "none"
        }
        onClick={() => setSortKey(key)}
        className={`cursor-pointer select-none px-3 py-2 hover:text-foreground ${
          align === "right" ? "text-right" : "text-left"
        } ${active ? "text-foreground" : ""} ${opts.className ?? ""}`}
      >
        <span
          className={`inline-flex items-center gap-1 ${
            align === "right" ? "justify-end" : ""
          }`}
        >
          {label}
          {active ? (
            key === "name" ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )
          ) : null}
        </span>
      </th>
    );
  };

  return (
    <div>
      <Title>
        {t("procurement_settlement_title") || "Procurement by settlement"}
      </Title>
      <ProcurementSectionHeader
        current="procurement_by_settlement_nav"
        scopeMode="toggle"
      />

      <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
        {t("procurement_settlement_intro_p1") ||
          'Every signed contract published on the central procurement register (АОП) is pinned to the buyer\'s headquarters. We exclude central ministries, state agencies and nationally-operating state companies — their Sofia HQ tells you nothing about where the contract was spent — and aggregate them separately under "National procurement".'}
      </p>

      {/* KPI strip */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_settlements") || "Settlements"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {countFmt.format(data.settlementCount)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_contracts") || "Local contracts"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {countFmt.format(data.totalContracts)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Banknote className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_local_eur") || "Local total"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              €{eurFmt.format(Math.round(data.totalEur))}
            </div>
            <div className="mt-1 text-xs text-muted-foreground tabular-nums">
              {(localShareOfMoney * 100).toFixed(1)}%{" "}
              {t("procurement_settlement_of_total") || "of total spending"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_national_eur") || "National total"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              €{eurFmt.format(Math.round(data.national.totalEur))}
            </div>
            <div className="mt-1 text-xs text-muted-foreground tabular-nums">
              {countFmt.format(data.national.contractCount)}{" "}
              {t("procurement_settlement_contracts") || "contracts"}
              {" · "}
              {countFmt.format(data.national.awarderCount)}{" "}
              {t("procurement_settlement_buyers") || "buyers"}
            </div>
          </CardContent>
        </Card>
      </div>

      <ProcurementChoroplethTile
        activeOblast={oblast}
        onSelectOblast={handleSelectOblast}
      />

      {/* Search + sort controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            t("procurement_settlement_search") ||
            "Search settlement, municipality, province…"
          }
          className="min-w-[220px] flex-1 rounded-md border bg-background px-3 py-1.5 text-sm shadow-sm"
        />
        <span className="text-xs text-muted-foreground sm:hidden inline-flex items-center gap-1.5">
          {t("procurement_settlement_sort") || "Sort by"}:
          <Select
            value={sortKey}
            onValueChange={(v) => setSortKey(v as SortKey)}
          >
            <SelectTrigger
              aria-label={t("procurement_settlement_sort") || "Sort by"}
              className="w-auto gap-1 rounded-md border-border bg-background px-2 py-1 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="totalEur">
                {t("procurement_settlement_sort_eur") || "Total EUR"}
              </SelectItem>
              <SelectItem value="contractCount">
                {t("procurement_settlement_sort_contracts") || "Contracts"}
              </SelectItem>
              <SelectItem value="awarderCount">
                {t("procurement_settlement_sort_buyers") || "Buyers"}
              </SelectItem>
              <SelectItem value="avgEur">
                {t("procurement_settlement_col_avg") || "Avg contract"}
              </SelectItem>
              <SelectItem value="name">
                {t("procurement_settlement_sort_name") || "Name (A→Z)"}
              </SelectItem>
            </SelectContent>
          </Select>
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 gap-1.5 px-2.5"
          onClick={downloadCsv}
          disabled={filtered.length === 0}
          title={t("procurement_settlement_export_csv") || "Download CSV"}
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">
            {t("procurement_settlement_export_csv") || "Download CSV"}
          </span>
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {countFmt.format(filtered.length)}{" "}
          {t("procurement_settlement_results") || "results"}
        </span>
      </div>

      {/* Active oblast filter chip (set by clicking a map) */}
      {oblast && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setOblast(null)}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-primary hover:bg-primary/20"
          >
            <span className="text-muted-foreground">
              {t("procurement_settlement_col_province") || "Province"}:
            </span>
            <span className="font-medium">{oblast.name}</span>
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Sortable settlements table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2 text-left">
                    #
                  </th>
                  {sortHeader(
                    "name",
                    t("procurement_settlement_col_name") || "Settlement",
                  )}
                  <th
                    scope="col"
                    className="hidden px-3 py-2 text-left md:table-cell"
                  >
                    {t("procurement_settlement_col_province") || "Province"}
                  </th>
                  {sortHeader(
                    "totalEur",
                    t("procurement_settlement_col_eur") || "Total EUR",
                    { align: "right", className: "tabular-nums" },
                  )}
                  {sortHeader(
                    "contractCount",
                    t("procurement_settlement_col_contracts") || "Contracts",
                    {
                      align: "right",
                      className: "tabular-nums hidden sm:table-cell",
                    },
                  )}
                  {sortHeader(
                    "avgEur",
                    t("procurement_settlement_col_avg") || "Avg contract",
                    {
                      align: "right",
                      className: "tabular-nums hidden lg:table-cell",
                    },
                  )}
                  {sortHeader(
                    "awarderCount",
                    t("procurement_settlement_col_buyers") || "Buyers",
                    {
                      align: "right",
                      className: "tabular-nums hidden md:table-cell",
                    },
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageRows.map((s, idx) => {
                  const barPct =
                    maxEur > 0
                      ? Math.max(2, Math.sqrt(s.totalEur / maxEur) * 100)
                      : 0;
                  const avg = avgContractEur(s);
                  const singleBuyer =
                    s.awarderCount === 1 && s.totalEur >= SINGLE_BUYER_FLAG_EUR;
                  return (
                    <tr key={s.ekatte} className="hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">
                        {pageStart + idx + 1}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <Link
                            to={`/procurement/settlement/${s.ekatte}`}
                            className="font-medium hover:underline"
                          >
                            {s.name}
                          </Link>
                          {singleBuyer && (
                            <span
                              className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700 dark:text-amber-400"
                              title={
                                t("procurement_settlement_single_buyer_tip") ||
                                "The entire amount comes from a single buyer (often a state-company HQ)."
                              }
                            >
                              {t("procurement_settlement_single_buyer") ||
                                "1 buyer"}
                            </span>
                          )}
                        </span>
                        <div className="text-xs text-muted-foreground md:hidden">
                          {s.province}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">
                        {s.province}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <div className="relative">
                          <div
                            className="absolute inset-y-0 right-0 rounded-sm bg-primary/15"
                            style={{ width: `${barPct}%` }}
                            aria-hidden
                          />
                          <span className="relative">
                            €{eurFmt.format(Math.round(s.totalEur))}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">
                        {countFmt.format(s.contractCount)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums hidden lg:table-cell">
                        {avg != null ? (
                          `€${eurFmt.format(Math.round(avg))}`
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                        {countFmt.format(s.awarderCount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {filtered.length === 0
                ? t("no_results") || "No results"
                : `${t("showing") || "Showing"} ${countFmt.format(
                    pageStart + 1,
                  )}–${countFmt.format(
                    pageStart + pageRows.length,
                  )} ${t("of") || "of"} ${countFmt.format(filtered.length)}`}
            </span>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {t("previous") || "Previous"}
                  </span>
                </Button>
                <span className="tabular-nums">
                  {safePage + 1} / {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2"
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={safePage >= pageCount - 1}
                >
                  <span className="hidden sm:inline">
                    {t("next") || "Next"}
                  </span>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="mt-3 text-xs text-muted-foreground">
        {t("procurement_settlement_table_note") ||
          "“1 buyer” marks settlements whose entire total comes from a single buyer. Average contract value is shown only for settlements with at least 5 contracts."}
      </p>

      <p className="mt-3 text-xs text-muted-foreground">
        {t("procurement_settlement_footnote") ||
          "Buyer HQ is the location proxy. Schools, hospitals, municipalities, universities, regional government offices, forestry districts and local utilities are pinned to their HQ. National procurement (ministries, central agencies, national state companies) is rolled up separately."}{" "}
        <Link to="/about" className="underline hover:no-underline">
          {t("procurement_settlement_methodology_link") ||
            "Read the methodology"}
        </Link>
        .
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {i18n.language === "bg" ? "Източник: " : "Source: "}
        <a
          href="https://data.egov.bg/data/resourceView/3ec550fc-4058-445c-b938-cb21b6d1b0f3"
          target="_blank"
          rel="noopener noreferrer"
          className="underline inline-flex items-center gap-0.5 hover:no-underline"
        >
          data.egov.bg АОП OCDS
          <ArrowRight className="inline h-3 w-3 -rotate-45" />
        </a>
      </p>
    </div>
  );
};
