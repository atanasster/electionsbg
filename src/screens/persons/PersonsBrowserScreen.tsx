// The global persons browser (/persons) — a server-side paginated/sorted/filtered
// DbDataTable over the whole 56,801-person identity layer (matview person_browse_table,
// migration 120). Plan: docs/plans/persons-browser-v1.md.
//
// Every other person surface on the site is either ONE profile reached by search
// (/person/:slug) or ONE facet ranked by wealth (/officials/assets, /mp-assets). This is
// the first that lets a reader ask a question ACROSS the layer — every councillor in
// Бургас who also runs a company, everyone who has switched parties, which magistrates
// declared a stake. It mirrors ContractsBrowserDbScreen's rhythm so the two browsers read
// as one system.
//
// FILTERING GOES THROUGH THE PADDED CODE SETS, never the display scalar beside them. A
// person holds many roles in many places; `oblast_code` is the representative seat, and
// filtering on it would drop 1,851 people from an oblast they genuinely serve — which
// renders as "no such people" rather than as a narrowed view. Same reasoning for party:
// ?party=gerb means "ever affiliated", which is what a reader means, and which keeps the
// 4,723 party-switchers visible.
//
// THE AVATAR IS PRESENTATIONAL (MpAvatarView, not MpAvatar). photo_url is denormalized
// into the matview precisely so this page never downloads parliament/index.json for a
// face — a 972 KB index for one avatar is a regression this codebase has already fixed
// once (project_mp_avatar_index). The trade is that this screen must apply the dataUrl
// seam ITSELF (see the avatar cell): the index hook resolves photo paths at ingest, and
// skipping the index means skipping that too.

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HubHead, type HubEvidenceRow } from "@/ux/infographic/HubHead";
import {
  DbDataTable,
  type DbColumnFilter,
  type DbTableResponse,
} from "@/ux/data_table/DbDataTable";
import { SEARCH_MIN_CHARS } from "@/ux/data_table/searchTerm";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { Breadcrumbs } from "@/ux/Breadcrumbs";
import { MpAvatarView } from "@/screens/components/candidates/MpAvatar";
import { resolvePhoto } from "@/data/parliament/useMps";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { usePersonLabels } from "@/lib/personLabels";
import {
  useUrlPersonFilters,
  PERSON_FILTER_ALL,
  codeSetMatch,
} from "@/data/persons/useUrlPersonFilters";
import { usePersonFacets } from "@/data/persons/usePersonFacets";
import { facetKey } from "@/data/registry/useRegistryFacets";
import {
  PERSON_GROUPS,
  GROUP_COLUMNS,
  groupByKey,
} from "@/data/persons/personGroups";
import { type PersonFilterOption } from "./PersonFilterSelect";
import {
  PersonsFilterBar,
  type PersonsFilterSpec,
  type PersonsToggleSpec,
} from "./PersonsFilterBar";
import {
  PersonsActiveFilters,
  type ActiveFilterChip,
} from "./PersonsActiveFilters";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PersonsAnalysisStrip } from "./PersonsAnalysisStrip";
import { personsKpis, personsKpiCellCount } from "./personsKpiBasis";
import { PersonsSearchField } from "./PersonsSearchField";
import { PersonsLanding, type LandingCard } from "./PersonsLanding";
import { useRegistryDraft } from "@/screens/components/useRegistryDraft";
import { PersonNetWorthCell, PersonMoneyCell } from "./PersonMoneyCells";
import { oblastName } from "@/lib/regionalOblast";
import { useObshtinaLabel } from "@/data/municipalities/useObshtinaLabel";
import {
  fetchPersonsCsv,
  downloadCsv,
  EXPORT_MAX,
} from "@/data/persons/exportPersonsCsv";
import type { PersonBrowseRow } from "@/data/persons/personBrowseTypes";
// Constants and pure rules live beside the screen rather than in it — a component file that
// also exports non-components breaks Fast Refresh, and each of these is a claim a test needs
// to make without mounting anything.
import { EXAMPLE_TERMS, personsScopeCount } from "./personsBrowseConstants";

export const PersonsBrowserScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language?.startsWith("bg") ?? true;
  const { colorFor, displayNameForId } = useCanonicalParties();
  const { roleLabel, rolePluralLabel, facetLabel } = usePersonLabels();
  // The live query string, for the evidence hrefs. NOT `useSearchParams` — `?q` has exactly
  // one reader in this screen (the hook), and a second one would disagree with it past
  // QUERY_MAX.
  const { search: activeSearch } = useLocation();

  const {
    sector,
    facet,
    primaryFacet,
    role,
    party,
    oblast,
    court,
    declaredOnly,
    heldOfficeOnly,
    switchersOnly,
    obshtina,
    query,
    queryIsSendable,
    browseAll,
    setBrowseAll,
    setQuery,
    setSector,
    setFacet,
    setPrimaryFacet,
    setRole,
    setParty,
    setOblast,
    setCourt,
    // ?obshtina has no picker — it is the destination of the governance dashboard's „хора,
    // свързани с …" link, not something anyone browses to among 289 options. It is validated,
    // filtered, chipped and cleared like the rest.
    setDeclaredOnly,
    setHeldOfficeOnly,
    setSwitchersOnly,
    setObshtina,
    hasNarrowingFilters,
    clearFilters,
  } = useUrlPersonFilters();

  // Deferred: municipalities.json is only fetched when there is actually a municipality to
  // name, i.e. when the chip below will render.
  const obshtinaLabel = useObshtinaLabel(obshtina !== PERSON_FILTER_ALL);

  // ── THE TERM ────────────────────────────────────────────────────────────────────────
  //
  // A local DRAFT in the box, the COMMITTED term in `?q`, and nothing crossing between them
  // except a submit and a URL move. The rule — and the reason it needs no echo/move ref, which
  // is what the 350 ms URL mirror used to require — lives once, in `useRegistryDraft`, because
  // /companies holds the identical block.
  const { draft, setDraft, onSubmitQuery, onClearAll, searching } =
    useRegistryDraft(query, setQuery, clearFilters);

  // ── WHETHER THERE IS A TABLE AT ALL ────────────────────────────────────────────────
  //
  // The rule, and each clause is load-bearing:
  //
  //   · `queryIsSendable` — a term the ENGINE would accept, counted in characters. One or two
  //     characters is not yet a query, and opening a table on it would send the engine a term
  //     it answers with a 400, i.e. the destructive error panel, on a page whose whole design
  //     is that the table appears only when it can answer.
  //   · `hasNarrowingFilters` — a reader saying what they want, INCLUDING through the two
  //     param with no picker. Every cross-link into this page is a filter rather than a
  //     query, so a search-only gate would render a blank page to all of them.
  //   · `browseAll` — the explicit „show me anyway", so the rule can never trap anybody.
  //
  // ⚠️ `sector` IS DELIBERATELY ABSENT. It is a SCOPE, not a query: switching „Всички" →
  // „Във властта" and getting 63,816 prominence-sorted rows is precisely the default-table
  // behaviour this rework removes.
  //
  // ⚠️ DECLARED HERE, ABOVE THE FACET SPECS, because two of them are conditional on it — it is
  // a URL-derived value like `searching`, not a render-time one, so nothing is lost by moving
  // it up and a `used before declaration` is what happens if it moves back down.
  const showTable = queryIsSendable || hasNarrowingFilters || browseAll;

  // The active filter set. Code-set columns take a SPACE-PADDED, LIKE-escaped value so the
  // engine's ILIKE '%…%' matches a whole token: ' ngo ' can never hit 'ngo_board', and the
  // `_` in 'p_16' / 'chief_architect' is a literal rather than a wildcard.
  // Each dimension's filter fragment, kept SEPARATE so a facet request can leave its own
  // dimension out (otherwise picking "Кмет" collapses the role dropdown to just "Кмет").
  const groupF = useMemo<DbColumnFilter[]>(() => {
    const g = groupByKey(facet);
    return g ? [{ id: g.column, value: true }] : [];
  }, [facet]);
  // The mix bar's dimension. Distinct from groupF: this is the person's PRIMARY facet
  // (single-valued, so a real partition), that one is membership (overlapping).
  const primaryF = useMemo<DbColumnFilter[]>(
    () =>
      primaryFacet !== PERSON_FILTER_ALL
        ? [{ id: "primary_facet", value: [primaryFacet] }]
        : [],
    [primaryFacet],
  );
  const roleF = useMemo<DbColumnFilter[]>(
    () =>
      role !== PERSON_FILTER_ALL
        ? [{ id: "role_codes", value: codeSetMatch(role) }]
        : [],
    [role],
  );
  const partyF = useMemo<DbColumnFilter[]>(
    () =>
      party !== PERSON_FILTER_ALL
        ? [{ id: "party_codes", value: codeSetMatch(party) }]
        : [],
    [party],
  );
  const oblastF = useMemo<DbColumnFilter[]>(() => {
    const f: DbColumnFilter[] = [];
    if (oblast !== PERSON_FILTER_ALL)
      f.push({ id: "oblast_codes", value: codeSetMatch(oblast) });
    if (obshtina !== PERSON_FILTER_ALL)
      f.push({ id: "obshtina_code", value: [obshtina] });
    return f;
  }, [oblast, obshtina]);
  // EXACT (an `in` set), never a substring: one court name contains another
  // ("… съд - Пловдив"), so an ILIKE would silently widen the selection and make the
  // picker's own counts wrong.
  const courtF = useMemo<DbColumnFilter[]>(
    () =>
      court !== PERSON_FILTER_ALL
        ? [{ id: "institution", value: [court] }]
        : [],
    [court],
  );
  const placeF = useMemo<DbColumnFilter[]>(
    () => [...oblastF, ...courtF],
    [oblastF, courtF],
  );
  const toggleF = useMemo<DbColumnFilter[]>(() => {
    const f: DbColumnFilter[] = [];
    if (declaredOnly) f.push({ id: "has_declaration", value: true });
    if (heldOfficeOnly) f.push({ id: "held_office", value: true });
    // „Сменили партия" — `parties_n >= 2`, 5,146 people. The registry declares
    // `parties_n: { filter: "range" }`, so this is a range floor rather than a code set.
    //
    // ⚠️ IT MUST BE APPLIED, not merely counted. `hasNarrowingFilters` includes it, which
    // flips the band's basis to „по избраните филтри" and lights „Изчисти филтрите" — so a
    // param that reached the URL without reaching the query would caption the WHOLE corpus as
    // filtered. Half-wired is the one state that publishes a false sentence.
    if (switchersOnly) f.push({ id: "parties_n", min: 2 });
    return f;
  }, [declaredOnly, heldOfficeOnly, switchersOnly]);
  // The public⇄private scope (?sector) maps to the matview `tier`: public OMITS the filter so the
  // registry's tier=P floor applies, private is ['V'], all is ['P','V']. It is GLOBAL (not a
  // facet dimension), so it scopes every facet AND the table.
  const tierF = useMemo<DbColumnFilter[]>(() => {
    if (sector === "private") return [{ id: "tier", value: ["V"] }];
    if (sector === "all") return [{ id: "tier", value: ["P", "V"] }];
    return [];
  }, [sector]);
  // ⚠️ `scopeF` IS `tierF` AND NOTHING ELSE, and the alias is not an accident of naming. It
  // carried a `position_type` filter too until `?position` was retired as a pure alias of
  // `?pfacet` — kept separate then so the `tiers` facet could exclude its own dimension while
  // staying scoped by the rest. That distinction now has nothing on the other side of it, so
  // the two names are one value; `tiers` still passes everything BUT this, which is the half
  // that matters (a facet including its own filter reports „Във властта (63 816)" as whatever
  // scope the reader has already chosen, rather than the one they are considering).
  //
  // ⚠️ THE COLLAPSE MOVED SIX FACET REQUESTS, and it is worth knowing which way. `positionF`
  // was in `scopeF`, which threads into `groups`, `roles`, `parties`, `oblasts`, `courts` and
  // `primary`; the fold puts it in `primaryF`, which threads into `tiers` and `kpis` only. So
  // an inbound `?position=` link now scopes what `?pfacet` scopes — which IS the retirement,
  // including where `?pfacet` is imperfect: the Група counts are no longer narrowed by it (so
  // that spec's exactness claim does not hold for this dimension), and the mix bar no longer
  // collapses to the single selected segment (which is the own-dimension exclusion working,
  // and strictly better). Widening `primaryF` into `groups` is a separate decision about
  // `?pfacet` as a whole, not something to smuggle in behind an alias.
  const scopeF = tierF;

  const extraFilters = useMemo<DbColumnFilter[]>(
    () => [
      ...scopeF,
      ...groupF,
      ...primaryF,
      ...roleF,
      ...partyF,
      ...placeF,
      ...toggleF,
    ],
    [scopeF, groupF, primaryF, roleF, partyF, placeF, toggleF],
  );

  // Dropdown vocabularies. Each EXCLUDES its own dimension so the control it feeds never
  // collapses to the one option already chosen, and none is scoped by the free-text search
  // — the dropdowns describe the CURRENT SECTOR (scopeF is threaded into every one), so under
  // ?sector=private the governance dropdowns collapse to what the name-fold arm actually has
  // (only "Бизнес") rather than advertising public options that would return zero rows.
  const { merged: facets, bySpec: facetsBySpec } = usePersonFacets(
    useMemo(
      () => ({
        // The group counts are EXACT: the boolean columns counted here are the same ones the
        // filter applies, AND scopeF matches the table's sector — so the "Бизнес" count equals
        // what clicking returns under ?sector=all (without scopeF here it counted only the
        // public company-linked people while the click returned P+V). role/party below carry no
        // counts for a different reason (facet on the seat, filter on the code set).
        groups: {
          columns: GROUP_COLUMNS,
          filters: [...scopeF, ...roleF, ...partyF, ...placeF, ...toggleF],
        },
        roles: {
          columns: ["primary_role"],
          filters: [...scopeF, ...groupF, ...partyF, ...placeF, ...toggleF],
        },
        parties: {
          columns: ["party_primary"],
          filters: [...scopeF, ...groupF, ...roleF, ...placeF, ...toggleF],
        },
        // oblast_code is `facet: true` but NOT filterable — it is the representative seat,
        // the only place the oblast vocabulary lives, while the FILTER matches oblast_codes
        // (every seat). Same reason its options carry no counts.
        oblasts: {
          columns: ["oblast_code"],
          filters: [
            ...scopeF,
            ...groupF,
            ...roleF,
            ...partyF,
            ...courtF,
            ...toggleF,
          ],
        },
        // COURTS ONLY. `institution` spans 1,246 values corpus-wide — courts, ministries,
        // hospitals, schools — which no dropdown can hold and which the facet cap would
        // silently truncate to the most common few hundred, hiding the rest. Scoped to
        // judicial rows it is 270 bodies: complete, under any cap, and it is the filter the
        // plan actually asked for. Non-judicial institutions stay reachable through the
        // free-text search, which has its own arm over this column.
        courts: {
          columns: ["institution"],
          filters: [
            ...scopeF,
            ...groupF,
            ...roleF,
            ...partyF,
            ...oblastF,
            ...toggleF,
            { id: "place_kind", value: ["judicial"] },
          ],
        },
        // The mix bar's own partition — excludes its own dimension like every other facet,
        // so selecting a segment does not collapse the bar to that one segment.
        //
        // ⚠️ NOT REQUESTED UNDER A SEARCH. `useRegistryFacets` issues ONE HTTP REQUEST PER
        // SPEC, and this one's only consumer is `facetMix` → the mix bar, which is withheld
        // under `?q` on both the table branch and the landing. Keying it on `searching` rather
        // than deleting the arm keeps the two in step: whatever gates the bar gates its data.
        ...(searching
          ? {}
          : {
              primary: {
                columns: ["primary_facet"],
                filters: [
                  ...scopeF,
                  ...groupF,
                  ...roleF,
                  ...partyF,
                  ...placeF,
                  ...toggleF,
                ],
              },
            }),
        // The scope control's OWN counts — „Всички (137 461)" / „Във властта (63 816)" /
        // „Частен сектор (73 645)". Excludes the tier filter (a facet excludes its own
        // dimension) and keeps every other, so each option says how many rows it would
        // return from where the reader is standing.
        //
        // ⚠️ THE COUNTS ARE WHY THE DEFAULT MOVING TO `all` IS HONEST. 53.6% of the
        // unfiltered view is name-folded private-sector owners; the badge says so per row,
        // and this says it once, at the top, in the control that governs it.
        tiers: {
          columns: ["tier"],
          filters: [
            ...groupF,
            ...primaryF,
            ...roleF,
            ...partyF,
            ...placeF,
            ...toggleF,
          ],
        },
        // The KPI denominators. has_declaration / is_company are bool facets over the FULL
        // active filter set, so the percentages describe exactly the rows on screen.
        //
        // ⚠️ NOT REQUESTED UNDER A SEARCH WITH A TABLE UP, and the second half of that
        // condition is load-bearing. Every column here feeds the head band (withheld under
        // `searchActive`) or the LANDING CARDS — and the landing renders under
        // `searching && !showTable`, i.e. a sub-floor `?q` with no filter, where the cards
        // still need `parties_n` / `held_office` / the two bools. Gating on `searching` alone
        // blanks them there. With a table up neither consumer exists, so the whole spec —
        // including `obshtina_code`, a 289-value facet over the filtered corpus — is computed
        // server-side and thrown away on every search.
        ...(searching && showTable
          ? {}
          : {
              kpis: {
                // `parties_n` rides here rather than getting a spec of its own: it is one more column
                // on a request already in flight, and the landing's „сменили партия" card needs it.
                // The facet groups an int, so the card sums the buckets at 2 and above.
                columns: [
                  "has_declaration",
                  "is_company",
                  "obshtina_code",
                  "parties_n",
                  "held_office",
                ],
                filters: [
                  ...scopeF,
                  ...groupF,
                  ...primaryF,
                  ...roleF,
                  ...partyF,
                  ...placeF,
                  ...toggleF,
                ],
              },
            }),
      }),
      [
        scopeF,
        groupF,
        primaryF,
        roleF,
        partyF,
        oblastF,
        courtF,
        placeF,
        toggleF,
        // Two of the specs are CONDITIONAL on these, so the memo has to see them move — the
        // request set changes when a search starts and when the table opens, not only when a
        // filter does.
        searching,
        showTable,
      ],
    ),
  );

  // A bool facet answers {true: n, false: m}; the `true` bucket is the group's size.
  // ⚠️ READ FROM THE `groups` SPEC BY NAME, never from the flat merge. `is_company` is faceted
  // by BOTH `groups` (which excludes the group filter, as a vocabulary must) and `kpis` (which
  // includes it, as a denominator must), and the merge is last-wins — so through the flat map
  // this picker read the KPI spec's answer. Measured at `?facet=mp`: „Бизнес 526" on a control
  // whose click returns 85 060.
  const groupFacets = useMemo(() => facetsBySpec.groups ?? {}, [facetsBySpec]);
  const groupOptions = useMemo(
    () =>
      PERSON_GROUPS.map((g) => ({
        value: g.key,
        label: t(g.labelKey, { defaultValue: g.labelBg }),
        count:
          (groupFacets[g.column] ?? []).find((o) => String(o.value) === "true")
            ?.count ?? 0,
      })).filter((o) => o.count > 0),
    [groupFacets, t],
  );

  // Keep ?facet valid for the active ?sector. A magistrate can never be tier='V' (the
  // private/name-fold arm only ever sets is_company), so ?facet=magistrate&sector=private
  // is a structurally empty intersection — every dependent facet (role/party/oblast/court)
  // then collapses to nothing, the "Общини" KPI hides, and the stale code sits unreadable
  // in the Група dropdown (PersonFilterSelect's synthetic-item fallback has no label for a
  // value not in its own options). Rather than render that wreckage, drop back to "all
  // groups" the moment the current facet stops being one of the sector-scoped options —
  // gated on the groups facet having actually resolved, so this cannot fire against the
  // momentarily-empty groupOptions of a request still in flight (which would otherwise
  // reset a perfectly valid ?facet on every load or sector switch).
  const groupsLoaded = groupFacets.is_company !== undefined;
  useEffect(() => {
    if (!groupsLoaded) return;
    if (facet === PERSON_FILTER_ALL) return;
    if (groupOptions.some((o) => o.value === facet)) return;
    setFacet(PERSON_FILTER_ALL);
  }, [groupsLoaded, facet, groupOptions, setFacet]);

  // NO COUNTS on role/party, deliberately. The facet groups `primary_role` /
  // `party_primary` (the representative seat) while the filter matches `role_codes` /
  // `party_codes` (every seat), so a count here UNDER-promises what clicking returns —
  // measured: Кмет 619 shown vs 921 returned, p_6 940 vs 1,300. A wrong number is worse
  // than none; the exact-count version needs a facet over the padded set, which the engine
  // cannot express today.
  const roleOptions = useMemo(
    () =>
      (facets.primary_role ?? []).map((o) => ({
        value: facetKey(o.value),
        label: roleLabel(facetKey(o.value)) || facetKey(o.value),
      })),
    [facets, roleLabel],
  );
  const partyOptions = useMemo(
    () =>
      (facets.party_primary ?? []).map((o) => ({
        value: facetKey(o.value),
        label: displayNameForId(facetKey(o.value)) || facetKey(o.value),
      })),
    [facets, displayNameForId],
  );
  const oblastOptions = useMemo(
    () =>
      (facets.oblast_code ?? [])
        .map((o) => ({
          value: facetKey(o.value),
          label: oblastName(facetKey(o.value), isBg),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "bg")),
    [facets, isBg],
  );
  // Courts are the one vocabulary a reader could never type — "Окръжен съд - Кърджали" is
  // not guessable — which is why this is a picker rather than a search box.
  //
  // It facets AND filters the same column with an EXACT `in`, so unlike role/party its
  // counts are true. The URL carries the NAME rather than a body code because `place_code`
  // would need a code→name dictionary the client does not have, and one facet cannot
  // return both.
  const courtOptions = useMemo(
    () =>
      (facets.institution ?? [])
        .map((o) => ({
          value: facetKey(o.value),
          label: facetKey(o.value),
          count: o.count,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "bg")),
    [facets],
  );

  // The KPI denominators, read from the `kpis` spec by name for the same reason `groupOptions`
  // reads `groups` by name — these two specs share `is_company` and must not swap answers.
  const kpiFacets = useMemo(() => facetsBySpec.kpis ?? {}, [facetsBySpec]);
  const boolTrue = (col: string): number | undefined => {
    const f = kpiFacets[col];
    if (!f) return undefined;
    return f.find((o) => String(o.value) === "true")?.count ?? 0;
  };
  const boolTotal = (col: string): number | undefined => {
    const f = kpiFacets[col];
    if (!f) return undefined;
    return f.reduce((s2, o) => s2 + o.count, 0);
  };
  const withDeclaration = boolTrue("has_declaration");
  const withCompanies = boolTrue("is_company");
  const facetTotal = boolTotal("has_declaration");
  const obshtinaCount = kpiFacets.obshtina_code?.length;
  const facetMix = useMemo(() => facets.primary_facet ?? [], [facets]);

  // Reactive row count for the headline card. The table computes it server-side and hands
  // it back for free; unlike the facets above it DOES react to the free-text search.
  const [agg, setAgg] = useState<{ count?: number; term?: string }>({});
  // The request that produced the visible page — the CSV export re-issues exactly this at a
  // larger pageSize, so a download can never silently drop the reader's filters or search.
  const lastRequest = useRef<Record<string, unknown> | null>(null);
  const handleData = useCallback(
    (
      resp: DbTableResponse<PersonBrowseRow>,
      request: Record<string, unknown>,
    ) => {
      const filters = request.filters as { global?: string } | undefined;
      // The term the count was ACTUALLY computed under — the table's own debounced value, not
      // whatever is in the URL this millisecond. The band echoes it back, so taking it from
      // anywhere else captions a figure with a query that did not produce it.
      setAgg({
        count: resp.aggregates?.count ?? resp.total,
        term: filters?.global,
      });
      lastRequest.current = request;
    },
    [],
  );

  // ⚠️ THE BASIS FLIPS WITH THE URL AND THE COUNT DOES NOT. `DbDataTable` keeps the previous
  // page while refetching (`keepPreviousData`), so without this a filter click paints „Лица
  // 137 461 · ПО ИЗБРАНИТЕ ФИЛТРИ" until the response lands — and a SCOPE switch paints two
  // contradictory numbers in one cell, „Лица 137 461 · от всички 63 816 лица", because
  // `scopeBasis` carries a figure of its own. Skeletons are the honest state.
  useEffect(() => setAgg({}), [extraFilters]);

  const [exporting, setExporting] = useState(false);
  // Reported INLINE, not through window.alert — the only alert() in src/ would be an
  // unthemed, focus-stealing browser modal for a message that needs no decision. Both
  // states have to reach the reader: a truncated file looks complete, and a failed export
  // otherwise looks like a button that does nothing.
  const [exportNote, setExportNote] = useState<string | null>(null);
  const onExport = useCallback(async () => {
    const req = lastRequest.current;
    if (!req || exporting) return;
    setExporting(true);
    setExportNote(null);
    try {
      const { csv, rows, truncated } = await fetchPersonsCsv(req);
      downloadCsv(csv, "persons.csv");
      if (truncated)
        setExportNote(
          t("persons_export_truncated", {
            defaultValue:
              "Свалени са първите {{rows}} реда от {{max}} максимум. Стеснете филтрите за пълен списък.",
            rows,
            max: EXPORT_MAX,
          }),
        );
    } catch {
      setExportNote(
        t("persons_export_failed", {
          defaultValue: "Свалянето не успя. Опитайте отново.",
        }),
      );
    } finally {
      setExporting(false);
    }
  }, [exporting, t]);

  const fmtInt = useCallback(
    (n: number) => n.toLocaleString(isBg ? "bg-BG" : "en-GB"),
    [isBg],
  );

  // The scope control's per-option counts. `tierTotal` is also the head's „от всички N лица"
  // denominator, so the caption and the picker can never name different numbers.
  const tierCounts = useMemo(() => {
    const f = facetsBySpec.tiers?.tier ?? [];
    const at = (v: string) =>
      f.find((o) => String(o.value).trim() === v)?.count ?? 0;
    return { p: at("P"), v: at("V") };
  }, [facetsBySpec]);

  // The one basis that is always true, because the scope is always in play. It names the
  // COUNT rather than the scope's label: „от всички 137 461 лица" is checkable against the
  // band's own first cell, where „от всички лица" is not.
  //
  // ⚠️ THE COUNT IS PART OF THE SENTENCE, so the sentence is not ready until the count is.
  // `tierCounts` comes from a DIFFERENT request than the one the band waits on, and
  // `fetchFacets` swallows a failed response into `{}` at `staleTime: Infinity` — so without
  // this fallback a cold mount whose table beat the facet, or a single 500 on /api/db/facets,
  // publishes „Лица 137 461 · ОТ ВСИЧКИ 0 ЛИЦА" in the largest type on the page, permanently.
  const scopeN = personsScopeCount(sector, tierCounts);
  const scopeBasis =
    scopeN > 0
      ? t("persons_basis_scope", {
          defaultValue: "от всички {{n}} лица",
          n: fmtInt(scopeN),
        })
      : t("persons_basis_scope_unknown", {
          defaultValue: "от всички лица в обхвата",
        });

  /* The band's rule lives in `personsKpiBasis.ts` — four figures answering over three
     different sets, which is a truth table rather than a layout decision. See that file. */
  const kpiInput = {
    // NO `?? query` FALLBACK. `filters.global` is undefined in exactly the two cases where the
    // term is NOT in play — the box was cleared, or the term is under the engine's floor — and
    // substituting the URL's `?q` there captions an UNFILTERED count „по търсене „иван"".
    // Before the first response `count` is undefined, so the band is skeletons and this is
    // never read.
    term: agg.term,
    declActive: declaredOnly,
    // Read through `personGroups`' own accessor rather than restating the literal key it owns.
    companyFacetActive: groupByKey(facet)?.column === "is_company",
    obshtinaActive: obshtina !== PERSON_FILTER_ALL,
    sector,
    primaryFacet: primaryFacet === PERSON_FILTER_ALL ? undefined : primaryFacet,
    filtered: hasNarrowingFilters,
    // The band does not render at all under a search — three of its four cells cannot see the
    // term, and the fourth is the row count the table prints above the rows. See
    // `personsKpiBasis.ts`; `pendingCells` derives from the same rule, so the skeletons go too.
    searchActive: searching,
    scopeBasis,
    fmtInt,
    t,
  };
  const kpis = personsKpis({
    ...kpiInput,
    // ⚠️ TWO SOURCES, AND THE FALLBACK IS NOT A CONVENIENCE. The count normally rides the
    // table's own server-side aggregate — but on the LANDING there is no table, so nothing
    // would ever set it and the band would sit in skeletons for ever on the page a reader
    // arrives at first.
    //
    // `facetTotal` is the `has_declaration` facet's two buckets summed, and it is EXACT:
    // that column is NOT NULL across all 137,461 rows (verified 2026-08-26), so the buckets
    // sum to the table. It is also the right number for this state — the landing has no search
    // box in play, and the facet is scoped by the same filters the table would have been.
    //
    // Only ever a fallback, never a preference: with a table up, `agg.count` is the figure the
    // rows beneath actually came from, and it moves with the search box while a facet cannot.
    count: showTable ? agg.count : facetTotal,
    withDeclaration,
    withCompanies,
    facetTotal,
    obshtinaCount,
  });
  // Derived from the SAME rule, so the skeletons reserve the height the loaded band will
  // occupy — a fixed 4 reflows to 3 under ?decl=1 / ?facet=company / ?obshtina=, which is the
  // reflow `kpisPending` exists to prevent.
  const pendingCells = personsKpiCellCount({
    ...kpiInput,
    obshtinaCount,
  });

  // The head's ranked list IS the group entry points, as links, so a reader who never opens
  // the Група picker still has a way in. Derived from a facet, never a constant: `is_donor` is
  // 0 corpus-wide today, and `groupOptions` already drops a zero, so a hard-coded list would
  // publish a dead link.
  //
  // ⚠️ THE COUNT AND THE DESTINATION MUST COUNT THE SAME SET, and a bare `/persons?facet=X`
  // does not. These counts come from the `groups` facet, which is scoped by the reader's whole
  // filter set — so under `?sector=private` the „Бизнес" row reads 73 645 while the bare link
  // lands on a page returning 85 060. (`HubHead` runs every `to` through `usePreserveParams`,
  // whose allowlist holds no persons param, so the ambient query is stripped; a link's OWN
  // params survive.) Carrying the active query forward is what makes the row honest — the
  // „destination counts a different set" failure `useHeadHref`'s header names, reached from
  // the other side.
  //
  // `pfacet` is dropped on purpose: the `groups` facet excludes it, so the counts do not
  // reflect it and carrying it would re-open the same gap one param over.
  //
  // ⚠️ `q` IS DROPPED FOR THE SAME REASON, and it is the one a reader would actually hit.
  // /api/db/facets has NO free-text parameter — every count on this page's entry points is
  // computed with the search term ignored — so carrying `?q` into the destination would send a
  // reader to a page narrowed by something their number never accounted for. It is also the
  // wrong intent: these are entry points OUT of a search, not refinements of one.
  const entryHref = useCallback(
    (param: string, value: string): string => {
      const next = new URLSearchParams(activeSearch);
      next.set(param, value);
      next.delete("pfacet");
      next.delete("browse");
      next.delete("q");
      return `/persons?${next.toString()}`;
    },
    [activeSearch],
  );
  const evidenceHref = useCallback(
    (key: string) => entryHref("facet", key),
    [entryHref],
  );
  const cardHref = entryHref;
  const evidenceRows = useMemo<HubEvidenceRow[]>(
    () =>
      [...groupOptions]
        .sort((a, b) => b.count - a.count)
        .map((g) => ({
          id: g.value,
          label: g.label,
          value: fmtInt(g.count),
          to: evidenceHref(g.value),
        })),
    [groupOptions, fmtInt, evidenceHref],
  );

  const columns = useMemo<DataTableColumnDef<PersonBrowseRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: t("persons_col_name", { defaultValue: "Име" }),
        cell: ({ row }) => {
          const p = row.original;
          // Name-fold (V) rows carry NO slug — they route by name to the name-keyed portfolio.
          const to = p.slug
            ? `/person/${p.slug}`
            : `/person/${encodeURIComponent(p.name)}`;
          return (
            <Link to={to} className="flex items-center gap-2 hover:underline">
              <MpAvatarView
                // RESOLVED through the dataUrl seam, not passed raw. The matview stores the
                // relative path the scraper wrote ("/parliament/photos/3.webp"), but the
                // photo BINARIES live in the GCS bucket, not in dist/ — so in production the
                // raw path hits the SPA rewrite and returns index.html as `text/html`. The
                // <img> then fails silently and every row falls back to initials, which
                // looks like "we have no photo" rather than a broken URL. Dev never shows it
                // (VITE_DATA_BASE_URL is empty, so the path is served locally). Same helper
                // useMps applies once at ingest, for the same reason.
                photoUrl={p.photoUrl ? resolvePhoto(p.photoUrl) : null}
                displayName={p.name}
                ringColor={p.partyPrimary ? colorFor(p.partyPrimary) : null}
                className="h-7 w-7 shrink-0"
              />
              <span className="text-sm font-medium">{p.name}</span>
              {/* EVERY name-derived identity, expressed as "not 'resolved'" rather than as a
                  list of the name-based values. This used to test `=== "name_fold"`, which is
                  the ~4.4k rows 120 mints on the fly — so the 68,783 Tier-V people the
                  RESOLVER mints, who read 'verified', carried no mark at all despite having
                  exactly the same name-only identity. Enumerating the name-based values
                  instead would repeat that bug's shape: a fifth one goes unbadged the day it
                  is added. 'resolved' is the ONLY cross-source identity, so it is the only
                  safe thing to name. 'shared_name' — the subset the registry positively says
                  is several people — gets the stronger label. */}
              {p.identityConfidence !== "resolved" ? (
                <span
                  className="whitespace-nowrap rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  title={
                    p.identityConfidence === "shared_name"
                      ? isBg
                        ? "Търговският регистър съдържа няколко различни лица с това име — записите почти сигурно смесват повече от един човек"
                        : "The Commercial Register records several different people under this name — these records almost certainly span more than one person"
                      : isBg
                        ? "Самоличността е по съвпадение на име, не е потвърдена"
                        : "Identity is a name match, not verified"
                  }
                >
                  {p.identityConfidence === "shared_name"
                    ? isBg
                      ? "няколко лица"
                      : "several people"
                    : isBg
                      ? "по име"
                      : "name match"}
                </span>
              ) : null}
            </Link>
          );
        },
      },
      {
        id: "primary_role",
        accessorFn: (r) => r.primaryRole,
        header: t("persons_col_role", { defaultValue: "Роля" }),
        cell: ({ row }) => {
          const p = row.original;
          // The representative post, plus how many others this person holds. The count is
          // the browser's whole thesis in one column — one human, many roles — and it is
          // why the table folds person_role instead of listing it.
          const extra = (p.rolesN ?? 1) - 1;
          return (
            <div className="flex flex-wrap items-center gap-1">
              <span className="inline-block whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {roleLabel(p.primaryRole) || p.primaryRole}
              </span>
              {extra > 0 ? (
                <span
                  className="text-xs text-muted-foreground"
                  title={t("persons_more_roles_tip", {
                    defaultValue: "Още {{count}} роли в регистъра",
                    count: extra,
                  })}
                >
                  +{extra}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "party_primary",
        accessorFn: (r) => r.partyPrimary,
        header: t("persons_col_party", { defaultValue: "Партия" }),
        enableSorting: false,
        cell: ({ row }) => {
          const p = row.original;
          if (!p.partyPrimary)
            return <span className="text-xs text-muted-foreground">—</span>;
          const color = colorFor(p.partyPrimary);
          const switcher = (p.partiesN ?? 1) - 1;
          return (
            <div className="flex flex-wrap items-center gap-1">
              <span
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
                style={color ? { borderColor: color } : undefined}
              >
                {color ? (
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                ) : null}
                {displayNameForId(p.partyPrimary) || p.partyPrimary}
              </span>
              {switcher > 0 ? (
                <span
                  className="text-xs text-muted-foreground"
                  title={t("persons_more_parties_tip", {
                    defaultValue: "Свързан(а) с още {{count}} партии",
                    count: switcher,
                  })}
                >
                  +{switcher}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "parties_n",
        accessorFn: (r) => r.partiesN ?? null,
        header: t("persons_col_parties_n", { defaultValue: "Партии" }),
        meta: { align: "right" },
        className: "hidden lg:table-cell",
        cell: ({ row }) => (
          <span className="block text-right text-sm tabular-nums">
            {row.original.partiesN ?? "—"}
          </span>
        ),
      },
      {
        // ONE place column, not "Област / Община": place_label already reads as a МИР, an
        // obshtina or a court depending on place_kind, so splitting it would leave two
        // mostly-empty columns.
        id: "place_label",
        accessorFn: (r) => r.placeLabel,
        header: t("persons_col_place", { defaultValue: "Място" }),
        className: "hidden md:table-cell",
        cell: ({ row }) => {
          const p = row.original;
          const label = (isBg ? p.placeLabel : p.placeLabelEn) ?? p.placeLabel;
          return label ? (
            <span className="text-sm">{label}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          );
        },
      },
      {
        id: "latest_declaration_year",
        accessorFn: (r) => r.latestDeclarationYear ?? null,
        header: t("persons_col_declaration", { defaultValue: "Декларация" }),
        className: "hidden sm:table-cell",
        cell: ({ row }) => {
          const p = row.original;
          // THREE distinguishable states, never collapsed into one dash:
          //   a year        — filed, and this is the newest one on record
          //   "подадена"    — filed, but declared nothing of value (090 emits no year)
          //   "—"           — nothing on record at all, which for a sitting official is
          //                   arguably the more newsworthy fact of the two
          if (p.latestDeclarationYear)
            return (
              <span className="text-sm tabular-nums">
                {p.latestDeclarationYear}
              </span>
            );
          if (p.hasDeclaration)
            return (
              <span
                className="text-xs text-muted-foreground"
                title={
                  t("persons_declared_nothing_tip") ||
                  "Подадена декларация без декларирано имущество със стойност."
                }
              >
                {t("persons_declared_nothing", { defaultValue: "подадена" })}
              </span>
            );
          return <span className="text-xs text-muted-foreground">—</span>;
        },
      },
      {
        id: "roles_n",
        accessorFn: (r) => r.rolesN ?? null,
        header: t("persons_col_roles_n", { defaultValue: "Роли" }),
        meta: { align: "right" },
        className: "hidden lg:table-cell",
        cell: ({ row }) => (
          <span className="block text-right text-sm tabular-nums">
            {row.original.rolesN ?? "—"}
          </span>
        ),
      },
      {
        id: "net_worth_eur",
        accessorFn: (r) => r.netWorthEur ?? null,
        header: t("persons_col_net_worth", { defaultValue: "Нетно състояние" }),
        meta: { align: "right" },
        className: "hidden md:table-cell",
        cell: ({ row }) => <PersonNetWorthCell row={row.original} />,
      },
      {
        id: "companies_n",
        accessorFn: (r) => r.companiesN ?? null,
        header: t("persons_col_companies", { defaultValue: "Фирми" }),
        meta: { align: "right" },
        className: "hidden lg:table-cell",
        cell: ({ row }) => (
          <span className="block text-right text-sm tabular-nums">
            {row.original.companiesN ?? "—"}
          </span>
        ),
      },
      {
        id: "public_money_eur",
        accessorFn: (r) => r.publicMoneyEur ?? null,
        header: t("persons_col_public_money", {
          defaultValue: "Публични пари",
        }),
        meta: { align: "right" },
        className: "hidden lg:table-cell",
        cell: ({ row }) => <PersonMoneyCell row={row.original} />,
      },
    ],
    [t, roleLabel, colorFor, displayNameForId, isBg],
  );

  // THE HEADING NAMES THE FILTERED SET. Landing here from the hub's „Депутати" tile gave a
  // page headed „Хора" over a KPI reading „Лица 2 120" — the numbers were right (2,120 IS
  // the MP count; unfiltered the same tile reads 62,050) but nothing on the page said the
  // set had been narrowed, so the figures read as a broken count of everybody rather than
  // as an accurate count of MPs. A filtered view has to say what it is filtered to.
  const roleName =
    role !== PERSON_FILTER_ALL ? rolePluralLabel(role) || role : null;
  // TWO titles, deliberately. The BREADCRUMB stays „Хора" — short, and one crumb among
  // several. The <h1> is „Хора във властта", which is what the PRERENDERED shell this page
  // hydrates already emits (scripts/prerender/routes.ts) and therefore what a crawler indexes;
  // a hydrated h1 that differs from the served one is a page that says two things.
  const baseTitle = t("persons_title", { defaultValue: "Хора" });
  const headTitle = t("persons_head_title", {
    defaultValue: "Хора във властта",
  });
  const pageTitle = roleName || headTitle;

  const locale = isBg ? "bg-BG" : "en-GB";

  // ⚠️ ONE MAP, READ BY BOTH THE PICKERS AND THE CHIPS. Typed twice, they agree only because
  // both were typed correctly — and a divergence produces precisely the defect
  // `PersonsActiveFilters`'s header calls worse than no chip: a chip naming a dimension the
  // control beside it names differently, which reads as a second, unexplained filter.
  //
  // A `filterSelects.find(s => s.key === …)` lookup would NOT do: the Група spec is
  // conditionally absent (when there is only one group to pick), while its chip must still
  // render for a `?facet=` deep link. One of these — obshtina — has no picker at all.
  const dimensionLabels = useMemo(
    () => ({
      facet: t("persons_filter_group_label", { defaultValue: "Група" }),
      role: t("persons_filter_role_label", { defaultValue: "Роля" }),
      party: t("persons_filter_party_label", { defaultValue: "Партия" }),
      oblast: t("persons_filter_oblast_label", { defaultValue: "Област" }),
      court: t("persons_filter_institution_label", {
        defaultValue: "Институция",
      }),
      obshtina: t("persons_filter_obshtina_label", { defaultValue: "Община" }),
      pfacet: t("persons_mix_title", { defaultValue: "Основна принадлежност" }),
    }),
    [t],
  );

  // The five pickers, as data. Each EXCLUDES its own dimension from the facet that feeds it
  // (see the specs above), so a control never collapses to the one option already chosen.
  const filterSelects = useMemo<PersonsFilterSpec[]>(() => {
    const out: PersonsFilterSpec[] = [];
    // At most one group means picking it can never narrow the set — „Бизнес" and „Всички
    // групи" return the identical row count — so the control only renders once there is a
    // REAL choice to make. (Under the default `all` scope there are seven, so this is now the
    // rare case rather than the usual one; it still fires under ?sector=private, where every
    // tier='V' row is is_company by construction.)
    if (groupOptions.length > 1)
      out.push({
        key: "facet",
        label: dimensionLabels.facet,
        allLabel: t("persons_filter_all_facets", {
          defaultValue: "Всички групи",
        }),
        value: facet,
        options: groupOptions,
        onChange: setFacet,
        locale,
      });
    out.push(
      {
        key: "role",
        label: dimensionLabels.role,
        allLabel: t("persons_filter_all_roles", {
          defaultValue: "Всички роли",
        }),
        value: role,
        options: roleOptions,
        onChange: setRole,
      },
      {
        key: "party",
        label: dimensionLabels.party,
        allLabel: t("persons_filter_all_parties", {
          defaultValue: "Всички партии",
        }),
        value: party,
        options: partyOptions,
        onChange: setParty,
      },
      {
        key: "oblast",
        label: dimensionLabels.oblast,
        allLabel: t("persons_filter_all_oblasts", {
          defaultValue: "Цялата страна",
        }),
        value: oblast,
        options: oblastOptions,
        onChange: setOblast,
      },
      {
        key: "court",
        label: dimensionLabels.court,
        allLabel: t("persons_filter_all_institutions", {
          defaultValue: "Всички институции",
        }),
        value: court,
        options: courtOptions,
        onChange: setCourt,
        locale,
      },
    );
    return out;
  }, [
    t,
    locale,
    dimensionLabels,
    groupOptions,
    facet,
    setFacet,
    role,
    roleOptions,
    setRole,
    party,
    partyOptions,
    setParty,
    oblast,
    oblastOptions,
    setOblast,
    court,
    courtOptions,
    setCourt,
  ]);

  const filterToggles = useMemo<PersonsToggleSpec[]>(
    () => [
      {
        key: "held",
        label: t("persons_filter_held_office", {
          defaultValue: "само заемали длъжност",
        }),
        checked: heldOfficeOnly,
        onChange: setHeldOfficeOnly,
      },
      {
        key: "decl",
        label: t("persons_filter_declared", {
          defaultValue: "само с декларация",
        }),
        checked: declaredOnly,
        onChange: setDeclaredOnly,
      },
      {
        key: "switch",
        label: t("persons_filter_switchers", {
          defaultValue: "само сменили партия",
        }),
        checked: switchersOnly,
        onChange: setSwitchersOnly,
      },
    ],
    [
      t,
      heldOfficeOnly,
      setHeldOfficeOnly,
      declaredOnly,
      setDeclaredOnly,
      switchersOnly,
      setSwitchersOnly,
    ],
  );

  // ⚠️ EVERY NARROWING GETS A CHIP, INCLUDING THE ONE WITH NO PICKER. `?obshtina` arrives from
  // the governance dashboard's „хора, свързани с …" link and has no control of its own, so
  // before this a reader following it saw a narrowed table with nothing on the page naming the
  // narrowing and no way to widen it. That one is the reason this component exists; the rest
  // are the reason it is legible.
  //
  // The labels are resolved through the SAME helpers the pickers use, so a chip can never name
  // a code the control beside it renders differently.
  const chips = useMemo<ActiveFilterChip[]>(() => {
    const out: ActiveFilterChip[] = [];
    const labelOf = (opts: PersonFilterOption[], v: string) =>
      opts.find((o) => o.value === v)?.label ?? v;
    if (facet !== PERSON_FILTER_ALL)
      out.push({
        id: `facet:${facet}`,
        dimension: dimensionLabels.facet,
        label: labelOf(groupOptions, facet),
        onRemove: () => setFacet(PERSON_FILTER_ALL),
      });
    if (primaryFacet !== PERSON_FILTER_ALL)
      out.push({
        id: `pfacet:${primaryFacet}`,
        dimension: dimensionLabels.pfacet,
        label: facetLabel(primaryFacet) || primaryFacet,
        onRemove: () => setPrimaryFacet(null),
      });
    if (role !== PERSON_FILTER_ALL)
      out.push({
        id: `role:${role}`,
        dimension: dimensionLabels.role,
        label: rolePluralLabel(role) || roleLabel(role) || role,
        onRemove: () => setRole(PERSON_FILTER_ALL),
      });
    if (party !== PERSON_FILTER_ALL)
      out.push({
        id: `party:${party}`,
        dimension: dimensionLabels.party,
        label: displayNameForId(party) || party,
        onRemove: () => setParty(PERSON_FILTER_ALL),
      });
    if (oblast !== PERSON_FILTER_ALL)
      out.push({
        id: `oblast:${oblast}`,
        dimension: dimensionLabels.oblast,
        label: oblastName(oblast, isBg) || oblast,
        onRemove: () => setOblast(PERSON_FILTER_ALL),
      });
    if (obshtina !== PERSON_FILTER_ALL)
      out.push({
        id: `obshtina:${obshtina}`,
        dimension: dimensionLabels.obshtina,
        // A NAME, resolved through the one helper that knows both sources — and it has to
        // know both: `municipalities.json` covers 288 of the 289 codes this column carries and
        // structurally cannot cover the 289th, because `SFO_CITY` is a synthetic bundle rather
        // than an EKATTE municipality. It is also the LARGEST (1,315 people). The helper folds
        // `SOF`/`SOF00` first, so a reader arriving on the code the governance dashboards route
        // on still gets „Столична община" rather than an echo of a code that matches no row.
        //
        // Falls back to the code, never to nothing: this chip is the only surface where
        // `?obshtina` exists at all.
        label: obshtinaLabel(obshtina),
        onRemove: () => setObshtina(PERSON_FILTER_ALL),
      });
    if (court !== PERSON_FILTER_ALL)
      out.push({
        id: `court:${court}`,
        dimension: dimensionLabels.court,
        label: court,
        onRemove: () => setCourt(PERSON_FILTER_ALL),
      });
    for (const tg of filterToggles)
      if (tg.checked)
        out.push({
          id: `toggle:${tg.key}`,
          label: tg.label,
          onRemove: () => tg.onChange(false),
        });
    return out;
  }, [
    isBg,
    dimensionLabels,
    obshtinaLabel,
    facet,
    groupOptions,
    setFacet,
    primaryFacet,
    setPrimaryFacet,
    facetLabel,
    role,
    roleLabel,
    rolePluralLabel,
    setRole,
    party,
    displayNameForId,
    setParty,
    oblast,
    setOblast,
    obshtina,
    setObshtina,
    court,
    setCourt,
    filterToggles,
  ]);

  // The cross-cutting queries the group list cannot express — a range over `parties_n`, two
  // booleans, one group that happens to be the largest. Counts from facets already in flight.
  const landingCards = useMemo<LandingCard[]>(() => {
    // ⚠️ `?? 0` WHEN THE FACET HAS RESOLVED, and it is the difference between „not loaded" and
    // „none". A bool facet emits NO `true` bucket when the count is zero, so a bare
    // `?.count` returns undefined for both — and a card that is genuinely empty then renders a
    // permanent „—" instead of being suppressed. Live at ?sector=private, where tier V has 0
    // declarations and 0 held-office: two of the four cards would sit on a dash for ever.
    // Same spelling as `boolTrue` above, which has always had it.
    const boolCount = (col: string) =>
      kpiFacets[col] === undefined
        ? undefined
        : (kpiFacets[col].find((o) => String(o.value) === "true")?.count ?? 0);
    // The facet groups an int, so „switchers" is the sum of every bucket at 2 and above.
    const parties = kpiFacets.parties_n;
    const switchers = parties
      ? parties
          .filter((o) => Number(o.value) >= 2)
          .reduce((n, o) => n + o.count, 0)
      : undefined;
    return [
      {
        key: "switch",
        label: t("persons_card_switchers", {
          defaultValue: "Сменили партия",
        }),
        hint: t("persons_card_switchers_hint", {
          defaultValue: "Свързани с две или повече партии.",
        }),
        count: switchers,
        to: cardHref("switch", "1"),
      },
      {
        key: "decl",
        label: t("persons_card_declared", { defaultValue: "С декларация" }),
        hint: t("persons_card_declared_hint", {
          defaultValue: "Подали пред Сметната палата.",
        }),
        count: boolCount("has_declaration"),
        to: cardHref("decl", "1"),
      },
      {
        key: "held",
        label: t("persons_card_held", { defaultValue: "Заемали длъжност" }),
        hint: t("persons_card_held_hint", {
          defaultValue: "Без кандидатите, които не са били избрани.",
        }),
        count: boolCount("held_office"),
        to: cardHref("held", "1"),
      },
      {
        key: "company",
        label: t("persons_card_company", { defaultValue: "С фирми в ТР" }),
        hint: t("persons_card_company_hint", {
          defaultValue: "Съдружници и управители в Търговския регистър.",
        }),
        count: boolCount("is_company"),
        to: cardHref("facet", "company"),
      },
    ];
  }, [kpiFacets, t, cardHref]);

  // Hoisted so the landing and the results branch render the SAME bar rather than two copies
  // that could drift. It does one job in both places: partition the current set and let a
  // click narrow it.
  const mixBar = (
    <PersonsAnalysisStrip
      facetMix={facetMix}
      selectedFacet={primaryFacet === PERSON_FILTER_ALL ? null : primaryFacet}
      onSelectFacet={setPrimaryFacet}
      // Under `all` the „Бизнес" segment is PROVABLY the private-sector scope —
      // primary_facet='company' is 73,645, exactly the tier-V count — so clicking it switches
      // population rather than narrowing one. Said out loud, because otherwise the page offers
      // the same narrowing twice under two different names.
      extraNote={
        sector === "all"
          ? t("persons_mix_note_business_is_private", {
              defaultValue:
                "При обхват „Всички“ групата „Бизнес“ съвпада с обхвата „Частен сектор“.",
            })
          : undefined
      }
    />
  );

  return (
    <>
      {/* ABOVE the head, per the head's own order. */}
      <Breadcrumbs
        items={[
          { label: t("nav_governance"), to: "/governance" },
          // The unfiltered browser stays in the trail when a role is picked, so „Хора"
          // remains one click away rather than being replaced by the narrower view.
          ...(roleName
            ? [{ label: baseTitle, to: "/persons" }, { label: roleName }]
            : [{ label: baseTitle }]),
        ]}
      />
      {/* HubHead renders the <h1> AND the <SEO>, so this screen must NOT also render <Title>
          — that emits two h1s, which hubHead.gates.test.ts checks statically and
          tests/ui.spec.ts checks rendered. */}
      <HubHead
        eyebrow={t("persons_head_eyebrow", {
          defaultValue: "УПРАВЛЕНИЕ · ХОРА",
        })}
        title={pageTitle}
        seoDescription="Every person the site can identify across parliament, local government, the courts, the company register and the campaign-finance filings — searchable and filterable."
        deck={
          roleName
            ? t("persons_intro_role", { role: roleName })
            : // NAMES BOTH POPULATIONS. The old line — „Един човек, събран от девет
              // регистъра" — is a true description of the 63,816 resolved people and a false
              // one of the 73,645 name-folded private owners that are now the majority of the
              // default view. The per-row badge says so 137,461 times; this says it once.
              t("persons_head_deck", {
                defaultValue:
                  "Един човек, събран от девет регистъра — парламент, местна власт, съд, Търговски регистър и дарения. Обхватът включва и собственици на фирми, разпознати само по име; при тях записът носи етикет.",
              })
        }
        // IN the head, beside the figures it governs, and carrying its own counts — the
        // scope is the single largest thing a reader can change about every number here.
        scope={
          <Select
            value={sector}
            onValueChange={(v) => setSector(v as typeof sector)}
          >
            <SelectTrigger
              className="h-9 w-auto max-w-[260px]"
              aria-label={t("persons_scope_label", {
                defaultValue: "Обхват",
              })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("persons_sector_all", { defaultValue: "Всички" })}
                {tierCounts.p + tierCounts.v
                  ? ` (${fmtInt(tierCounts.p + tierCounts.v)})`
                  : ""}
              </SelectItem>
              <SelectItem value="public">
                {t("persons_sector_public", { defaultValue: "Във властта" })}
                {tierCounts.p ? ` (${fmtInt(tierCounts.p)})` : ""}
              </SelectItem>
              <SelectItem value="private">
                {t("persons_sector_private", {
                  defaultValue: "Частен сектор",
                })}
                {tierCounts.v ? ` (${fmtInt(tierCounts.v)})` : ""}
              </SelectItem>
            </SelectContent>
          </Select>
        }
        search={
          <PersonsSearchField
            value={draft}
            onChange={setDraft}
            onSubmit={onSubmitQuery}
            // The term the RESULTS came from, so the field can say „натиснете Търси" when the
            // box has moved past them. `?q` rather than `agg.term`: the table's value arrives
            // with the response, so the field would announce a disagreement for the length of
            // every request that the reader has already resolved.
            applied={query}
            minChars={SEARCH_MIN_CHARS}
            // The table is what carries the below-the-floor hint in its body; with no table,
            // this field is the only thing that can explain why two characters produced
            // nothing.
            tableVisible={showTable}
            // ⚠️ WHAT THE SUBMIT RETURNED, spoken through the field's live region — the only
            // place on this page that can. Withheld while the box and the aggregate describe
            // different terms (`agg.term` arrives with the response), because a count from the
            // PREVIOUS search announced the instant `dirty` clears is worse than silence.
            resultSummary={
              showTable &&
              agg.count != null &&
              (agg.term ?? "") === query.trim()
                ? t("persons_search_results", {
                    defaultValue: "Намерени са {{n}} лица.",
                    n: fmtInt(agg.count),
                  })
                : undefined
            }
            examples={EXAMPLE_TERMS}
            // Only for a reader who arrived at the LANDING. A filter or `?q` deep link means
            // they asked for a list, and parking the cursor in a search box jumps a screen
            // reader past the h1 and the deck.
            autoFocus={!query && !hasNarrowingFilters}
          />
        }
        kpis={kpis}
        kpisPending={pendingCells}
        evidence={
          // ⚠️ WITHHELD UNDER A SEARCH, for the band's reason exactly. `/api/db/facets` has no
          // free-text parameter, so these group counts are computed with the term IGNORED —
          // „Изпълнителна власт 14 583" beside ten search results is the same false sentence
          // one column over. They are entry points OUT of a search anyway (`entryHref` drops
          // `?q` deliberately), so a reader who is mid-search is not the audience for them; the
          // filter bar is the way in that survives.
          !searching && evidenceRows.length
            ? {
                heading: t("persons_evidence_heading", {
                  defaultValue: "Групи",
                }),
                // CONDITIONAL, because the counts are: „в регистъра" is a corpus-wide claim
                // and these rows are scoped by whatever the reader has narrowed to.
                basis:
                  hasNarrowingFilters || sector !== "all"
                    ? t("persons_evidence_basis_filtered", {
                        defaultValue: "по брой лица в текущия обхват",
                      })
                    : t("persons_evidence_basis", {
                        defaultValue: "по брой лица в регистъра",
                      }),
                rows: evidenceRows,
              }
            : undefined
        }
      />

      {/* Named for a READER, not for a developer: `aria-label="persons"` announced
          „persons, region" in a Bulgarian page, and this section now nests a second named
          landmark (the filter bar) inside it. */}
      <section aria-label={pageTitle} className="my-4">
        {/* The FILTERS COME FIRST and are always here — they are the other way in, and on the
            landing they are the only one besides the search box above. They outlive the table
            for exactly this reason. */}
        <PersonsFilterBar selects={filterSelects} toggles={filterToggles} />

        {/* ⚠️ THE EXPORT BELONGS TO THE RESULTS, NOT TO THE FILTERS, and this is the row that
            travels with them. Put in the filter bar it would survive into the Tier-5 landing —
            the bar is deliberately built to outlive the table — and offer „Свали CSV" for a
            137,461-row download beside no rows at all. Its request comes from the table's own
            `onData`, so on the landing there would be nothing to re-issue either. */}
        <PersonsActiveFilters chips={chips} onClearAll={onClearAll}>
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="text-xs text-primary underline underline-offset-2 hover:no-underline disabled:opacity-50"
          >
            {t("persons_export_csv", { defaultValue: "Свали CSV" })}
          </button>
          {exportNote ? (
            <span role="status" className="text-xs text-muted-foreground">
              {exportNote}
            </span>
          ) : null}
        </PersonsActiveFilters>

        {showTable ? (
          <>
            {/* ⚠️ NOT UNDER A SEARCH, ON EITHER BRANCH — see the landing below, which gates
                the SAME `mixBar` on the SAME value. The bar partitions `primary_facet` from the
                facet endpoint the band reads, which has no free-text parameter, so beside ten
                matches it draws the whole filtered corpus's mix at full width and labels it
                „Основна принадлежност", with no room for a caption to say otherwise.

                The gate is `?q`, NOT `showTable`: a sub-floor term still means the reader has
                asked for something, and the bar's words are corpus-wide either way. Gating on
                the table instead left the bar standing on the landing under `?q=ив` — measured,
                with the band and the rail correctly withheld beside it — while this comment
                argued it was gone.

                `?pfacet` keeps its removable chip above, so hiding the bar never traps a reader
                in a selection they cannot undo. */}
            {searching ? null : mixBar}
            {/* ⚠️ ONLY WHEN `browseAll` IS THE SOLE REASON THE TABLE IS UP. `browseAll` is
                deliberately not part of `hasActiveFilters` — it narrows nothing, so offering
                to „clear filters" for it would name the wrong thing — which means it gets no
                chip and no clear button. Without this a reader who asked to see everything has
                no way back to the landing except the browser's Back. */}
            {browseAll && !hasNarrowingFilters && !queryIsSendable ? (
              <button
                type="button"
                onClick={() => setBrowseAll(false)}
                className="mb-3 text-xs text-primary underline underline-offset-2 hover:no-underline"
              >
                {/* The arrow is a glyph in the markup, not in the string — a translator
                    cannot lose it and a screen reader does not read it aloud. */}
                <ArrowLeft aria-hidden className="mr-1 inline h-3.5 w-3.5" />
                {t("persons_back_to_search", {
                  defaultValue: "Назад към търсенето",
                })}
              </button>
            ) : null}
          </>
        ) : (
          <PersonsLanding
            cards={landingCards}
            // The SAME gate as the results branch above, and it is reachable only from here:
            // `showTable` is `queryIsSendable || hasNarrowingFilters || browseAll`, so a
            // sub-floor `?q` with no filter lands on this branch with `searching` true.
            //
            // ⚠️ THE CARDS ARE NOT GATED WITH IT, and the difference is their framing rather
            // than their arithmetic. „Започнете оттук" says in words that they are entry points
            // into the corpus; „Основна принадлежност" over a full-width bar states what a
            // population IS, which beside a term in the box reads as that term's population.
            mix={searching ? null : mixBar}
            browseAll={{
              // ⚠️ `scopeN`, NOT `tierCounts.all`, and a count-FREE fallback below zero.
              // The corpus total is what a reader gets only under „Всички": under „Във
              // властта" this promised 137 461 and delivered 63 816. And `tierCounts` reads
              // `facets.tier ?? []`, so before that request lands — every cold visit — the
              // button read „Разгледай всички 0 лица", permanently after one 500, since
              // `fetchFacets` caches a failure at `staleTime: Infinity`. The band three
              // lines up already refuses exactly this shape; the same value serves both.
              label:
                scopeN > 0
                  ? t("persons_browse_all", {
                      defaultValue: "Разгледай всички {{n}} лица",
                      n: fmtInt(scopeN),
                    })
                  : t("persons_browse_all_unknown", {
                      defaultValue: "Разгледай всички лица",
                    }),
              onClick: () => setBrowseAll(true),
            }}
            fmtInt={fmtInt}
          />
        )}

        {showTable ? (
          <DbDataTable<PersonBrowseRow>
            resource="persons"
            onData={handleData}
            extraFilters={extraFilters}
            columns={columns}
            defaultSort={[{ id: "prominence", desc: true }]}
            pageSize={25}
            // CONTROLLED, and it is the COMMITTED term — the box's draft reaches nothing.
            // The SEARCH_MIN_CHARS floor stays inside the table, which is the only place the
            // engine's 400-on-a-short-term contract is implemented; its 250 ms debounce now
            // only ever sees one value, since the term changes on submit rather than on
            // keystroke.
            search={query}
            hideSearchInput
            // ⚠️ AND IT IS COMMITTED, so the table's own 250 ms debounce is skipped. It has
            // nothing to coalesce here — the term changes once per „Търси", never per keystroke
            // — so on every refinement while a table is up it was a flat 250 ms of latency after
            // an explicit button press. The FLOOR stays in the table either way; only the wait
            // goes.
            searchIsCommitted
            renderAggregates={(_agg, total, exact) => (
              // COUNT ONLY. There is deliberately no Σ of the money column: two co-officers
              // of one company each carry that company's full contract total, so a column
              // total double-counts — it would be large, plausible and wrong. The registry
              // declares no sum aggregate for the same reason (db_table.test.js guards it).
              <span className="text-sm text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">
                  {exact ? "" : "≈"}
                  {new Intl.NumberFormat(isBg ? "bg-BG" : "en-GB").format(
                    total,
                  )}
                </span>{" "}
                {t("persons_rows_word", { defaultValue: "лица" })}
              </span>
            )}
          />
        ) : null}
      </section>
    </>
  );
};
