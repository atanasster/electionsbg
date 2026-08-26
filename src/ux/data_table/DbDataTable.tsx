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
// The search floor lives in its own module — /persons reads it to decide whether to render a
// table at all, and a page must be able to ask that without importing a React component.
import { SEARCH_MIN_CHARS, termLength } from "./searchTerm";

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

/** The free-text search seam, as a DISCRIMINATED UNION rather than four independent
 *  optionals — because three of the eight combinations are wrong and two of the three are
 *  silent at runtime. A flat interface can only express the rules as a DEV `console.error`,
 *  which a production build does not enforce and a caller who never opens the console never
 *  sees. The arms below make the wrong combinations fail to compile:
 *
 *    1. UNCONTROLLED — this component owns the term. `initialSearch` seeds it once. This is
 *       what every registry resource but /persons passes (i.e. nothing at all).
 *    2. CONTROLLED, input hidden — the page renders its own field. The /persons shape.
 *    3. CONTROLLED, input visible — then `onSearchChange` is REQUIRED, because the input's
 *       value comes from the parent, so that callback is the ONLY channel by which a
 *       keystroke can reach anything. Without it the box silently swallows every character
 *       at a 200, which is the wrong-answer-served-quietly shape this file exists to avoid.
 *
 *  ⚠️ `undefined` IS THE MODE, not an empty term. A controlled parent passes `""` for an
 *  absent term — never `?? undefined`, which is the idiom a URL-owned term invites
 *  (`params.get("q") ?? undefined`) and which would flip the component to uncontrolled the
 *  moment the reader clears the box. The mode is pinned at mount and DEV-logged if it moves. */
type SearchProps =
  | {
      search?: undefined;
      /** Seed the free-text search box (e.g. from a ?q= deep link). Read ONCE at
       *  mount — a later change to this prop is ignored, so it must not clobber
       *  what the user typed. Deep links that need a fresh seed must remount the
       *  page (every current "see all" entry point does). */
      initialSearch?: string;
      /** Reports the term back on every edit of the built-in input. Optional here —
       *  the component's own state already keeps the box working without it. */
      onSearchChange?: (term: string) => void;
      /** Hiding the input uncontrolled would leave a term nobody can type or clear. */
      hideSearchInput?: false;
      /** ⚠️ REFUSED OFF THE CONTROLLED-AND-HIDDEN ARM. „Committed" is a claim about a term the
       *  PARENT owns and submits; an uncontrolled box is typed into, so the debounce there is
       *  what stands between a keystroke and a round trip. */
      searchIsCommitted?: never;
    }
  | {
      /** CONTROLLED free-text search — the page owns the term (typically in the URL).
       *
       *  ⚠️ THE 250 ms DEBOUNCE AND THE `SEARCH_MIN_CHARS` FLOOR STAY HERE IN BOTH MODES,
       *  and that is the whole point of controlling the VALUE rather than the request: the
       *  engine refuses a sub-floor term with a 400, so its client-side guard must have
       *  exactly one home. A page that debounced and floored the term itself and handed
       *  over a finished request would be a second implementation of a contract that is
       *  already easy to get wrong (see `termLength` — `String.length` sends "👍👍" and
       *  collects the 400). */
      search: string;
      /** A seed the controlled parent does not hold is a term the reader cannot clear. */
      initialSearch?: never;
      /** The page renders its own search field. */
      hideSearchInput: true;
      onSearchChange?: (term: string) => void;
      /** The parent's `search` is a COMMITTED term — it changes once per reader intention (a
       *  submitted search box), never per keystroke. Skips the debounce below.
       *
       *  ⚠️ EXPLICIT, NEVER INFERRED FROM `search !== undefined`. Controlled does not mean
       *  committed: /persons and /companies were controlled AND typed into for months, so a
       *  `if (controlled) skip` would have sent one request per keystroke against a 1.02M-row
       *  corpus — the exact regression the debounce's own doc-block is about. It is opt-in, so
       *  a caller that says nothing keeps the debounce.
       *
       *  ⚠️ IT ONLY REMOVES LATENCY THAT IS ALREADY PURE. A committed term cannot arrive in a
       *  burst, so the debounce absorbs nothing on the FIRST search either way (`debounced` is
       *  seeded from `search` at mount, so that request goes out immediately). What it costs is
       *  every REFINEMENT while a table is already up: a flat 250 ms after an explicit button
       *  press, with nothing to coalesce. */
      searchIsCommitted?: boolean;
    }
  | {
      search: string;
      initialSearch?: never;
      hideSearchInput?: false;
      /** REQUIRED in this arm: the input is fully controlled by the parent's value, so
       *  this is the ONLY way a keystroke can reach it. */
      onSearchChange: (term: string) => void;
      /** ⚠️ REFUSED HERE TOO, and this is the arm the refusal is FOR. The parent owns the term
       *  and the box is visible, so the parent is being typed into character by character —
       *  which is exactly what "controlled" looks like without being committed, and why the
       *  flag could not simply be inferred from `search !== undefined`. */
      searchIsCommitted?: never;
    };

interface BaseProps<T> {
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

type Props<T> = BaseProps<T> & SearchProps;

const numFmt = new Intl.NumberFormat("bg-BG");

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
  search,
  onSearchChange,
  hideSearchInput,
  searchIsCommitted,
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
  // CONTROLLED when `search` is passed, else this component's own state. One `term` feeds
  // the debounce below either way, so the floor, the page reset and the request shape are
  // identical in both modes — there is no second code path to keep in step.
  //
  // ⚠️ THE MODE IS PINNED AT MOUNT. `inner` can only be seeded once, so a parent that moved
  // `search` between a string and `undefined` would flip modes with no recovery: going
  // uncontrolled the reader's term falls back to an `inner` frozen at "" since mount and the
  // built-in box reappears under a page rendering its own. The idiom that produces it is the
  // natural one for a URL-owned term — `params.get("q") ?? undefined`, which is `undefined`
  // exactly when the deep link carries no `?q=`. The type forbids it; this makes a JS caller
  // that does it anyway loud rather than silently wrong.
  const controlledAtMount = useRef(search !== undefined);
  const controlled = controlledAtMount.current;
  const [inner, setInner] = useState(controlled ? "" : (initialSearch ?? ""));
  const term = controlled ? (search ?? "") : inner;
  const [debounced, setDebounced] = useState(
    controlled ? (search ?? "") : (initialSearch ?? ""),
  );

  // DEV mis-wiring guards, in an EFFECT rather than in render. A controlled table re-renders
  // on every keystroke of the parent's field, so an in-render guard emits one console.error
  // per character (doubled again by StrictMode) — the signal that should make the mistake
  // obvious becomes a wall the developer scrolls past. The union type already refuses each of
  // these from TypeScript; these are the backstop for a JS caller and for a prop spread.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (controlledAtMount.current !== (search !== undefined))
      console.error(
        "[DbDataTable] `search` switched between controlled and uncontrolled. The mode is " +
          'pinned at mount; pass `search={q ?? ""}` (never `?? undefined`), or remount the table.',
      );
    if (controlled && initialSearch !== undefined)
      console.error(
        "[DbDataTable] `search` and `initialSearch` are mutually exclusive — `search` wins. A seed the controlled parent does not hold is a term the reader cannot clear.",
      );
    if (hideSearchInput && !controlled)
      console.error(
        "[DbDataTable] `hideSearchInput` without `search` hides the only way to type or clear the term.",
      );
    if (controlled && !hideSearchInput && !onSearchChange)
      console.error(
        "[DbDataTable] `search` with a visible built-in input needs `onSearchChange` — the " +
          "parent owns the value, so without it the box discards every keystroke.",
      );
  }, [controlled, search, initialSearch, hideSearchInput, onSearchChange]);

  useEffect(() => {
    // A committed term is already the reader's finished intention, so there is nothing to
    // coalesce — waiting is latency after an explicit button press. Every other caller keeps
    // the debounce, including a CONTROLLED one that types (a supported arm), because
    // controlled is not the same claim as committed.
    if (searchIsCommitted) {
      setDebounced(term);
      return;
    }
    const id = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(id);
  }, [term, searchIsCommitted]);

  // Any change to the query shape (filters/search/sort) returns to page 0.
  //
  // ⚠️ KEYED ON CONTENT, NOT IDENTITY. `extraFilters` and `scope` are routinely passed as
  // inline object literals (`scope={{ col: "scope", val }}` in ten screens), so their identity
  // changes on every PARENT render — which would send a reader who has paged deep back to
  // page 1 for a re-render that changed nothing about the query. A controlled parent makes
  // that constant: it re-renders on every keystroke of its own field, and during the 250 ms
  // debounce `debounced` has not moved. React Query's own key is hashed structurally for the
  // same reason (see the `globalCols` note above).
  const shapeKey = JSON.stringify([extraFilters ?? null, scope ?? null]);
  useEffect(() => setPageIndex(0), [debounced, shapeKey, sorting]);

  // A term the engine would refuse (see SEARCH_MIN_CHARS). Note this reads `debounced`,
  // not `term`: the hint must not flicker on while someone is mid-word, and the request
  // it guards is built from the debounced value anyway.
  //
  // TRIMMED ONCE and used for BOTH the floor and the request. Measuring one string and
  // sending a different one makes "апи" and "апи " two React Query entries, two onData
  // notifications and two exporter re-issues for one identical server-side query — and sends
  // a whitespace-only term in full, which matches everything. A URL-owned term makes stray
  // whitespace likelier, not rarer.
  const trimmed = debounced.trim();
  const tooShort = trimmed.length > 0 && termLength(trimmed) < searchMinChars;

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
        global: tooShort ? undefined : trimmed || undefined,
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
      trimmed,
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
      {/* Skipped entirely when it would be empty — with the input hidden, no toolbar and a
          below-floor term, the row is a stray `py-1` gap between the page's own search field
          and the table. */}
      {!hideSearchInput || toolbar || !tooShort ? (
        <div className="flex flex-wrap items-center gap-2 py-1">
          {hideSearchInput ? null : (
            <Input
              className="w-auto"
              type="search"
              value={term}
              onChange={(e) => {
                // Controlled: report ONLY — the parent owns the value, so writing `inner`
                // here would fork the two and let the input drift from the URL.
                if (!controlled) setInner(e.target.value);
                onSearchChange?.(e.target.value);
              }}
              placeholder={searchPlaceholder ?? `${t("filter")}...`}
            />
          )}
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
      ) : null}

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
