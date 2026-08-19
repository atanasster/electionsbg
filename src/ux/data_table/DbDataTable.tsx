// Server-side DataTable for the DB browse pages. Unlike the client DataTable
// (which ships every row and filters/sorts/paginates in the browser), this
// fetches ONE page from /api/db/table and lets Postgres do pagination, sorting,
// filtering and aggregation — so it scales to the big tables (contracts 301k,
// tenders 125k, TR 1M) and can show Σ/count/avg over the WHOLE filtered set.
//
// TanStack in manual mode (manualPagination/Sorting/Filtering); React Query keyed
// on the query state. The registry + query builder live server-side
// (functions/db_table.js); this component only knows column ids + filter values.
// See docs/plans/pg-query-performance.md.

import { ReactNode, useEffect, useMemo, useState, useRef } from "react";
import {
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DataTableColumnDef } from "./utils";
import { cellRender } from "./cellRender";
import { headerRender } from "./headerRender";

export interface DbColumnFilter {
  id: string;
  value?: unknown; // eq / in (array) / text / prefix
  min?: unknown; // range
  max?: unknown;
}

export interface DbTableResponse<T> {
  rows: T[];
  total: number;
  totalExact: boolean;
  page: number;
  pageSize: number;
  aggregates: Record<string, number>;
}

interface Props<T> {
  resource: string;
  columns: DataTableColumnDef<T, unknown>[];
  scope?: { col: string; val: string };
  /** Filters the page always applies (e.g. tag=contract) — not user-editable. */
  fixedFilters?: DbColumnFilter[];
  /** Facet filters driven by the page's own toolbar controls. */
  extraFilters?: DbColumnFilter[];
  defaultSort?: SortingState;
  pageSize?: number;
  searchPlaceholder?: string;
  /** Seed the free-text search box (e.g. from a ?q= deep link). Read ONCE at
   *  mount — a later change to this prop is ignored, so it must not clobber
   *  what the user typed. Deep links that need a fresh seed must remount the
   *  page (every current "see all" entry point does). */
  initialSearch?: string;
  /** Restrict the global free-text search to these logical columns (engine
   *  `filters.globalCols`) — e.g. a dossier seed-repro searches contract TITLE
   *  only, so a landmark term isn't also matched against awarder/contractor name.
   *  An inline array is fine (the request/queryKey hash is structural, so identical
   *  contents trigger no refetch); no memoization needed. */
  globalCols?: string[];
  /** Drop the trigram `%>` arm from the global search, leaving FTS-prefix only
   *  (engine `filters.globalFtsOnly`) — pairs with a single-token dossier seed. */
  globalFtsOnly?: boolean;
  /** Extra toolbar controls (facet selects), rendered next to the search box. */
  toolbar?: ReactNode;
  /** Render the aggregates footer from the server totals. */
  renderAggregates?: (
    agg: Record<string, number>,
    total: number,
    totalExact: boolean,
  ) => ReactNode;
  /** Shortest free-text term this table will SEND. Below it the term is suppressed and
   *  the body shows a "keep typing" hint. Defaults to SEARCH_MIN_CHARS; a resource whose
   *  only searchable column is an identifier (an anchored btree prefix, floor 1 in the
   *  engine) may lower it. Raising it above the engine's floor is safe; lowering it below
   *  is what produces the 400 this exists to avoid. */
  searchMinChars?: number;
  /** Called once per loaded page — lets the parent derive a header (e.g. the entity name)
   *  from the rows without a second request. Does NOT need memoizing: it is invoked through
   *  a ref, so an inline arrow is fine.
   *
   *  `request` is the exact body that produced `resp` — scope, filters, sort and the
   *  DEBOUNCED free-text search this component owns. An exporter needs it to re-issue the
   *  same query at a larger pageSize; without it a "download everything" button silently
   *  drops whatever the user typed. Existing callers may ignore it. */
  onData?: (resp: DbTableResponse<T>, request: Record<string, unknown>) => void;
}

const numFmt = new Intl.NumberFormat("bg-BG");

/** Mirrors SEARCH_MIN_CHARS in functions/db_table.js — the client stops asking and the
 *  server stops answering, so neither depends on the other getting it right. Same shape
 *  as FIT_MIN_QUERY / useFundsFit.
 *
 *  WHY A FLOOR AT ALL (the server-side header carries the measurement): pg_trgm extracts
 *  no trigram from a 1-2 character pattern, so `col ILIKE '%q%'` stops being an index
 *  probe and becomes a full scan of the gin index — 3,447 buffers and 359-490 ms on
 *  contractor_rank, paid twice per keystroke because the count aggregate repeats it.
 *
 *  WHY THE CLIENT HALF IS NOT OPTIONAL: the engine REFUSES a sub-floor term with a 400
 *  rather than serving an empty result (an empty result would read as "no such
 *  contractor"). Without this guard every one- and two-character keystroke — and every
 *  `?q=` deep link shorter than three characters, which bypasses the debounce entirely
 *  because `initialSearch` seeds the debounced state directly — renders the destructive
 *  "Could not load data." panel on 23 of the 24 registry resources.
 *
 *  ⚠️ The floor suppresses the TERM, never the request: the unfiltered page is the right
 *  thing to show while someone is still typing, and it keeps the aggregates footer
 *  coherent with the rows under it. */
export const SEARCH_MIN_CHARS = 3;

/** Count characters as Postgres does. `String.length` is UTF-16 code units, so "👍👍" is
 *  4 by that measure and 2 to pg_trgm — which extracts ZERO trigrams from it, i.e. a
 *  strictly worse case than the two-letter term the floor was written for. NFC first so a
 *  decomposed „é" counts as the one character the reader typed. Deliberately identical to
 *  `termLength` in functions/db_table.js: if the two disagree, one side sends a term the
 *  other refuses. */
const termLength = (s: string): number => [...s.normalize("NFC")].length;

export const DbDataTable = <T,>({
  resource,
  columns,
  scope,
  fixedFilters,
  extraFilters,
  defaultSort = [],
  pageSize = 25,
  searchPlaceholder,
  initialSearch,
  globalCols,
  globalFtsOnly,
  searchMinChars = SEARCH_MIN_CHARS,
  toolbar,
  renderAggregates,
  onData,
}: Props<T>) => {
  const { t } = useTranslation();
  const [sorting, setSorting] = useState<SortingState>(defaultSort);
  const [pageIndex, setPageIndex] = useState(0);
  const [search, setSearch] = useState(initialSearch ?? "");
  const [debounced, setDebounced] = useState(initialSearch ?? "");

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(id);
  }, [search]);

  // Any change to the query shape (filters/search/sort) returns to page 0.
  useEffect(() => setPageIndex(0), [debounced, extraFilters, sorting, scope]);

  // A term the engine would refuse (see SEARCH_MIN_CHARS). Note this reads `debounced`,
  // not `search`: the hint must not flicker on while someone is mid-word, and the request
  // it guards is built from the debounced value anyway.
  const tooShort =
    debounced.trim().length > 0 &&
    termLength(debounced.trim()) < searchMinChars;

  const request = useMemo(
    () => ({
      resource,
      scope,
      page: pageIndex,
      pageSize,
      sort: sorting.map((s) => ({ id: s.id, desc: s.desc })),
      filters: {
        // Suppress the TERM, not the request — the unfiltered page is what a reader
        // should see while still typing, and it keeps the footer's aggregates matching
        // the rows above them.
        global: tooShort ? undefined : debounced || undefined,
        globalCols,
        globalFtsOnly,
        columns: [...(fixedFilters ?? []), ...(extraFilters ?? [])],
      },
    }),
    [
      resource,
      scope,
      pageIndex,
      pageSize,
      sorting,
      debounced,
      tooShort,
      fixedFilters,
      extraFilters,
      globalCols,
      globalFtsOnly,
    ],
  );

  const { data, isFetching, isError } = useQuery({
    queryKey: ["db-table", request],
    queryFn: async (): Promise<DbTableResponse<T>> => {
      const r = await fetch(
        `/api/db/table?q=${encodeURIComponent(JSON.stringify(request))}`,
      );
      if (!r.ok) throw new Error(`table fetch failed: ${r.status}`);
      return (await r.json()) as DbTableResponse<T>;
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  // BOTH the callback and the request are read through refs, so this effect depends on
  // `data` alone — one notification per response, whatever the caller does.
  //
  // Neither is safe as a dependency. `request` is a memo keyed on `scope` / `fixedFilters` /
  // `extraFilters`, which callers routinely pass as inline object literals, and `onData` is
  // just as often an inline arrow — so both get a fresh identity on every render. Depending
  // on either fires this effect every render, and an onData that sets state then re-renders,
  // which loops until React throws "Maximum update depth exceeded". That shipped once and
  // blanked /procurement/contracts; a memoize-me note in the prop docs is not enough, since
  // nothing enforces it and the failure is invisible until a page happens to set state here.
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const requestRef = useRef(request);
  requestRef.current = request;
  useEffect(() => {
    if (data) onDataRef.current?.(data, requestRef.current);
  }, [data]);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount: total,
    state: { sorting, pagination: { pageIndex, pageSize } },
    onSortingChange: setSorting,
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 py-1">
        <Input
          className="w-auto"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder ?? `${t("filter")}...`}
        />
        {toolbar}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {/* Suppressed while the term is below the floor: `total` is then the UNFILTERED
              count, so printing it beside a two-letter query states a number that answers
              a question the reader did not ask. The body carries the hint. */}
          {tooShort ? null : (
            <>
              {data?.totalExact === false ? "≈" : ""}
              {numFmt.format(total)} {t("db_table_rows") || "rows"}
              {isFetching ? " · …" : ""}
            </>
          )}
        </span>
      </div>

      <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-x-auto">
        <Table className="table-auto">
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead
                    key={h.id}
                    colSpan={h.colSpan}
                    // Per-column className (e.g. responsive `hidden md:table-cell`)
                    // — applied to header + every cell so a column hides as a unit.
                    className={
                      (h.column.columnDef as DataTableColumnDef<T, unknown>)
                        .className
                    }
                  >
                    {h.isPlaceholder ? null : headerRender(h)}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="text-secondary-foreground">
            {tooShort ? (
              // Guidance, not failure: the term was never sent, so nothing is broken and
              // `text-destructive` would say otherwise. The rows behind this are the
              // unfiltered page, which is why the hint replaces them rather than sitting
              // above them — showing 3,441 unfiltered contractors under a two-letter
              // query reads as "these are your matches".
              <TableRow>
                <TableCell
                  colSpan={100}
                  className="text-center text-muted-foreground"
                  style={{ height: 400 }}
                >
                  {t("db_table_search_min", { n: searchMinChars }) ||
                    `Type at least ${searchMinChars} characters.`}
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell
                  colSpan={100}
                  className="text-center text-destructive"
                  style={{ height: 400 }}
                >
                  {t("db_table_error") || "Could not load data."}
                </TableCell>
              </TableRow>
            ) : rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="group hover:bg-transparent">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        "px-2 py-1 md:px-3 group-hover:bg-muted/50 align-top",
                        (
                          cell.column.columnDef as DataTableColumnDef<
                            T,
                            unknown
                          >
                        ).className,
                      )}
                    >
                      {cellRender(cell)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={100}
                  className="text-center"
                  style={{ height: Math.max(pageSize * 24, 400) }}
                >
                  {isFetching ? "…" : t("no_results")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-3 py-1 text-sm">
        {renderAggregates && data
          ? renderAggregates(data.aggregates, total, data.totalExact)
          : null}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("db_table_page") || "Page"} {pageIndex + 1} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
            disabled={pageIndex <= 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
            disabled={pageIndex >= pageCount - 1}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
