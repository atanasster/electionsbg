// /procurement/tenders — the tender-STAGE surface (procedures, before a signed
// contract): the biggest announced procedures with their ESTIMATED (прогнозна)
// value, lots and status, PLUS a full-corpus search by keyword / curated topic /
// year. The search is the verification tool — a posted link
// (/procurement/tenders?topic=guardrails&year=2025) lands the reader on the
// exact facts (the "мантинели за 1 млрд" case).
//
// Hard rule: estimated value is a FORECAST, not money spent, kept out of every
// contracted-spend aggregate. The banner + copy say so.

import { FC, useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import {
  ClipboardList,
  Coins,
  XCircle,
  Layers,
  Info,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from "lucide-react";
import type { TenderSearchRow } from "@/lib/tenderTopics";
import { formatEurCompact } from "@/lib/currency";
import { Title } from "@/ux/Title";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "../dashboard/StatCard";
import { ProcurementSectionHeader } from "../components/procurement/ProcurementSectionHeader";
import { useTendersIndex } from "@/data/procurement/useTendersIndex";
import { useTenderSearch, ALL_YEARS } from "@/data/procurement/useTenderSearch";

const numFmt = new Intl.NumberFormat("bg-BG");

// Compact euro via the SHARED formatter (so this page inherits any euro-format
// fix the rest of the app gets); the only local addition is the "—" empty
// marker the stat cards / rows want in place of the shared formatter's "".
const compactEur = (n: number | undefined, bg: boolean): string =>
  formatEurCompact(n, bg ? "bg" : "en") || "—";

// Strip a leading quote and cap the length, appending "…" only when the string
// was actually truncated (so readers see that text was cut).
const shortSubject = (s: string): string => {
  const cleaned = s.replace(/^[„"'\s]+/, "");
  return cleaned.length > 70 ? cleaned.slice(0, 69) + "…" : cleaned;
};

const SkeletonCard: FC = () => (
  <div className="rounded-xl border bg-card p-4 shadow-sm animate-pulse h-[120px]">
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

export const TendersScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [params, setParams] = useSearchParams();
  const { data: idx, isLoading } = useTendersIndex();

  const q = params.get("q") ?? "";
  const topicSlug = params.get("topic") ?? "";
  const searchMode = q.trim().length > 0 || topicSlug.length > 0;

  // Local text box state, synced from the URL (so a deep-link prefills it).
  const [box, setBox] = useState(q);
  useEffect(() => setBox(q), [q]);

  const years = useMemo(
    () => (idx?.byYear ?? []).map((y) => y.year).sort(),
    [idx],
  );
  const latest = years[years.length - 1] ?? "";
  const year = params.get("year") || (searchMode ? latest : "");

  const search = useTenderSearch(
    { year: year || latest, q, topicSlug, enabled: searchMode },
    years,
  );

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setParam({ q: box.trim() || null, topic: null });
  };
  const clear = () => {
    setBox("");
    setParam({ q: null, topic: null });
  };

  const title = t("procurement_tenders_title") || "Tenders (procedures)";

  if (isLoading || !idx) {
    return (
      <>
        <Title>{title}</Title>
        <ProcurementSectionHeader scopeMode="none" />
        <section className="my-4 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </section>
      </>
    );
  }

  const activeTopic = search.topic;

  // Stat cards reflect the active search selection (topic/keyword + year) when
  // searching; otherwise the whole-corpus totals. While the year shard loads we
  // show "…" rather than a stale global number.
  const scoped = searchMode;
  const loadingScope = searchMode && search.isLoading;
  const statProcedures = scoped ? search.count : idx.totals.procedures;
  const statEstimated = scoped ? search.totalEur : idx.totals.estimatedValueEur;
  const statCancelled = scoped ? search.cancelled : idx.totals.cancelled;
  const statLots = scoped ? search.lots : idx.totals.lots;
  const statBase = scoped ? search.count : idx.totals.procedures;
  const cancelledPct =
    statBase > 0 ? Math.round((100 * statCancelled) / statBase) : 0;
  const num = (n: number): string => (loadingScope ? "…" : numFmt.format(n));
  const money = (n: number): string => (loadingScope ? "…" : compactEur(n, bg));
  const scopeHint = searchMode
    ? `${activeTopic ? activeTopic.label[bg ? "bg" : "en"] : q} · ${year || latest}`
    : `${idx.coverage.firstDay} … ${idx.coverage.lastDay}`;

  return (
    <>
      <Title description="Tender-stage public-procurement procedures (estimated value, lots, status) from the ЦАИС ЕОП open-data feed">
        {title}
      </Title>
      <ProcurementSectionHeader scopeMode="none" />

      <div className="my-3 flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
        <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
        <p>
          {t("tenders_forecast_banner") ||
            "These are estimated (announced) values — a forecast set when the procedure opens, not money spent. A tender becomes spending only once a contract is signed."}
        </p>
      </div>

      {/* Search controls — every change is written to the URL, so any search is
          instantly shareable / quick-postable. */}
      <form
        onSubmit={submit}
        className="my-3 flex flex-wrap items-center gap-2"
        role="search"
      >
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={box}
            onChange={(e) => setBox(e.target.value)}
            placeholder={
              t("tenders_search_placeholder") ||
              "Search tenders by subject or topic…"
            }
            className="pl-8"
            aria-label={t("tenders_search_placeholder") || "Search tenders"}
          />
        </div>
        <Select
          value={year || latest}
          onValueChange={(v) => setParam({ year: v })}
        >
          <SelectTrigger className="w-auto min-w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_YEARS}>
              {t("tenders_all_years") || "All years"}
            </SelectItem>
            {[...years].reverse().map((y) => (
              <SelectItem key={y} value={y}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("tenders_search_button") || "Search"}
        </button>
        {searchMode ? (
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" /> {t("tenders_clear") || "Clear"}
          </button>
        ) : null}
      </form>

      {searchMode ? (
        <p className="mb-2 text-xs text-muted-foreground">
          {t("tenders_stats_scope") || "Totals for the current selection:"}{" "}
          <span className="font-medium text-foreground">{scopeHint}</span>
        </p>
      ) : null}
      <section
        aria-label={title}
        className="my-2 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          label={
            <span className="inline-flex items-center gap-1.5">
              <ClipboardList className="h-4 w-4 text-indigo-600" />
              {t("tenders_stat_procedures") || "Procedures"}
            </span>
          }
          hint={scopeHint}
        >
          <span className="text-2xl font-bold tabular-nums">
            {num(statProcedures)}
          </span>
        </StatCard>
        <StatCard
          label={
            <span className="inline-flex items-center gap-1.5">
              <Coins className="h-4 w-4 text-emerald-600" />
              {t("tenders_stat_estimated") || "Estimated value (forecast)"}
            </span>
          }
          hint={t("tenders_stat_estimated_hint") || "Not contracted spend"}
        >
          <span className="text-2xl font-bold tabular-nums">
            {money(statEstimated)}
          </span>
        </StatCard>
        <StatCard
          label={
            <span className="inline-flex items-center gap-1.5">
              <XCircle className="h-4 w-4 text-amber-600" />
              {t("tenders_stat_cancelled") || "Cancelled"}
            </span>
          }
          hint={t("tenders_stat_cancelled_hint") || "Closed without a contract"}
        >
          <span className="text-2xl font-bold tabular-nums">
            {num(statCancelled)}{" "}
            <span className="text-base font-normal text-muted-foreground">
              · {cancelledPct}%
            </span>
          </span>
        </StatCard>
        <StatCard
          label={
            <span className="inline-flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-sky-600" />
              {t("tenders_stat_lots") || "Lots"}
            </span>
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {num(statLots)}
          </span>
        </StatCard>
      </section>

      {searchMode ? (
        <SearchResults
          search={search}
          year={year || latest}
          activeTopicLabel={
            activeTopic ? activeTopic.label[bg ? "bg" : "en"] : q
          }
        />
      ) : (
        <BiggestAndByYear idx={idx} />
      )}

      <p className="my-4 text-[11px] text-muted-foreground/80">
        {t("tenders_source_note") ||
          "Source: ЦАИС ЕОП open-data tenders feed. Estimated values are forecasts (прогнозна стойност), kept separate from contracted spend."}
      </p>
    </>
  );
};

// --- search results ----------------------------------------------------------
type SortKey = "date" | "buyer" | "subject" | "estimate" | "lots" | "status";
const TEXT_SORT: SortKey[] = ["buyer", "subject"]; // default ascending
const sortValue = (r: TenderSearchRow, k: SortKey): string | number => {
  switch (k) {
    case "date":
      return r.date;
    case "buyer":
      return r.buyerName.toLocaleLowerCase("bg");
    case "subject":
      return r.subject.toLocaleLowerCase("bg");
    case "estimate":
      return r.estimatedValueEur ?? 0;
    case "lots":
      return r.lotsCount ?? 0;
    case "status":
      return r.isCancelled ? 1 : 0;
  }
};

const SearchResults: FC<{
  search: ReturnType<typeof useTenderSearch>;
  year: string;
  activeTopicLabel: string;
}> = ({ search, year, activeTopicLabel }) => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const yearLabel =
    year === ALL_YEARS ? (bg ? "всички години" : "all years") : year;

  const [sortKey, setSortKey] = useState<SortKey>("estimate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const onSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(TEXT_SORT.includes(k) ? "asc" : "desc");
    }
  };

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...search.rows].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === "number" && typeof bv === "number")
        return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "bg") * dir;
    });
  }, [search.rows, sortKey, sortDir]);

  const Th: FC<{ col: SortKey; label: string; align?: "right" }> = ({
    col,
    label,
    align,
  }) => (
    <th
      className={`py-1.5 pr-2 font-medium ${align === "right" ? "text-right" : ""}`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        aria-sort={
          sortKey === col
            ? sortDir === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
        className={`inline-flex items-center gap-0.5 uppercase tracking-wide hover:text-foreground ${
          align === "right" ? "flex-row-reverse" : ""
        } ${sortKey === col ? "text-foreground" : ""}`}
      >
        {label}
        {sortKey === col ? (
          sortDir === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {t("tenders_results_for") || "Results for"} „{activeTopicLabel}“ ·{" "}
          {yearLabel}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {search.isLoading
            ? t("tenders_loading") || "Loading…"
            : `${numFmt.format(search.count)} ${t("tenders_results_count") || "procedures"} · ${compactEur(search.totalEur, bg)} ${t("tenders_results_total") || "estimated total"}`}
        </span>
      </div>
      {search.isLoading ? (
        <div className="h-24 animate-pulse rounded bg-muted/40" />
      ) : search.count === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("tenders_no_results") ||
            "No matching procedures in this year. Try another year or topic."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <Th col="date" label={t("tenders_col_date") || "Date"} />
                <Th col="buyer" label={t("tenders_col_buyer") || "Buyer"} />
                <Th
                  col="subject"
                  label={t("tenders_col_subject") || "Subject"}
                />
                <Th
                  col="estimate"
                  label={t("tenders_col_estimate") || "Estimated"}
                  align="right"
                />
                <Th
                  col="lots"
                  label={t("tenders_col_lots") || "Lots"}
                  align="right"
                />
                <Th col="status" label={t("tender_status") || "Status"} />
              </tr>
            </thead>
            <tbody>
              {sortedRows.slice(0, 100).map((r) => (
                <tr key={r.unp} className="border-t align-top">
                  <td className="py-2 pr-2 tabular-nums text-muted-foreground whitespace-nowrap">
                    {r.date}
                  </td>
                  <td className="py-2 pr-2 text-muted-foreground">
                    {r.buyerName}
                  </td>
                  <td className="py-2 pr-2">
                    <Link
                      to={`/tenders/${r.unp}`}
                      className="hover:underline font-medium"
                    >
                      {shortSubject(r.subject)}
                    </Link>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums font-medium">
                    {compactEur(r.estimatedValueEur, bg)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {r.lotsCount ?? 1}
                  </td>
                  <td className="py-2">
                    {r.isCancelled ? (
                      <span className="text-amber-600">
                        {t("tender_status_cancelled") || "Cancelled"}
                      </span>
                    ) : (
                      t("tender_status_announced") || "Announced"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {search.count > 100 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("tenders_truncated") ||
                "Showing the first 100 of the current sort."}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
};

// --- default dashboard (no search) -------------------------------------------
const BiggestAndByYear: FC<{
  idx: NonNullable<ReturnType<typeof useTendersIndex>["data"]>;
}> = ({ idx }) => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const biggest = idx.topByValue.filter((x) => !x.isCancelled).slice(0, 15);
  return (
    <section className="my-4 grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold mb-3">
          {t("tenders_biggest_title") || "Biggest announced procedures"}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">
                  {t("tenders_col_date") || "Date"}
                </th>
                <th className="py-1.5 pr-2 font-medium">
                  {t("tenders_col_buyer") || "Buyer"}
                </th>
                <th className="py-1.5 pr-2 font-medium">
                  {t("tenders_col_subject") || "Subject"}
                </th>
                <th className="py-1.5 pr-2 font-medium text-right">
                  {t("tenders_col_estimate") || "Estimated"}
                </th>
                <th className="py-1.5 font-medium text-right">
                  {t("tenders_col_lots") || "Lots"}
                </th>
              </tr>
            </thead>
            <tbody>
              {biggest.map((x) => (
                <tr key={x.unp} className="border-t align-top">
                  <td className="py-2 pr-2 tabular-nums text-muted-foreground whitespace-nowrap">
                    {x.publicationDate}
                  </td>
                  <td className="py-2 pr-2 text-muted-foreground">
                    {x.buyerName}
                  </td>
                  <td className="py-2 pr-2">
                    <Link
                      to={`/tenders/${x.unp}`}
                      className="hover:underline font-medium"
                    >
                      {shortSubject(x.subject)}
                    </Link>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums font-medium">
                    {compactEur(x.estimatedValueEur, bg)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {x.lotsCount ?? 1}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold mb-3">
          {t("tenders_by_year_title") || "By year"}
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1.5 font-medium">
                {t("tenders_col_year") || "Year"}
              </th>
              <th className="py-1.5 font-medium text-right">
                {t("tenders_col_procedures") || "Procedures"}
              </th>
              <th className="py-1.5 font-medium text-right">
                {t("tenders_col_estimate") || "Estimated"}
              </th>
            </tr>
          </thead>
          <tbody>
            {idx.byYear.map((y) => (
              <tr key={y.year} className="border-t">
                <td className="py-1.5 tabular-nums">{y.year}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {numFmt.format(y.procedures)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {compactEur(y.estimatedValueEur, bg)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
