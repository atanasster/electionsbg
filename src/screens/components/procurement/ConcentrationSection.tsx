// Single-supplier-concentration section, folded into /procurement/flags
// (formerly the standalone /procurement/concentration page). Every flagged
// buyer→supplier pair (≥30% of the buyer's lifetime spend on one supplier,
// buyer ≥ €100k), searchable, sortable, filterable by the buyer's oblast
// (?oblast=BG4xx, or =national for central/unresolved buyers — the link
// ConcentrationOblastTiles opens), with CSV export. A public-record fact per
// row, not an accusation. id="concentration" is the anchor target for links
// into this section from elsewhere on the page and from ConcentrationOblastTiles.

import { FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Button } from "@/components/ui/button";
import { formatEur } from "@/lib/currency";
import { useScopeWindow } from "@/data/scope/useScopeWindow";

const countFmt = new Intl.NumberFormat("bg-BG");
const PAGE_SIZE = 50;
// Radix Select forbids an empty-string item value; sentinel for "all oblasts".
const ALL_OBLASTS = "__all__";

type Row = {
  awarderEik: string;
  awarderName: string;
  contractorEik: string;
  contractorName: string;
  sharePct: number;
  pairTotalEur: number;
  awarderTotalEur: number;
  contractCount: number;
  oblast: string | null;
};

type ConcentrationFullFile = {
  generatedAt: string;
  thresholdPct: number;
  minAwarderTotalEur: number;
  total: number;
  rows: Row[];
};

type SortKey = "sharePct" | "pairTotalEur" | "awarderTotalEur" | "name";

// Scope-aware, DB-backed (/api/db/procurement-concentration → the same
// concentration cases the offline by_ns/concentration + concentration_full
// builders produced): the selected parliament window, or the full corpus.
const useConcentrationFull = () => {
  const { from, to } = useScopeWindow();
  return useQuery({
    queryKey: ["procurement", "concentration", from, to],
    queryFn: async (): Promise<ConcentrationFullFile | null> => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(
        `/api/db/procurement-concentration?${qs.toString()}`,
      );
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as ConcentrationFullFile;
    },
    staleTime: Infinity,
  });
};

const pctFmt = (frac: number, lang: string) =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(frac);

export const ConcentrationSection: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data, isLoading } = useConcentrationFull();
  const [params, setParams] = useSearchParams();
  const oblast = params.get("oblast"); // NUTS code, "national", or null
  const [sortKey, setSortKey] = useState<SortKey>("sharePct");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  // Distinct oblasts present, sorted by flag count — drives the filter dropdown.
  const oblastOptions = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    let national = 0;
    for (const r of data.rows) {
      if (r.oblast) counts.set(r.oblast, (counts.get(r.oblast) ?? 0) + 1);
      else national += 1;
    }
    const list = [...counts.entries()]
      .map(([nuts, count]) => ({ value: nuts, count }))
      .sort((a, b) => b.count - a.count);
    if (national > 0) list.push({ value: "national", count: national });
    return list;
  }, [data]);

  // oblast is now the awarder's seat oblast name (from awarder_seats); show it
  // verbatim. "national" = central / unresolved buyers (no seat).
  const oblastLabel = (value: string) =>
    value === "national" ? t("flags_map_national") || "National" : value;

  // Count-aware noun: BG uses "договор" for 1, the counting form "договора"
  // otherwise; EN "contract"/"contracts".
  const contractsWord = (n: number) =>
    n === 1
      ? t("concentration_contract_one") || "contract"
      : t("procurement_settlement_contracts") || "contracts";

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.rows;
    if (oblast) {
      rows =
        oblast === "national"
          ? rows.filter((r) => !r.oblast)
          : rows.filter((r) => r.oblast === oblast);
    }
    const qLower = query.trim().toLowerCase();
    if (qLower) {
      rows = rows.filter(
        (r) =>
          r.awarderName.toLowerCase().includes(qLower) ||
          r.contractorName.toLowerCase().includes(qLower) ||
          r.awarderEik.includes(qLower) ||
          r.contractorEik.includes(qLower),
      );
    }
    return [...rows].sort((a, b) => {
      if (sortKey === "name")
        return a.awarderName.localeCompare(b.awarderName, "bg");
      return (b[sortKey] as number) - (a[sortKey] as number);
    });
  }, [data, oblast, query, sortKey]);

  useEffect(() => setPage(0), [query, sortKey, oblast]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const setOblast = (value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set("oblast", value);
    else next.delete("oblast");
    setParams(next, { replace: true });
  };

  const downloadCsv = () => {
    if (filtered.length === 0) return;
    const cols = [
      t("concentration_col_awarder") || "Buyer",
      "EIK",
      t("concentration_col_contractor") || "Supplier",
      "EIK",
      t("concentration_col_share") || "Share %",
      t("concentration_col_pair_eur") || "Pair total EUR",
      t("concentration_col_awarder_eur") || "Buyer total EUR",
      t("concentration_col_contracts") || "Contracts",
      t("concentration_col_oblast") || "Oblast",
    ];
    const esc = (v: string) =>
      /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const lines = [cols.join(";")];
    for (const r of filtered) {
      lines.push(
        [
          esc(r.awarderName),
          r.awarderEik,
          esc(r.contractorName),
          r.contractorEik,
          Math.round(r.sharePct * 100),
          Math.round(r.pairTotalEur),
          Math.round(r.awarderTotalEur),
          r.contractCount,
          r.oblast ? esc(r.oblast) : "",
        ].join(";"),
      );
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `procurement_concentration${oblast ? `_${oblast}` : ""}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

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
        aria-sort={active ? "descending" : "none"}
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
          {active ? <ChevronDown className="h-3 w-3" /> : null}
        </span>
      </th>
    );
  };

  return (
    <Card id="concentration">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          {t("flags_concentration") || "Single-supplier concentration"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        {isLoading || !data ? (
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
        ) : (
          <>
            {/* Controls */}
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  t("concentration_search") || "Search buyer, supplier, EIK…"
                }
                className="min-w-[220px] flex-1 rounded-md border bg-background px-3 py-1.5 text-sm shadow-sm"
              />
              <Select
                value={oblast ?? ALL_OBLASTS}
                onValueChange={(v) => setOblast(v === ALL_OBLASTS ? null : v)}
              >
                <SelectTrigger
                  aria-label={t("concentration_col_oblast") || "Oblast"}
                  className="w-auto gap-1 rounded-md border-border bg-background px-2 py-1.5 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_OBLASTS}>
                    {t("concentration_all_oblasts") || "All oblasts"}
                  </SelectItem>
                  {oblastOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {oblastLabel(o.value)} ({countFmt.format(o.count)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5"
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

            {/* Active oblast chip */}
            {oblast && (
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setOblast(null)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-primary hover:bg-primary/20"
                >
                  <span className="text-muted-foreground">
                    {t("concentration_col_oblast") || "Oblast"}:
                  </span>
                  <span className="font-medium">{oblastLabel(oblast)}</span>
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* Table */}
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-10 px-3 py-2 text-left">
                      #
                    </th>
                    {sortHeader(
                      "name",
                      t("concentration_col_pair") || "Buyer → supplier",
                    )}
                    {sortHeader(
                      "sharePct",
                      t("concentration_col_share") || "Share",
                      { align: "right", className: "tabular-nums" },
                    )}
                    {sortHeader(
                      "pairTotalEur",
                      t("concentration_col_pair_eur") || "Pair total",
                      { align: "right", className: "tabular-nums" },
                    )}
                    {sortHeader(
                      "awarderTotalEur",
                      t("concentration_col_awarder_eur") || "Buyer total",
                      {
                        align: "right",
                        className: "tabular-nums hidden md:table-cell",
                      },
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageRows.map((r, idx) => (
                    <tr
                      key={`${r.awarderEik}|${r.contractorEik}`}
                      className="hover:bg-muted/30 align-top"
                    >
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">
                        {pageStart + idx + 1}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          to={`/awarder/${r.awarderEik}`}
                          className="hover:underline"
                        >
                          {r.awarderName}
                        </Link>
                        <span className="text-muted-foreground"> → </span>
                        <Link
                          to={`/company/${r.contractorEik}`}
                          className="font-medium hover:underline"
                        >
                          {r.contractorName}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {r.oblast ? r.oblast : ""}
                          {r.oblast ? " · " : ""}
                          {countFmt.format(r.contractCount)}{" "}
                          {contractsWord(r.contractCount)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="rounded bg-orange-100 dark:bg-orange-900/40 px-1.5 py-0.5 text-[11px] font-semibold">
                          {pctFmt(r.sharePct, lang)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatEur(r.pairTotalEur)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell text-muted-foreground">
                        {formatEur(r.awarderTotalEur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
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
                    onClick={() =>
                      setPage((p) => Math.min(pageCount - 1, p + 1))
                    }
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

            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-orange-600" />
              {t("concentration_note") ||
                "Share is the supplier's portion of the buyer's lifetime procurement spend. A high share is common and legitimate for small buyers — it is a starting point for scrutiny, not proof of wrongdoing. Oblast is the buyer's seat; central buyers are grouped under “National”."}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};
