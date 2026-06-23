// /procurement/contracts — the faceted all-contracts browser (SIGMA's Договори
// parity, static-SPA flavour). Year is the first facet (one shard loaded on
// demand); sector / procedure / value / EU filter client-side; DataTable gives
// sort + pagination + CSV + text search. Filters live in the URL (shareable).
//
// Each row deep-links to /procurement/contract/:key (subject cell) and carries
// an inline red-flag (risk) column scored from the row itself — the entity
// flags (debarred / MP-tied / official-tied / concentration) join by EIK/name,
// the single-bidder flag uses the row's bid count, non-open is read off the
// procedure bucket. No per-row fetch.

import { FC, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { Flag, ArrowDownWideNarrow } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Title } from "@/ux/Title";
import { Tooltip } from "@/ux/Tooltip";
import { DataTable } from "@/ux/data_table/DataTable";
import { ProcurementSectionHeader } from "../components/procurement/ProcurementSectionHeader";
import { RiskBadges } from "../components/procurement/RiskBadges";
import { FollowStar } from "../components/procurement/FollowStar";
import {
  useContractIndexMeta,
  useContractYear,
  useAllContractYears,
  type ContractRow,
} from "@/data/procurement/useContractBrowser";
import { useContractRiskScorer } from "@/data/procurement/useContractRiskFlags";
import { useProcurementScope } from "@/data/procurement/useProcurementScope";
import { useProcurementByNs } from "@/data/procurement/useProcurementByNs";
import type { ProcurementContract } from "@/data/dataTypes";
import {
  CPV_DIVISION,
  cpvDivisionName,
  procedureLabel,
  PROCEDURE_LABEL,
  type ProcedureBucket,
} from "@/lib/cpvSectors";
import { formatEur } from "@/lib/currency";

const VALUE_BUCKETS: Record<string, [number, number]> = {
  "0": [0, 1e5],
  "1": [1e5, 1e6],
  "2": [1e6, 1e7],
  "3": [1e7, 1e8],
  "4": [1e8, Infinity],
};
const VALUE_LABEL: Record<string, { bg: string; en: string }> = {
  "0": { bg: "под 100 хил. €", en: "under €100k" },
  "1": { bg: "100 хил. – 1 млн. €", en: "€100k – 1M" },
  "2": { bg: "1 – 10 млн. €", en: "€1 – 10M" },
  "3": { bg: "10 – 100 млн. €", en: "€10 – 100M" },
  "4": { bg: "над 100 млн. €", en: "over €100M" },
};

// Radix Select forbids an empty-string item value, so map the "" ("all") filter
// state to a sentinel on the way in and back to "" on the way out.
const ALL_FILTER = "__all__";
// Year-facet sentinel for the cross-year "All years" merge.
const ALL_YEARS = "all";
const FilterSelect: FC<{
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}> = ({ value, onChange, children }) => (
  <Select
    value={value || ALL_FILTER}
    onValueChange={(v) => onChange(v === ALL_FILTER ? "" : v)}
  >
    <SelectTrigger className="h-8 w-auto gap-1 rounded-md border-border bg-card px-2 text-xs">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>{children}</SelectContent>
  </Select>
);

// Map the row's already-bucketed procedure back to a representative method
// string the risk scorer can classify: "open" stays open (no flag), any other
// known bucket reads as non-open (flagged), and unknown/"" leaves the procedure
// unknown so the check is excluded from the index rather than mis-firing.
const methodForBucket = (b: string): string | undefined => {
  if (!b || b === "unknown") return undefined;
  return b === "open" ? "open" : "negotiated";
};

// Synthesise the minimal ProcurementContract the risk scorer reads from a
// compact browser row. Fields the scorer ignores are left empty. Note: the
// compact row has no tender dates / rationale, so the short-tender-window check
// is "unavailable" here — a row's risk number can therefore differ slightly
// from the same contract's detail page, which scores on the full record.
const toContract = (r: ContractRow): ProcurementContract => ({
  key: r[10] ?? "",
  ocid: "",
  releaseId: "",
  tag: "contract", // the browser excludes amendments upstream
  date: r[0],
  awarderEik: r[1],
  awarderName: r[2],
  contractorEik: r[3],
  contractorName: r[4],
  amountEur: r[5],
  cpv: r[12] || r[6] || undefined,
  procurementMethod: methodForBucket(r[7]),
  numberOfTenderers: typeof r[11] === "number" ? r[11] : undefined,
  euFunded: r[8] === 1 ? true : r[8] === 0 ? false : undefined,
  title: r[9],
  bundleUuid: "",
  sourceUrl: "",
});

const fmtDate = (iso: string, bg: boolean): string => {
  if (!bg || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
};

export const ContractsBrowserScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const [params, setParams] = useSearchParams();

  // Section-wide scope (?pscope), shared with every other procurement page:
  //   "ns"  → the selected parliament's contract window [start, end)
  //   "all" → the full corpus, browsable by the year facet
  const { scope } = useProcurementScope();
  const nsScope = scope === "ns";
  const { data: nsFile, isLoading: nsLoading } = useProcurementByNs();

  const { data: meta } = useContractIndexMeta();
  const years = useMemo(() => meta?.years ?? [], [meta]);
  const yearList = useMemo(() => years.map((y) => y.year), [years]);
  const totalCount = useMemo(
    () => years.reduce((s, y) => s + y.count, 0),
    [years],
  );

  // The year facet only applies in "all" scope; "ns" scope is driven by the
  // parliament window instead.
  const year = params.get("year") || years[years.length - 1]?.year || "";
  const sector = params.get("sector") || "";
  const proc = params.get("proc") || "";
  const eu = params.get("eu") || "";
  const val = params.get("val") || "";
  const flagged = params.get("flagged") === "1";
  const allYears = !nsScope && year === ALL_YEARS;

  // Controlled sort state (initialised from ?sort) — keeping it in the screen
  // lets the "sort by risk" preset flip the sort without remounting the table
  // (which would drop the page / text-filter state).
  const [sorting, setSorting] = useState<SortingState>(() =>
    params.get("sort") === "risk"
      ? [{ id: "risk", desc: true }]
      : [{ id: "value", desc: true }],
  );
  const sortByRisk = sorting[0]?.id === "risk";

  // Parliament window [start, end) — only when ns-scoped + the per-NS file loaded.
  const nsWindow = useMemo(
    () => (nsScope && nsFile ? { start: nsFile.start, end: nsFile.end } : null),
    [nsScope, nsFile],
  );

  // Which year shards to load: every year the ns window touches, the whole
  // corpus for "all years", or none (single-year mode → useContractYear).
  const mergeYears = useMemo(() => {
    if (nsScope) {
      if (!nsFile) return [];
      const sy = nsFile.start.slice(0, 4);
      const ey = nsFile.end
        ? nsFile.end.slice(0, 4)
        : yearList[yearList.length - 1];
      return yearList.filter((y) => y >= sy && (!ey || y <= ey));
    }
    return allYears ? yearList : [];
  }, [nsScope, nsFile, allYears, yearList]);

  const mergeMode = mergeYears.length > 0;
  const single = useContractYear(mergeMode ? undefined : year || undefined);
  const merged = useAllContractYears(mergeYears, mergeMode);
  const rawRows = mergeMode ? merged.data : single.data;

  // Clip to the parliament window when ns-scoped.
  const rows = useMemo(() => {
    if (!rawRows || !nsWindow) return rawRows;
    return rawRows.filter(
      (r) =>
        r[0] >= nsWindow.start && (nsWindow.end == null || r[0] < nsWindow.end),
    );
  }, [rawRows, nsWindow]);

  const { scoreRow, isLoading: scorerLoading } = useContractRiskScorer();
  // Block the table only when a risk-dependent view is active and the risk
  // indexes haven't loaded — otherwise `?flagged=1` would flash an empty table
  // and `?sort=risk` would sort everything as 0 until they resolve.
  const isLoading =
    (nsScope && nsLoading) ||
    (mergeMode ? merged.isLoading : single.isLoading) ||
    ((flagged || sortByRisk) && scorerLoading);

  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        if (v) p.set(k, v);
        else p.delete(k);
        return p;
      },
      { replace: true },
    );

  // Score every loaded row once the risk indexes are ready. Keep only the
  // numeric severity — enough for the risk column's sort and the "only flagged"
  // filter; the chips re-derive the full result for the ~25 visible rows in the
  // cell. Gated on `scorerLoading` so the ~300k-row "all years" set is scored a
  // single time (not re-run as each of the five index files lands).
  const scoreByRow = useMemo(() => {
    const m = new Map<ContractRow, number>();
    if (rows && !scorerLoading)
      for (const r of rows) m.set(r, scoreRow(toContract(r)).score);
    return m;
  }, [rows, scoreRow, scorerLoading]);

  const filtered = useMemo<ContractRow[]>(() => {
    if (!rows) return [];
    const vb = val ? VALUE_BUCKETS[val] : null;
    return rows.filter((r) => {
      if (sector && r[6] !== sector) return false;
      if (proc && r[7] !== proc) return false;
      if (eu === "1" && r[8] !== 1) return false;
      if (eu === "0" && r[8] !== 0) return false;
      if (vb && (r[5] < vb[0] || r[5] >= vb[1])) return false;
      if (flagged && (scoreByRow.get(r) ?? 0) <= 0) return false;
      return true;
    });
  }, [rows, sector, proc, eu, val, flagged, scoreByRow]);

  const summary = useMemo(() => {
    let total = 0;
    let euCount = 0;
    let flaggedCount = 0;
    for (const r of filtered) {
      total += r[5] || 0;
      if (r[8] === 1) euCount++;
      if ((scoreByRow.get(r) ?? 0) > 0) flaggedCount++;
    }
    const n = filtered.length;
    return {
      count: n,
      total,
      euPct: n ? Math.round((100 * euCount) / n) : 0,
      flaggedPct: n ? Math.round((100 * flaggedCount) / n) : 0,
    };
  }, [filtered, scoreByRow]);

  const columns = useMemo<ColumnDef<ContractRow>[]>(
    () => [
      {
        id: "date",
        accessorFn: (r) => r[0],
        header: bg ? "Дата" : "Date",
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {fmtDate(row.original[0], bg)}
          </span>
        ),
      },
      {
        id: "awarder",
        accessorFn: (r) => r[2],
        header: bg ? "Възложител" : "Awarder",
        cell: ({ row }) => (
          <Link to={`/awarder/${row.original[1]}`} className="hover:underline">
            {row.original[2]}
          </Link>
        ),
      },
      {
        id: "contractor",
        accessorFn: (r) => r[4],
        header: bg ? "Изпълнител" : "Contractor",
        cell: ({ row }) => (
          <Link to={`/company/${row.original[3]}`} className="hover:underline">
            {row.original[4]}
          </Link>
        ),
      },
      {
        id: "subject",
        accessorFn: (r) => r[9],
        header: bg ? "Предмет" : "Subject",
        // Subject is the row's deep-link to the full contract page. Only present
        // once the shard carries the key (post re-sync); older shards fall back
        // to plain text.
        cell: ({ row }) => {
          const key = row.original[10];
          const title = row.original[9];
          if (!key)
            return (
              <span className="text-xs text-muted-foreground">{title}</span>
            );
          return (
            <span className="flex items-start gap-1">
              <FollowStar
                kind="contract"
                id={key}
                label={title}
                className="mt-0.5 shrink-0"
              />
              <Link
                to={`/procurement/contract/${key}`}
                className="text-xs text-muted-foreground hover:text-primary hover:underline"
              >
                {title}
              </Link>
            </span>
          );
        },
      },
      {
        id: "sector",
        accessorFn: (r) => cpvDivisionName(r[6], lang),
        header: bg ? "Сектор" : "Sector",
        cell: ({ row }) => {
          const cpv = row.original[12];
          return (
            <span className="text-xs">
              {cpvDivisionName(row.original[6], lang)}
              {cpv ? (
                <span className="block font-mono text-[10px] text-muted-foreground/70">
                  CPV {cpv}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: "proc",
        accessorFn: (r) =>
          r[7] ? procedureLabel(r[7] as ProcedureBucket, lang) : "—",
        header: bg ? "Процедура" : "Procedure",
      },
      {
        id: "eu",
        accessorFn: (r) => (r[8] === 1 ? 1 : 0),
        header: bg ? "ЕС" : "EU",
        cell: ({ row }) => {
          if (row.original[8] !== 1)
            return <span className="text-muted-foreground">—</span>;
          const program = row.original[13];
          const badge = (
            <span className="rounded bg-blue-100 dark:bg-blue-950/40 px-1.5 py-0.5 text-[10px] uppercase">
              {bg ? "ЕС" : "EU"}
            </span>
          );
          // The programme name lands on ~8% of EU rows; tooltip it when present.
          return program ? (
            <Tooltip content={<span className="text-xs">{program}</span>}>
              {badge}
            </Tooltip>
          ) : (
            badge
          );
        },
      },
      {
        id: "value",
        accessorFn: (r) => r[5],
        header: bg ? "Стойност" : "Value",
        cell: ({ row }) => (
          <span className="tabular-nums">{formatEur(row.original[5])}</span>
        ),
      },
      {
        id: "risk",
        accessorFn: (r) => scoreByRow.get(r) ?? 0,
        header: bg ? "Риск" : "Risk",
        cell: ({ row }) => (
          <RiskBadges result={scoreRow(toContract(row.original))} showScore />
        ),
      },
    ],
    [bg, lang, scoreByRow, scoreRow],
  );

  const title = bg ? "Договори" : "Contracts";

  return (
    <>
      <Title description="Browse public-procurement contracts by sector, procedure, value and EU funding">
        {title}
      </Title>
      <ProcurementSectionHeader scopeMode="toggle" />
      <section aria-label={title} className="my-4">
        <p className="text-xs text-muted-foreground mb-3">
          {bg
            ? "Филтрирай по сектор, процедура, стойност и финансиране от ЕС. Натисни предмета, за да отвориш договора. Филтрите се пазят в адреса."
            : "Filter by sector, procedure, value and EU funding. Click the subject to open the contract. Filters are kept in the URL."}
        </p>

        {!isLoading && filtered.length > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
            <span>
              <span className="font-semibold text-foreground">
                {summary.count.toLocaleString(lang)}
              </span>{" "}
              {bg ? "договора" : "contracts"}
            </span>
            <span>
              <span className="font-semibold text-foreground">
                {formatEur(summary.total)}
              </span>{" "}
              {bg ? "общо" : "total"}
            </span>
            <span>
              <span className="font-semibold text-foreground">
                {summary.euPct}%
              </span>{" "}
              {bg ? "с ЕС" : "EU-funded"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Flag className="h-3 w-3 text-rose-500" />
              <span className="font-semibold text-foreground">
                {summary.flaggedPct}%
              </span>{" "}
              {bg ? "със сигнал" : "flagged"}
            </span>
          </div>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            {bg
              ? nsScope || allYears
                ? "Зареждане на договорите…"
                : `Зареждане на договорите за ${year}…`
              : nsScope || allYears
                ? "Loading contracts…"
                : `Loading ${year} contracts…`}
          </p>
        ) : (
          <DataTable
            title="procurement-contracts"
            columns={columns}
            data={filtered}
            pageSize={25}
            sorting={sorting}
            onSortingChange={setSorting}
            toolbarItems={
              <div className="flex flex-wrap items-center gap-2">
                {/* The year facet is an "all years" refinement; in ns scope the
                    parliament window (the scope control) defines the range. */}
                {nsScope ? null : (
                  <FilterSelect value={year} onChange={(v) => set("year", v)}>
                    <SelectItem value={ALL_YEARS}>
                      {bg ? "Всички години" : "All years"} (
                      {totalCount.toLocaleString(lang)})
                    </SelectItem>
                    {years
                      .slice()
                      .reverse()
                      .map((y) => (
                        <SelectItem key={y.year} value={y.year}>
                          {y.year} ({y.count.toLocaleString(lang)})
                        </SelectItem>
                      ))}
                  </FilterSelect>
                )}
                <FilterSelect value={sector} onChange={(v) => set("sector", v)}>
                  <SelectItem value={ALL_FILTER}>
                    {bg ? "Всички сектори" : "All sectors"}
                  </SelectItem>
                  {Object.keys(CPV_DIVISION).map((d) => (
                    <SelectItem key={d} value={d}>
                      {cpvDivisionName(d, lang).slice(0, 40)}
                    </SelectItem>
                  ))}
                </FilterSelect>
                <FilterSelect value={proc} onChange={(v) => set("proc", v)}>
                  <SelectItem value={ALL_FILTER}>
                    {bg ? "Всички процедури" : "All procedures"}
                  </SelectItem>
                  {Object.keys(PROCEDURE_LABEL).map((p) => (
                    <SelectItem key={p} value={p}>
                      {procedureLabel(p as ProcedureBucket, lang)}
                    </SelectItem>
                  ))}
                </FilterSelect>
                <FilterSelect value={val} onChange={(v) => set("val", v)}>
                  <SelectItem value={ALL_FILTER}>
                    {bg ? "Всяка стойност" : "Any value"}
                  </SelectItem>
                  {Object.keys(VALUE_BUCKETS).map((k) => (
                    <SelectItem key={k} value={k}>
                      {bg ? VALUE_LABEL[k].bg : VALUE_LABEL[k].en}
                    </SelectItem>
                  ))}
                </FilterSelect>
                <FilterSelect value={eu} onChange={(v) => set("eu", v)}>
                  <SelectItem value={ALL_FILTER}>
                    {bg ? "ЕС: всички" : "EU: all"}
                  </SelectItem>
                  <SelectItem value="1">
                    {bg ? "само с ЕС" : "EU-funded only"}
                  </SelectItem>
                  <SelectItem value="0">
                    {bg ? "без ЕС" : "non-EU only"}
                  </SelectItem>
                </FilterSelect>
                <button
                  type="button"
                  onClick={() => set("flagged", flagged ? "" : "1")}
                  aria-pressed={flagged}
                  className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs transition-colors ${
                    flagged
                      ? "border-rose-300 bg-rose-100 text-rose-900 dark:border-rose-900 dark:bg-rose-900/40 dark:text-rose-100"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Flag className="h-3 w-3" />
                  {bg ? "само със сигнал" : "flagged only"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSorting(
                      sortByRisk
                        ? [{ id: "value", desc: true }]
                        : [{ id: "risk", desc: true }],
                    );
                    set("sort", sortByRisk ? "" : "risk");
                  }}
                  aria-pressed={sortByRisk}
                  className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs transition-colors ${
                    sortByRisk
                      ? "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ArrowDownWideNarrow className="h-3 w-3" />
                  {bg ? "подреди по риск" : "sort by risk"}
                </button>
              </div>
            }
          />
        )}
      </section>
    </>
  );
};
