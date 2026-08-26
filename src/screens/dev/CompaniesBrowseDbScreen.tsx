// The general company registry browser (/companies) — a SEARCH-FIRST browse over
// `company_browse_table` (188), the FULL Commerce Registry corpus (1,022,592 rows). Supersedes
// /governance/companies (OfficialCompaniesScreen, retired): "linked to a person in public life"
// is now one toggle (`?political=1`) on this wider browse instead of a separate page and a
// separate matview. Plan: docs/plans/companies-search-first-v1.md.
//
// ⚠️ THE `has_signal` FLOOR NO LONGER APPLIES TO SEARCH, AND THAT IS THE POINT OF THIS SCREEN.
// It used to be an unconditional client-side `extraFilters` push, which `DbDataTable` ANDs with
// the global term in one `columns` array — so it applied to SEARCHES exactly as it applied to
// browsing, and 923,855 companies (90.34%) could not be found by name or by EIK. Measured
// 2026-08-26: `uic = '205074978'` (ЕЛСЛАК ЕООД, €1.59bn declared capital) returned ZERO rows, as
// did „елслак" and „бета фонд" (Бета Фонд АД, €20.45bn), while both locale corpora and both
// prerendered bodies promised „търсенето обхваща целия регистър" / "the search box reaches the
// whole registry". An exact EIK — the least ambiguous query this corpus accepts, and the one
// `searchWhen` exists to route — answered „нищо намерено" at a 200.
//
// The floor becomes `?scope=signal`, DEFAULTING TO `all`, applied by the landing's primary
// browse button with its size on the label. Three things fall out: the page's own copy becomes
// true; the pickers' counts and the table agree, because both are computed under one scope; and
// the floor is a deliberate act rather than a hidden 90.34% cut with a „Покажи всички" escape.
//
// ⚠️ KEEPING THE FLOOR AS THE *BROWSE* DEFAULT IS ALSO DELIBERATE. The hidden 90.34% is not
// dormant shells — 881,169 of them are `status = 'active'` and 294,032 carry a resolved place —
// but the page has nothing to SAY about them: four of the table's five columns render „—" for a
// hidden row, three of those by construction. It is a phone book, not a story.

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { HubHead } from "@/ux/infographic/HubHead";
import {
  DbDataTable,
  type DbColumnFilter,
  type DbTableResponse,
} from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { SEARCH_MIN_CHARS } from "@/ux/data_table/searchTerm";
import { decodeEntities } from "@/lib/decodeEntities";
import { formatEurCompact } from "@/lib/currency";
import {
  useUrlCompanyFilters,
  COMPANY_FILTER_ALL,
  type CompanyScope,
} from "@/data/companies/useUrlCompanyFilters";
import { useCompanyFacets } from "@/data/companies/useCompanyFacets";
import { CompaniesSearchField } from "@/screens/companies/CompaniesSearchField";
import { CompaniesFilterBar } from "@/screens/companies/CompaniesFilterBar";
import { CompaniesActiveFilters } from "@/screens/companies/CompaniesActiveFilters";
import { CompaniesLanding } from "@/screens/companies/CompaniesLanding";
import {
  companyCardHref,
  companyEvidenceHref,
} from "@/screens/companies/companyCardHref";
import {
  companiesKpis,
  companiesKpiCellCount,
} from "@/screens/companies/companiesKpiBasis";
import {
  EXAMPLE_TERMS,
  URL_MIRROR_MS,
  companiesScopeCount,
  COMPANIES_LANDING_CARDS,
} from "@/screens/companies/companiesBrowseConstants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RegistryFilterOption } from "@/screens/components/RegistryFilterSelect";
import type { FacetOption } from "@/data/registry/useRegistryFacets";

/** One row of the `companies` registry resource (functions/db_table.js). */
export type CompanyBrowseRow = {
  uic: string;
  name: string | null;
  legalForm: string | null;
  seat: string | null;
  status: string | null;
  entityClass: string | null;
  oblastName: string | null;
  obshtinaCode: string | null;
  publicMoneyEur: number | string | null;
  contractorTotalEur: number | string | null;
  contractCount: number | null;
  isMpTied: boolean;
  personCount: number;
  hasRegistryLink: boolean;
  hasDeclaredStake: boolean;
  hasCurrentRole: boolean;
  isOfficialLinked: boolean;
  hasSignal: boolean;
};

const STATUS_CLASSES: Record<string, string> = {
  active:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  in_liquidation:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  bankrupt: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
  ceased: "bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  erased: "bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

const Chip: FC<{ tone: string; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <span
    className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}
  >
    {children}
  </span>
);

/** Sum a facet's buckets. EXACT for a NOT NULL column, and both of the ones used as a
 *  denominator here are: `entity_class` and `status` have zero NULLs across all 1,022,592 rows
 *  (measured 2026-08-26), so their buckets sum to the table. `oblast_name` is NOT usable this
 *  way — it is NULL on 68% of the corpus — which is why the KPI band's `facetTotal` reads the
 *  entity_class facet and never the place one. */
const facetTotal = (buckets?: FacetOption[]): number | undefined =>
  buckets?.reduce((n, b) => n + b.count, 0);

/** One boolean facet's `true` bucket.
 *
 *  ⚠️ THE VALUE IS A JSON BOOLEAN, NOT THE STRING "true", and comparing against the string is a
 *  silent zero. Measured against the live route: `is_official_linked` comes back as
 *  `[{"value":false,…},{"value":true,"count":17675}]` — node-postgres hands a PG `bool` to
 *  `JSON.stringify` as a real boolean, unlike `numeric`, which it serialises as a string. A
 *  `=== "true"` therefore matches nothing and the `?? 0` below turns „17 675 свързани с публично
 *  лице" into „0" — a figure that is not merely wrong but is the one this page exists to
 *  publish. Compared loosely against both spellings so a future serialisation change cannot
 *  re-introduce it.
 *
 *  ⚠️ COALESCED TO 0 ONCE THE FACET HAS ANSWERED, never left undefined. A `GROUP BY` omits a
 *  bucket with no rows, so a raw lookup returns `undefined` for BOTH „not loaded" and „nothing
 *  matched" — and the KPI band reads `undefined` as the first, so an empty bucket would silently
 *  withhold a cell instead of publishing a true „0". */
const boolCount = (
  buckets: FacetOption[] | undefined,
  loaded: boolean,
): number | undefined => {
  if (!buckets) return loaded ? 0 : undefined;
  return (
    buckets.find((b) => b.value === true || b.value === "true")?.count ?? 0
  );
};

export const CompaniesBrowseDbScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const f = useUrlCompanyFilters();
  // ⚠️ `useLocation`, NEVER `window.location`. The router's search is the one a MemoryRouter
  // test can control; reading the global means every test computes hrefs from the ambient jsdom
  // URL and can never catch a regression in them.
  const { search } = useLocation();
  const fmtInt = (n: number) =>
    n.toLocaleString(i18n.language === "bg" ? "bg-BG" : "en-US");
  const fmtEur = (n: number) => formatEurCompact(n, i18n.language);

  // ── THE TERM: local state, mirrored into ?q ──────────────────────────────────────────────
  //
  // ⚠️ TWO DEBOUNCES, AND THEY MUST NOT BE COLLAPSED. None in the field itself (the box must
  // never lag the keyboard); URL_MIRROR_MS here, bounding router churn; and 250 ms inside
  // DbDataTable on the way to the engine, where the SEARCH_MIN_CHARS contract lives. Merging any
  // two couples an SEO/navigation concern to a query-cost one.
  const [term, setTerm] = useState(f.query);
  const setQuery = f.setQuery;
  // The URL is the source of truth on ARRIVAL (a deep link, Back), the box on every keystroke
  // after. Syncing only when they differ keeps a Back press from being swallowed by the mirror.
  const lastMirrored = useRef(f.query);
  useEffect(() => {
    if (f.query !== lastMirrored.current) {
      lastMirrored.current = f.query;
      setTerm(f.query);
    }
  }, [f.query]);
  useEffect(() => {
    if (term === lastMirrored.current) return;
    const id = setTimeout(() => {
      lastMirrored.current = term;
      setQuery(term);
    }, URL_MIRROR_MS);
    return () => clearTimeout(id);
  }, [term, setQuery]);

  // ── WHETHER THERE IS A TABLE AT ALL ──────────────────────────────────────────────────────
  //
  //   · `queryIsSendable` — a term the ENGINE would accept, counted in CHARACTERS. One or two
  //     characters is not yet a query, and `companies` has no unfloored arm to fall back on:
  //     its `uic` column is `searchEq` with `searchWhen: "[0-9]{8,14}"`, so a short term routes
  //     that arm OUT and only `name` (floor 3) survives — which then refuses with a 400, i.e.
  //     the destructive „Данните не можаха да се заредят." panel.
  //   · `hasNarrowingFilters` — a reader saying what they want, INCLUDING through `?obshtina`,
  //     which has no picker. Every cross-link into this page is a filter rather than a query
  //     (`?political=1` from /parliament, /governance/declarations and the OG capture), so a
  //     search-only gate would render a blank page to all of them.
  //   · `browseAll` — the explicit „show me anyway", so the rule can never trap anybody.
  //
  // ⚠️ `scope` IS DELIBERATELY ABSENT, exactly as `?sector` is on /persons. It is which
  // POPULATION you are looking at, not a question about it — if flipping it opened a table, the
  // landing's own scope choice would dismiss the landing.
  const showTable = f.queryIsSendable || f.hasNarrowingFilters || f.browseAll;

  // ── FILTERS SENT TO THE ENGINE ───────────────────────────────────────────────────────────
  const scopeFilter = useMemo<DbColumnFilter[]>(
    () => (f.scope === "signal" ? [{ id: "has_signal", value: true }] : []),
    [f.scope],
  );
  const narrowing = useMemo<DbColumnFilter[]>(() => {
    const out: DbColumnFilter[] = [];
    if (f.political) out.push({ id: "is_official_linked", value: true });
    if (f.entityClass !== COMPANY_FILTER_ALL)
      out.push({ id: "entity_class", value: [f.entityClass] });
    if (f.status !== COMPANY_FILTER_ALL)
      out.push({ id: "status", value: [f.status] });
    if (f.oblast !== COMPANY_FILTER_ALL)
      out.push({ id: "oblast_name", value: [f.oblast] });
    if (f.obshtina !== COMPANY_FILTER_ALL)
      out.push({ id: "obshtina_code", value: f.obshtina });
    // ⚠️ A BOOLEAN, NOT AN OPEN RANGE. `public_money_eur` carries 40,566 distinct values, so a
    // min/max control would be a vocabulary of individual euro amounts — and the figure is
    // `company_public_money`'s UNION of four programmes (ЗОП ∪ ДФЗ ∪ ИСУН ∪ Interreg), so a
    // reader typing „over €1m" filters a number whose basis they have not been told.
    if (f.moneyOnly) out.push({ id: "public_money_eur", min: 0.01 });
    if (f.contractsOnly) out.push({ id: "contract_count", min: 1 });
    return out;
  }, [
    f.political,
    f.entityClass,
    f.status,
    f.oblast,
    f.obshtina,
    f.moneyOnly,
    f.contractsOnly,
  ]);
  const extraFilters = useMemo(
    () => [...scopeFilter, ...narrowing],
    [scopeFilter, narrowing],
  );

  // ── FACETS ───────────────────────────────────────────────────────────────────────────────
  //
  // ⚠️ ONE SPEC PER DIMENSION, EACH EXCLUDING ITS OWN FILTER. Otherwise picking „кооперация"
  // collapses the Вид dropdown to just „кооперация" and the reader cannot switch without
  // clearing first.
  //
  // ⚠️ AND `entity_class` IS FACETED TWICE, WHICH IS WHY EVERY READ BELOW GOES THROUGH `bySpec`.
  // The PICKER's copy excludes `?class`; the head's EVIDENCE aside must not, because it is the
  // corpus breakdown rather than a statement about the filtered set. `Object.assign` hands the
  // second answer to both in `Object.entries` order — measured on /persons at 162×, where the
  // „Бизнес" picker row read 526 while clicking it returned 85,060.
  const without = (id: string) => extraFilters.filter((x) => x.id !== id);
  const { bySpec } = useCompanyFacets({
    klass: { columns: ["entity_class"], filters: without("entity_class") },
    status: { columns: ["status"], filters: without("status") },
    oblast: { columns: ["oblast_name"], filters: without("oblast_name") },
    // The KPI band's linked figure and its denominator. Excludes nothing, because these
    // describe the reader's current set — and each cell is WITHHELD rather than re-captioned
    // when the reader has filtered on its own dimension (see companiesKpiBasis).
    kpis: {
      columns: ["is_official_linked", "entity_class"],
      filters: extraFilters,
    },
    // ⚠️ „HOW MANY WON A CONTRACT" IS A FACET UNDER A FILTER, NOT A FACET ON `contract_count`.
    // That column holds 411 distinct values and `runDbFacets` orders by COUNT and clamps at
    // 500 — so summing „buckets >= 1" is exact only by luck today and silently truncates the
    // moment the corpus grows past the cap, losing the RAREST values, which are the large
    // contract counts. Faceting a NOT NULL column (`entity_class`, 7 buckets) under the filter
    // instead makes the total exact by construction. Verified against the live route: 18,689,
    // matching `count(*) WHERE contract_count > 0`.
    //
    // An unknown column is not an error either — `runDbFacets` silently OMITS it from the
    // response — so a made-up name like `contract_count_any` returns 200 with the figure simply
    // missing, which the band then reads as „nothing matched" and publishes as 0.
    contracts: {
      columns: ["entity_class"],
      filters: [...extraFilters, { id: "contract_count", min: 1 }],
    },
    // The landing's money card, by the same construction.
    money: {
      columns: ["entity_class"],
      filters: [...scopeFilter, { id: "public_money_eur", min: 0.01 }],
    },
    // The landing's contracts card — scope-only, so the number is stable while a reader
    // narrows, matching the other three cards.
    corpusContracts: {
      columns: ["entity_class"],
      filters: [...scopeFilter, { id: "contract_count", min: 1 }],
    },
    // The head's evidence rail and the landing's cards: the corpus breakdown under the SCOPE
    // only, so the numbers are stable while a reader narrows.
    corpus: {
      columns: ["entity_class", "is_official_linked", "has_signal"],
      filters: scopeFilter,
    },
  });

  const classOptions = useMemo<RegistryFilterOption[]>(
    () =>
      (bySpec.klass?.entity_class ?? []).map((b) => ({
        // `String()` because a facet value is not always a string — see FacetOption. Harmless
        // here (`entity_class` is text) and required by the type, which is the point.
        value: String(b.value),
        label: t(`oc_kind_${String(b.value)}`, String(b.value)),
        count: b.count,
      })),
    [bySpec.klass, t],
  );
  const statusOptions = useMemo<RegistryFilterOption[]>(
    () =>
      (bySpec.status?.status ?? []).map((b) => ({
        value: String(b.value),
        label: t(`tr_status_${String(b.value)}`, String(b.value)),
        count: b.count,
      })),
    [bySpec.status, t],
  );
  const oblastOptions = useMemo<RegistryFilterOption[]>(
    () =>
      (bySpec.oblast?.oblast_name ?? []).map((b) => ({
        value: String(b.value),
        // The value IS the label — 188's column is a NAME, not a code, so the picker facets and
        // filters one column and its counts are exact with no dictionary in the client.
        label: String(b.value),
        count: b.count,
      })),
    [bySpec.oblast],
  );

  const corpusLoaded =
    bySpec.corpus != null && "entity_class" in (bySpec.corpus ?? {});
  const scopeCounts = useMemo(() => {
    const all = facetTotal(bySpec.corpus?.entity_class);
    const signal = boolCount(bySpec.corpus?.has_signal, corpusLoaded);
    // ⚠️ Under `?scope=signal` the corpus facet is ALREADY floored, so its total IS the signal
    // count and „all" is unknown from here. Reporting the floored total as the registry size
    // would put „…или целия регистър (98 737)" on the landing.
    return f.scope === "signal"
      ? { all: undefined, signal: all }
      : { all, signal };
  }, [bySpec.corpus, corpusLoaded, f.scope]);

  // ── THE HEAD BAND ────────────────────────────────────────────────────────────────────────
  //
  // ⚠️ THE SCOPE'S SIZE COMES FROM A DIFFERENT REQUEST THAN THE BAND WAITS ON, so the caption
  // has TWO forms. `useRegistryFacets` retries a failure now rather than caching `{}` as a
  // success, but a cold mount whose table beat the facets still reaches this — and a single
  // formatted key would publish „ОТ 0 ФИРМИ В ОБХВАТА" in the largest type on the page.
  const scopeN = companiesScopeCount(f.scope, {
    all: scopeCounts.all ?? 0,
    signal: scopeCounts.signal ?? 0,
  });
  const scopeBasis =
    scopeN > 0
      ? t("companies_basis_scope", {
          defaultValue: "от {{n}} фирми в обхвата",
          n: fmtInt(scopeN),
        })
      : t("companies_basis_scope_unknown", {
          defaultValue: "от фирмите в обхвата",
        });

  const [agg, setAgg] = useState<{
    count?: number;
    sumEur?: number;
    term?: string;
  }>({});
  const handleData = useCallback(
    (
      resp: DbTableResponse<CompanyBrowseRow>,
      request: Record<string, unknown>,
    ) => {
      const filters = request.filters as { global?: string } | undefined;
      setAgg({
        count: resp.aggregates?.count ?? resp.total,
        sumEur: Number(resp.aggregates?.sumPublicMoneyEur ?? 0),
        // The term the figures were ACTUALLY computed under — the table's own debounced value,
        // not whatever is in the box this millisecond. The band echoes it back, so taking it
        // from anywhere else captions a figure with a query that did not produce it.
        term: filters?.global,
      });
    },
    [],
  );
  // ⚠️ THE BASIS FLIPS WITH THE URL AND THE FIGURES DO NOT. `DbDataTable` keeps the previous
  // page while refetching, so without this a filter click paints „Фирми 1 022 592 · ПО
  // ИЗБРАНИТЕ ФИЛТРИ" until the response lands — and a SCOPE switch paints two contradictory
  // numbers in one cell, because `scopeBasis` carries a figure of its own. Skeletons are the
  // honest state.
  useEffect(() => setAgg({}), [extraFilters]);

  const kpiFacetTotal = facetTotal(bySpec.kpis?.entity_class);
  const kpiInput = {
    // NO `?? term` FALLBACK. `agg.term` is undefined in exactly the two cases where the term is
    // NOT in play — the box was cleared, or it is under the engine's floor — and substituting
    // the box's value there captions an UNFILTERED count „по търсене „со"".
    term: agg.term,
    politicalActive: f.political,
    contractsActive: f.contractsOnly,
    filtered: f.hasNarrowingFilters,
    scopeBasis,
    fmtInt,
    fmtEur,
    t,
  };
  const kpiCells = companiesKpis({
    ...kpiInput,
    // ⚠️ TWO SOURCES, AND THE FALLBACK IS NOT A CONVENIENCE. The count normally rides the
    // table's own server-side aggregate — but on the LANDING there is no table, so nothing would
    // ever set it and the band would sit in skeletons for ever on the page a reader arrives at
    // first. The facet total is exact here (`entity_class` is NOT NULL across the corpus) and is
    // the right number for that state, since the landing has no search term in play.
    count: showTable ? agg.count : kpiFacetTotal,
    // ⚠️ EXPLICITLY UNDEFINED ON THE LANDING, not merely absent. Nothing issues a `sum`
    // aggregate without a table, and that is a STABLE state rather than a loading one — so the
    // money cell withholds itself rather than holding the whole band in skeletons.
    sumEur: showTable ? agg.sumEur : undefined,
    linkedCount: boolCount(
      bySpec.kpis?.is_official_linked,
      kpiFacetTotal != null,
    ),
    contractorCount: facetTotal(bySpec.contracts?.entity_class),
    facetTotal: kpiFacetTotal,
  });
  // Derived from the SAME rule, so the skeletons reserve the height the loaded band will
  // occupy. The two states differ by one cell and the difference is knowable up front: with a
  // table the sum WILL arrive (omit the key — optimistic), without one it never will (pass
  // `undefined` explicitly — three cells).
  const pendingCells = companiesKpiCellCount(
    showTable ? kpiInput : { ...kpiInput, sumEur: undefined },
  );

  // ── THE EVIDENCE RAIL ────────────────────────────────────────────────────────────────────
  //
  // ⚠️ THE `entity_class` BREAKDOWN, NOT A MONEY LEADERBOARD, and the refusal is measured. The
  // obvious aside here is „кой получава най-много публични средства" — and four of its top six
  // are the STATE: АВТОМАГИСТРАЛИ ЕАД (€983m), БДЖ-ПЪТНИЧЕСКИ ПРЕВОЗИ (€981m), НК ЖЕЛЕЗОПЪТНА
  // ИНФРАСТРУКТУРА (€950m) and Фонд мениджър на финансови инструменти (€916m). A rail headed
  // „who won the most from the state" reads as a finding while four of them ARE the state
  // receiving its own transfers, and `entity_class` cannot rescue it: only 23 rows corpus-wide
  // are `state_enterprise`, so three of the four render as an ordinary „фирма".
  const evidenceRows = useMemo(
    () =>
      (bySpec.corpus?.entity_class ?? [])
        .filter((b) => b.count > 0)
        .map((b) => ({
          label: t(`oc_kind_${String(b.value)}`, String(b.value)),
          value: fmtInt(b.count),
          // ⚠️ THE SCOPE TRAVELS WITH THE LINK, because the COUNT beside it was computed under
          // the scope. A bare `/companies?class=X` is stripped of `?scope` by
          // usePreserveParams' allowlist, so under the floored scope — the landing's PRIMARY
          // button — „фирма 67 456" would open 988 644 rows.
          to: companyEvidenceHref(
            new URLSearchParams(search),
            f.scope,
            "class",
            String(b.value),
          ),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bySpec.corpus, t, i18n.language, search, f.scope],
  );

  const columns = useMemo<DataTableColumnDef<CompanyBrowseRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: t("oc_col_company") || "Фирма",
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="min-w-0">
              <Link
                to={`/company/${c.uic}`}
                className="font-medium hover:text-primary hover:underline"
              >
                {decodeEntities(c.name ?? c.uic)}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="tabular-nums">{c.uic}</span>
                {/* Projected, not merely filterable: ~3% of the corpus are сдружения,
                    читалища, фондации, кооперации or държавни предприятия, and calling
                    them all „фирми" makes a different and wrong claim about each. */}
                {c.entityClass && c.entityClass !== "company" && (
                  <span>{t(`oc_kind_${c.entityClass}`, c.entityClass)}</span>
                )}
                {c.legalForm && <span>{c.legalForm}</span>}
                {c.status && (
                  <Chip
                    tone={STATUS_CLASSES[c.status] ?? STATUS_CLASSES.active}
                  >
                    {t(`tr_status_${c.status}`, c.status)}
                  </Chip>
                )}
                {c.seat && <span className="truncate">{c.seat}</span>}
              </div>
            </div>
          );
        },
      },
      {
        id: "evidence",
        enableSorting: false,
        header: t("oc_col_evidence") || "Основание",
        cell: ({ row }) => {
          const c = row.original;
          if (!c.isOfficialLinked)
            return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              {c.hasRegistryLink && (
                <Chip tone="bg-primary/10 text-primary">
                  {t("oc_evidence_registry")}
                </Chip>
              )}
              {c.hasDeclaredStake && (
                <Chip tone="bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200">
                  {t("oc_evidence_declared")}
                </Chip>
              )}
              {/* The one chip that is a NEGATIVE: without it a company whose every
                  registry filing has been withdrawn reads as a current attachment. */}
              {c.hasRegistryLink && !c.hasCurrentRole && (
                <Chip tone="bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  {t("oc_evidence_former")}
                </Chip>
              )}
            </div>
          );
        },
      },
      {
        id: "oblast_name",
        accessorFn: (r) => r.oblastName,
        enableSorting: false,
        header: t("oc_col_oblast") || "Област",
        cell: ({ row }) => row.original.oblastName ?? "—",
      },
      {
        id: "contract_count",
        accessorFn: (r) => r.contractCount,
        header: t("companies_col_contracts") || "Поръчки",
        meta: { align: "right" },
        cell: ({ row }) => {
          const c = row.original;
          if (!c.contractCount) return <span>—</span>;
          return (
            <span className="tabular-nums">
              {c.contractCount.toLocaleString("bg-BG")}
              {Number(c.contractorTotalEur ?? 0) > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">
                  (
                  {formatEurCompact(
                    Number(c.contractorTotalEur),
                    i18n.language,
                  )}
                  )
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: "public_money_eur",
        accessorFn: (r) => r.publicMoneyEur,
        header: t("oc_col_money") || "Публични средства",
        meta: { align: "right" },
        cell: ({ row }) =>
          Number(row.original.publicMoneyEur ?? 0) > 0
            ? formatEurCompact(
                Number(row.original.publicMoneyEur),
                i18n.language,
              )
            : "—",
      },
    ],
    [t, i18n.language],
  );

  const chips = [
    f.political && {
      id: "political",
      label: t("companies_filter_political", {
        defaultValue: "Свързана с публично лице",
      }),
      onRemove: () => f.setPolitical(false),
    },
    f.entityClass !== COMPANY_FILTER_ALL && {
      id: "class",
      dimension: t("oc_kind_label", { defaultValue: "Вид" }),
      label: t(`oc_kind_${f.entityClass}`, f.entityClass),
      onRemove: () => f.setEntityClass(COMPANY_FILTER_ALL),
    },
    f.status !== COMPANY_FILTER_ALL && {
      id: "status",
      dimension: t("oc_status_label", { defaultValue: "Състояние" }),
      label: t(`tr_status_${f.status}`, f.status),
      onRemove: () => f.setStatus(COMPANY_FILTER_ALL),
    },
    f.oblast !== COMPANY_FILTER_ALL && {
      id: "oblast",
      dimension: t("oc_col_oblast", { defaultValue: "Област" }),
      label: f.oblast,
      onRemove: () => f.setOblast(COMPANY_FILTER_ALL),
    },
    f.obshtina !== COMPANY_FILTER_ALL && {
      id: "obshtina",
      dimension: t("obshtina_label", { defaultValue: "Община" }),
      // ⚠️ THE RAW CODE, deliberately un-resolved. This corpus spells Столична община `SOF46`,
      // a FOURTH synonym beside the three `obshtinaPlace.ts` knows, and `canonicalObshtina()`
      // maps the governance routes' `SOF00` to `SFO_CITY` — which matches ZERO rows here. A chip
      // resolving „Столична община" over an empty table would be a confident sentence saying the
      // capital contains no companies. Until a producer and a SOF46 fold exist, the code is the
      // honest label.
      label: f.obshtina,
      onRemove: () => f.setObshtina(COMPANY_FILTER_ALL),
    },
    f.moneyOnly && {
      id: "money",
      label: t("companies_filter_money", {
        defaultValue: "с публични средства",
      }),
      onRemove: () => f.setMoneyOnly(false),
    },
    f.contractsOnly && {
      id: "contracts",
      label: t("companies_filter_contracts", {
        defaultValue: "спечелила обществена поръчка",
      }),
      onRemove: () => f.setContractsOnly(false),
    },
  ].filter(Boolean) as {
    id: string;
    dimension?: string;
    label: string;
    onRemove: () => void;
  }[];

  // ⚠️ KEYED BY THE CARD'S OWN KEY, so a card added to COMPANIES_LANDING_CARDS without a
  // producer is a TYPE ERROR rather than a „—" that never resolves. The first cut used a chain
  // of `c.key === …` ternaries ending in `: undefined`, and two of the four fell through it —
  // rendering „—" for ever on a landing whose whole job is to offer four counted ways in.
  const CARD_COUNT: Record<
    (typeof COMPANIES_LANDING_CARDS)[number]["key"],
    () => number | undefined
  > = {
    political: () => boolCount(bySpec.corpus?.is_official_linked, corpusLoaded),
    money: () => facetTotal(bySpec.money?.entity_class),
    contracts: () => facetTotal(bySpec.corpusContracts?.entity_class),
    chitalishta: () =>
      (bySpec.corpus?.entity_class ?? []).find((b) => b.value === "chitalishte")
        ?.count ?? (corpusLoaded ? 0 : undefined),
  };

  const cards = COMPANIES_LANDING_CARDS.map((c) => ({
    key: c.key,
    label: t(c.labelKey, { defaultValue: c.labelFallback }),
    hint: t(c.hintKey, { defaultValue: c.hintFallback }),
    // ⚠️ EVERY COUNT FROM A FACET ALREADY IN FLIGHT, never a constant — this corpus moves under
    // the page on every contracts, agri, funds, TR or person-layer reload, so a hard-coded
    // figure is right on the day it is typed and wrong for as long as nobody checks.
    // `undefined` renders „—" and keeps the grid slot; `0` suppresses the card.
    count: CARD_COUNT[c.key](),
    to: companyCardHref(new URLSearchParams(search), c.param, c.value),
  }));

  return (
    /* data-og is the anchor scripts/og/capture-screens.ts screenshots (slug
       "official-companies", carried over from the retired /governance/companies page — same
       share-card identity, wider scope). It shoots `companies?political=1&elections=…` and waits
       on `tbody tr.group`, which is why `?political` MUST stay a NARROWING: as a scope it would
       render the landing, the wait would time out, and the job would silently keep serving the
       old card. */
    <div className="w-full px-4 md:px-8 pb-12" data-og="official-companies-og">
      <GovernanceBreadcrumb
        sectionKey="companies_browse_title"
        sectionTo="/companies"
      />

      {/* ⚠️ NO <Title>. HubHead renders both the <h1> and the <SEO>, so keeping one would emit
          two h1s — gated statically by hubHead.gates.test.ts and at runtime by tests/ui.spec.ts. */}
      <HubHead
        eyebrow={t("companies_head_eyebrow", {
          defaultValue: "УПРАВЛЕНИЕ · ФИРМИ",
        })}
        title={t("companies_head_title", {
          defaultValue: "Фирми и организации",
        })}
        seoDescription={t("companies_browse_subtitle", {
          defaultValue:
            "Търсене на всяка фирма или организация в Търговския регистър по име или ЕИК.",
        })}
        deck={t("companies_head_deck", {
          defaultValue:
            "Целият Търговски регистър — над милион вписвания. За фирмите с публична следа страницата добавя публичните средства, връзките с лица в публичния живот и спечелените поръчки.",
        })}
        scope={
          // ⚠️ ONLY WHEN A TABLE IS ON SCREEN. On the landing the two browse buttons ARE the
          // scope choice, and offering it twice is the „Бизнес" segment problem /persons had to
          // write a paragraph about.
          showTable ? (
            // ⚠️ A RAW `Select`, NOT `RegistryFilterSelect`, and /persons uses one here for the
            // same reason. That component exists to offer an „all" ITEM alongside a facet's
            // values — but a SCOPE has no „all" state: `all` IS one of the two options. Passing
            // a sentinel it will never match („__never__" with an empty label) renders a blank,
            // selectable item that writes `?scope=__never__` into a URL a reader may share,
            // which `readScope` then silently falls back to `all` — a link that looks specific
            // and is not.
            // The shared Radix Select, never a native <select> (project rule). No
            // `modal={false}` — that prop belongs to `DropdownMenu`; Radix's Select.Root does
            // not take one in this version, and every Select in this repo omits it.
            <Select
              value={f.scope}
              onValueChange={(v) => f.setScope(v as CompanyScope)}
            >
              <SelectTrigger
                className="h-9 w-auto max-w-[260px]"
                aria-label={t("companies_scope_label", {
                  defaultValue: "Обхват",
                })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* ⚠️ THE OPTIONS CARRY THE SCOPE'S OWN SIZE, which is what makes the floor a
                    stated choice rather than a hidden cut. Omitted while a count is still in
                    flight rather than rendered as „(0)". */}
                <SelectItem value="all">
                  {t("companies_scope_all", {
                    defaultValue: "Целият регистър",
                  })}
                  {scopeCounts.all != null
                    ? ` (${fmtInt(scopeCounts.all)})`
                    : ""}
                </SelectItem>
                <SelectItem value="signal">
                  {t("companies_scope_signal", {
                    defaultValue: "С публична следа",
                  })}
                  {scopeCounts.signal != null
                    ? ` (${fmtInt(scopeCounts.signal)})`
                    : ""}
                </SelectItem>
              </SelectContent>
            </Select>
          ) : undefined
        }
        search={
          <CompaniesSearchField
            value={term}
            onChange={setTerm}
            minChars={SEARCH_MIN_CHARS}
            tableVisible={showTable}
            examples={EXAMPLE_TERMS}
            // Only for a reader who arrived at the LANDING. A filter or `?q` deep link means
            // they asked for a list, and parking the cursor in a search box jumps a screen
            // reader past the h1 and the deck.
            autoFocus={!f.query && !f.hasNarrowingFilters}
          />
        }
        kpis={kpiCells}
        kpisPending={pendingCells}
        evidence={
          evidenceRows.length
            ? {
                heading: t("companies_evidence_heading", {
                  defaultValue: "Видове",
                }),
                basis: t("companies_evidence_basis", {
                  defaultValue: "по брой вписвания",
                }),
                rows: evidenceRows,
              }
            : undefined
        }
      />

      <CompaniesFilterBar
        selects={[
          {
            key: "class",
            label: t("oc_kind_label", { defaultValue: "Вид" }),
            allLabel: t("companies_all_kinds", {
              defaultValue: "Всички видове",
            }),
            value: f.entityClass,
            options: classOptions,
            // The hook types this `(v: OrAll<CompanyClass>) => void` on purpose — a typo'd
            // literal must not compile — while the shared spec is `(v: string) => void`,
            // because /persons' dimensions are open vocabularies. The picker's options come
            // from the facet, i.e. from the column itself, so what arrives here is always a
            // real value; `readOneOf` refuses anything else on the next read regardless.
            onChange: f.setEntityClass as (v: string) => void,
            locale: i18n.language === "bg" ? "bg-BG" : "en-US",
          },
          {
            key: "status",
            label: t("oc_status_label", { defaultValue: "Състояние" }),
            allLabel: t("companies_all_statuses", {
              defaultValue: "Всички състояния",
            }),
            value: f.status,
            options: statusOptions,
            onChange: f.setStatus as (v: string) => void,
            locale: i18n.language === "bg" ? "bg-BG" : "en-US",
          },
          {
            key: "oblast",
            // ⚠️ THE COVERAGE IS ON THE CONTROL, not in a footnote somewhere else. 188's own
            // column comment and CLAUDE.md both warn that `oblast_name` is NULL for the ~68% of
            // the corpus whose free-text seat did not resolve through EkatteResolver — it may
            // narrow a view and must never define one. The share is the SAME either side of the
            // floor (33.6% of signal rows, 31.8% of hidden), so it is a property of
            // tr_company_place rather than of the population. There is deliberately no „без
            // област" option: it would read as „companies with no registered seat" over a set
            // that is mostly „we could not resolve the text".
            label: t("companies_oblast_label", {
              defaultValue: "Област (по седалище)",
            }),
            allLabel: t("companies_all_oblasts", {
              defaultValue: "Всички области",
            }),
            value: f.oblast,
            options: oblastOptions,
            onChange: f.setOblast,
            locale: i18n.language === "bg" ? "bg-BG" : "en-US",
          },
        ]}
        toggles={[
          {
            key: "political",
            label: t("companies_filter_political", {
              defaultValue: "Свързана с публично лице",
            }),
            checked: f.political,
            onChange: f.setPolitical,
          },
          {
            key: "money",
            label: t("companies_filter_money", {
              defaultValue: "с публични средства",
            }),
            checked: f.moneyOnly,
            onChange: f.setMoneyOnly,
          },
          {
            key: "contracts",
            label: t("companies_filter_contracts", {
              defaultValue: "спечелила обществена поръчка",
            }),
            checked: f.contractsOnly,
            onChange: f.setContractsOnly,
          },
        ]}
      />

      <CompaniesActiveFilters chips={chips} onClearAll={f.clearFilters} />

      {showTable ? (
        <>
          {/* Only when `?browse` is the ONLY reason the table is up: `browse` is absent from
              `hasActiveFilters`, so it gets no „Изчисти" button and would otherwise be a state
              with no way back to the landing. */}
          {f.browseAll && !f.hasActiveFilters ? (
            <button
              type="button"
              onClick={() => f.setBrowseAll(false)}
              className="mb-3 text-sm text-primary underline underline-offset-2 hover:no-underline"
            >
              {t("companies_back_to_search", {
                defaultValue: "← Назад към търсенето",
              })}
            </button>
          ) : null}
          <DbDataTable<CompanyBrowseRow>
            resource="companies"
            extraFilters={extraFilters}
            columns={columns}
            defaultSort={[{ id: "public_money_eur", desc: true }]}
            pageSize={25}
            // CONTROLLED, input hidden — the head owns the box, because on the landing there is
            // no table for one to sit in.
            search={term}
            hideSearchInput
            onData={handleData}
            renderAggregates={(footerAgg, total) => (
              <span className="text-sm text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">
                  {formatEurCompact(
                    Number(footerAgg.sumPublicMoneyEur ?? 0),
                    i18n.language,
                  )}
                </span>{" "}
                {t("oc_agg_over") || "за"}{" "}
                <span className="tabular-nums">
                  {Number(total ?? 0).toLocaleString("bg-BG")}
                </span>{" "}
                {t("oc_agg_companies") || "фирми"}
              </span>
            )}
          />
        </>
      ) : (
        <CompaniesLanding
          cards={cards}
          counts={scopeCounts}
          onBrowse={f.browseScope}
          fmtInt={fmtInt}
        />
      )}
    </div>
  );
};

export default CompaniesBrowseDbScreen;
