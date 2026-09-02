// The global home's finder — TEN groups, THREE requests, no second index.
//
// The home page is a hub OF HUBS, so a reader who already knows what they want („Сливен",
// „Желязков", „АПИ", „кисело мляко") would otherwise have to guess which of eight tiles
// contains the page that contains it. This box is the way past that guess, and it is the
// reason the grid can stay eight tiles rather than growing a ninth for every subject.
//
// ⚠️ IT BUILDS NO NEW INDEX AND ADDS NO NEW ENDPOINT. Every group reuses an authority that
// already exists:
//
//   places          the SLIM place catalog (`buildPlaceItems`), the same rows the My-Area
//                   autocomplete uses — NOT the fat `useSearchItems`, which additionally
//                   pulls ~4.4 MB this box would immediately discard
//   public people   /api/db/person-search  ┐ ONE request, shared — see
//   registry people /api/db/person-search  ┘ personSearchSource.ts
//   institutions    /api/db/procurement-search  ┐
//   companies       /api/db/procurement-search  │ ONE request, shared — see
//   contracts       /api/db/procurement-search  │ procurementSearchSource.ts
//   tenders         /api/db/procurement-search  │
//   ИСУН projects   /api/db/procurement-search  │
//   Interreg        /api/db/procurement-search  ┘
//   products        /api/db/price-search, the endpoint the consumption hub uses
//
// So a keystroke costs THREE requests for TEN groups, and the place group costs none at all.
//
// ⚠️ THE FOUR PROCUREMENT GROUPS BELOW COMPANIES ADD NO COST. That route already runs all six
// searches on every call, plus both bounded totals and the shliokavitsa rewrite, so rendering
// two of them was discarding four it had already been billed for. Same for the person route's
// `money`/`others` tiers. Adding them is client mapping — no new SQL, no second request.
//
// ⚠️ AND NOTHING LOADS BEFORE INTENT. The place catalog is ~980 KB and is fetched only once
// `HubSearch` arms (focus or first keystroke), which is why the screen passes `armed` down
// rather than building the index unconditionally. On the site's entry page that distinction
// is the difference between a finder and a tax on every visitor.
//
// Plan: docs/plans/home-dashboard-implementation-v1.md §8.

import { MapPin, ShoppingBasket } from "lucide-react";
import type { SearchItem } from "@/ux/search/EntitySearchTile";
import type { HubSearchSource } from "@/ux/search/hubSearchSources";
import { buildEntityIndex } from "@/lib/entitySearchIndex";
import { decodeEntities } from "@/lib/decodeEntities";
import {
  fetchFundProjects,
  fetchInterregOperations,
  fetchProcurementAwarders,
  fetchProcurementCompanies,
  fetchProcurementContracts,
  fetchProcurementTenders,
  procurementAltQuery,
  procurementMoreCount,
} from "@/screens/components/search/procurementSearchSource";
import {
  fetchCompanyPeople,
  fetchPublicPeople,
  type RoleLabeler,
} from "@/screens/components/search/personSearchSource";
import type { SearchIndexType } from "@/data/search/useSearchItems";
import { seeAllAbove } from "@/ux/search/hubSearchSources";

/** A price-search hit. ⚠️ The route returns a BARE ARRAY (`{ body: rows }` in
 *  `functions/db_routes.js`), not an envelope — `ConsumptionSearchTile` reads it the same
 *  way. Wrapping it in a `{ products }` shape that does not exist would leave this group
 *  permanently, silently empty. */
interface PriceHit {
  slug: string;
  title: string;
  brand: string | null;
  /** ⚠️ A STRING over the wire („1000"), not a number — node-postgres serialises the
   *  numeric column that way. Only ever concatenated below, so it is typed as it arrives
   *  rather than as it looks. */
  net_qty: string | number | null;
  net_unit: string | null;
}

const fetchProducts = async (
  query: string,
  signal: AbortSignal,
): Promise<SearchItem[]> => {
  const r = await fetch(`/api/db/price-search?q=${encodeURIComponent(query)}`, {
    signal,
  });
  if (!r.ok) throw new Error(`price-search: ${r.status}`);
  const hits = (await r.json()) as PriceHit[];
  return (Array.isArray(hits) ? hits : []).map((p) => ({
    id: `product-${p.slug}`,
    // `/product/:slug`, the route `ConsumptionSearchTile` already links to.
    to: `/product/${p.slug}`,
    primary: decodeEntities(p.title),
    secondary:
      [p.brand, p.net_qty && p.net_unit ? `${p.net_qty} ${p.net_unit}` : null]
        .filter(Boolean)
        .join(" · ") || undefined,
    icon: ShoppingBasket,
  }));
};

/**
 * ⚠️ THE DIASPORA BUCKET IS NOT A LIST OF BULGARIAN PLACES, and this is the THIRD consumer
 * of `buildPlaceItems` that has to say so. `settlements.json` carries 88 pseudo-settlements
 * at `oblast === "32"` — МИР 32, the abroad district — keyed by ISO country code
 * („Австралия" → AU, „Германия" → DE). Unfiltered, typing „Германия" returns one confident
 * result whose destination is `/governance/DE`, and `useAreaResolver` resolves that AS A
 * REAL SETTLEMENT (obshtina "EU"), rendering a full place dashboard for a country rather
 * than the unknown-place screen. `AreaSniperButton` and `MyAreaEntryScreen` both carry this
 * filter; the geo sweep in `useNearestSettlement` carries its own.
 *
 * Only `type === "s"` rows can be diaspora ones, so the lookup is scoped to them.
 */
const isDiasporaPlace = (
  i: SearchIndexType,
  oblastOf: (key: string) => string | undefined,
): boolean => i.type === "s" && oblastOf(i.key) === "32";

/** A place's destination FROM THE GLOBAL HOME.
 *
 *  ⚠️ `/governance/<id>`, not the parliamentary result. This box reuses the SLIM catalog —
 *  the same rows the My-Area autocomplete and the header crosshair use — and both of those
 *  navigate to `/governance/<id>`, the place dashboard. Sending a place to
 *  `/sections/<ekatte>` instead would answer „what is happening in Сливен" with one
 *  election's polling-section table, which is the narrow reading the root cutover exists to
 *  end.
 *
 *  `path` wins where the row carries one. ⚠️ Those are the synthetic Пловдив and Варна
 *  city rows (`/governance/<id>` set by `buildPlaceItems`), NOT София — deriving over them
 *  would mint a route that does not exist. */
const placeHref = (i: SearchIndexType): string =>
  i.path ?? `/governance/${i.key}`;

/** Coarser grains first. A reader typing „Сливен" almost always means the município or the
 *  oblast rather than one of the settlements inside it, and the region/município rows are a
 *  few hundred against thousands of settlements. */
const PLACE_RANK: Partial<Record<SearchIndexType["type"], number>> = {
  r: 3,
  m: 2,
  d: 2,
  s: 1,
};

/** The place group's index, built from the slim catalog the caller has already fetched.
 *
 *  `null` means "not built yet" — either because the box is unarmed or because the catalog
 *  is still in flight — and `HubSearch` renders that as loading rather than as empty. The
 *  two are different answers and only one of them is a state. */
export const homePlaceIndex = (
  items: SearchIndexType[] | null,
  /** `ekatte -> oblast`, for the diaspora filter. Absent means "cannot tell", and the rows
   *  are kept — a filter that silently drops real places when its lookup is missing would
   *  be worse than the thing it guards against. */
  oblastOf: (key: string) => string | undefined = () => undefined,
) =>
  items
    ? buildEntityIndex<SearchIndexType>(
        items.filter((i) => !isDiasporaPlace(i, oblastOf)),
        (i) => ({
          id: `${i.type}-${i.key}`,
          href: placeHref(i),
          label: decodeEntities(i.name),
          // The parent — „общ. Сливен", „обл. Сливен" — is what separates the fourteen
          // Bulgarian settlements that share a name from one another.
          sub: i.parentName ? decodeEntities(i.parentName) : undefined,
        }),
        // Both spellings, so a Latin-keyboard reader finds a Cyrillic place.
        (i) => [i.name, i.name_en],
        // ⚠️ A RANK IS REQUIRED HERE, NOT OPTIONAL. `buildEntityIndex` returns the first
        // `limit` matches in INPUT order, and the catalog is ~5,000 settlements against 294
        // municipalities — so without a rank, typing a município's own exact name can miss
        // it entirely behind five settlements that merely contain the string. Measured: 11
        // of 294 („Бяла", „Ново село", „Лом", „Трън" …) were unreachable by their own name.
        // Coarser grains first; ties keep input order, which is already alphabetical.
        (i) => PLACE_RANK[i.type] ?? 0,
      )
    : null;

/**
 * Per-group preview caps, named once.
 *
 * ⚠️ A CAP IS READ TWICE PER GROUP — as the source's `limit` AND as the „shown" count the
 * bounded remainder is computed against — and they must stay equal. `limit: 3` beside
 * `procurementMoreCount(q, "contracts", 2)` renders „ (3)" next to three already-visible rows.
 * The V/N quota is the same shape: `fetchCompanyPeople(…, cap)` must ask for what the group
 * will display.
 *
 * Sums to 20, which is the keyboard budget: `HubSearch` scroll-bounds the dropdown anyway, so
 * this bounds how far an arrow key has to travel and stops a broad query turning the global
 * finder into a browser.
 */
const CAP = {
  places: 3,
  publicPeople: 3,
  companyPeople: 2,
  products: 2,
  awarders: 2,
  companies: 2,
  contracts: 2,
  tenders: 2,
  funds: 1,
  interreg: 1,
} as const;

// ⚠️ `longEnoughToSeeAll` / `seeAllAbove` MOVED to `@/ux/search/hubSearchSources` — this
// file's own comment predicted that „a fifth group would copy from" it, and
// `governanceSearch` and `cultureSearch` then shipped four unguarded see-alls onto the
// same DbDataTable destinations. The rule and its reasoning now live once, there.

export const homeSearchSources = (
  bg: boolean,
  placeItems: SearchIndexType[] | null,
  oblastOf: (key: string) => string | undefined,
  /** False until `HubSearch` arms. Keeps the place group in its loading state rather than
   *  claiming the catalog is empty before anyone has asked for it. */
  armed: boolean,
  /** `usePersonLabels().roleLabel`, so a public row reads „Кмет · Столична община" rather than
   *  „Политик · Столична община" — true of Sofia's mayor and of 46,158 other people. Optional
   *  because this module is not a component and cannot call the hook itself. */
  roleLabel?: RoleLabeler,
): HubSearchSource[] => [
  {
    id: "places",
    label: { bg: "Места", en: "Places" },
    limit: CAP.places,
    kind: "index",
    icon: MapPin,
    index: homePlaceIndex(placeItems, oblastOf),
    // Loading only once somebody has ARMED the box. Before that there is nothing to load
    // and a spinner would be a lie about work in progress.
    loading: armed && !placeItems,
  },
  {
    id: "public-people",
    label: { bg: "Публични лица", en: "People in public life" },
    limit: CAP.publicPeople,
    kind: "server",
    fetch: (q, s) => fetchPublicPeople(q, s, bg, roleLabel),
    // ⚠️ NO SEE-ALL, AND ITS REMOVAL IS A DECISION RATHER THAN AN OVERSIGHT. `/persons` DOES
    // reproduce a correctly-spelled multi-word name — `persons.name` carries
    // `searchFoldTokens`, so „vasil terziev" finds him there too. What it cannot reproduce is
    // a TYPO: this endpoint is trigram-fuzzy and that browse column is substring, so „vassil"
    // (a doubled letter, which no shliokavitsa rewrite touches) previews six people and
    // delivers none. A see-all must reproduce the query's SEMANTICS, not merely accept its
    // parameter.
  },
  {
    id: "products",
    label: { bg: "Продукти", en: "Products" },
    limit: CAP.products,
    kind: "server",
    fetch: fetchProducts,
    // ⚠️ HIGH IN THE BOX, NOT LAST. A corpus-taxonomy order puts products behind eight money
    // groups — measured on „Варна", that is 531 px into a 382 px-tall scroll box, i.e. below
    // the fold. „кисело мляко" is a first-class home query. Empty groups collapse, so the
    // ten-deep case only occurs on a broad word („ремонт", „София") — which is exactly when
    // this ordering matters.
    //
    // ⚠️ NO SEE-ALL, AND IT USED TO HAVE ONE. The preview and `/consumption/products` run
    // DIFFERENT shliokavitsa engines: this route matches through `shlyoCandidates` (which
    // covers the phonetic i-glide spellings) and the browse table through
    // `shlyo_query_fold` (which does not). Measured 2026-09-02 — „mliako", „biala",
    // „rakiia" and „iogurt" each preview 20 real products and the destination returns ZERO,
    // four of nine probe terms, so a class rather than an instance. Carrying an `altQuery`
    // is not available as a fix: `/api/db/price-search` returns a bare array and supplies no
    // rewrite. Restoring the link means giving that route the needle it matched on — the
    // `procurement-search` shape — as a field BESIDE the array, never an envelope.
  },
  {
    id: "awarders",
    label: { bg: "Институции", en: "Institutions" },
    limit: CAP.awarders,
    kind: "server",
    fetch: (q, s) => fetchProcurementAwarders(q, s, bg),
    // No see-all: there is no awarders browse page that reads ?q, and a link advertising a
    // filtered destination that delivers an unfiltered one is worse than none.
  },
  {
    id: "companies",
    label: { bg: "Фирми", en: "Companies" },
    limit: CAP.companies,
    kind: "server",
    fetch: (q, s) => fetchProcurementCompanies(q, s, bg),
    seeAll: seeAllAbove(
      bg ? "Виж всички фирми" : "See all companies",
      // ⚠️ `altQuery`: the browse table runs its own search and does NOT carry this route's
      // shliokavitsa rewrite, so a link built from what was typed advertises rows the
      // destination cannot find — „6umen" previews six and delivers one.
      // ⚠️ `pscope=all`: the table defaults to the selected parliament's window, so a company
      // whose contracts predate it would land on zero rows.
      (q) =>
        `/procurement/contractors?q=${encodeURIComponent(procurementAltQuery(q))}&pscope=all`,
    ),
  },
  {
    id: "contracts",
    label: { bg: "Договори по ЗОП", en: "Procurement contracts" },
    limit: CAP.contracts,
    kind: "server",
    fetch: fetchProcurementContracts,
    seeAll: seeAllAbove(
      // The bounded total the route already paid for, so the cap reads as a preview rather
      // than as the whole result.
      (q) =>
        (bg ? "Виж всички договори" : "See all contracts") +
        procurementMoreCount(q, "contracts", CAP.contracts),
      (q) =>
        `/procurement/contracts?q=${encodeURIComponent(procurementAltQuery(q))}&pscope=all`,
    ),
  },
  {
    id: "tenders",
    // „Процедури", not „Поръчки": „обществени поръчки" is the umbrella this whole corpus
    // sits under, so reusing it for one half would read as a third corpus.
    label: { bg: "Процедури по ЗОП", en: "Procurement procedures" },
    limit: CAP.tenders,
    kind: "server",
    fetch: fetchProcurementTenders,
    seeAll: seeAllAbove(
      (q) =>
        (bg ? "Виж всички процедури" : "See all procedures") +
        procurementMoreCount(q, "tenders", CAP.tenders),
      (q) =>
        `/procurement/tenders?q=${encodeURIComponent(procurementAltQuery(q))}&pscope=all`,
    ),
  },
  {
    id: "company-people",
    // ⚠️ BELOW THE MONEY GROUPS, and that is the ordering decision rather than an accident.
    // This is the box's weakest tier — name-fold identities over `tr_officers`, carrying a
    // „съвпадение по име" caveat on most rows — so it must not sit above corpora whose rows
    // are keyed and checkable. Products leads it for the opposite reason: „кисело мляко" is
    // a first-class home query and its rows are exact.
    // ⚠️ NAMES THE CORPUS, NOT THE ENTITY KIND, and „Лица от…" is what it must not say. These
    // rows are `tr_officers` name folds, and ~3.7% of them are COMPANY-shaped: measured on
    // „София", both rows rendered were non-persons — „София Франс Ауто" and a 230-character
    // school-representation string. `identityCaveat` qualifies WHICH person a row is; a
    // heading reading „People in the company register" asserts THAT it is one, and a heading
    // is the one line here that cannot carry a caveat. /procurement's own two groups over the
    // same tiers („Свързани с обществени пари", „Други собственици") claim no personhood.
    label: { bg: "Търговски регистър", en: "Company register" },
    limit: CAP.companyPeople,
    kind: "server",
    // The cap is the group's own `limit`: asking for more wastes the V/N balance, asking for
    // fewer leaves the group short of its own budget.
    fetch: (q, s) => fetchCompanyPeople(q, s, bg, CAP.companyPeople),
    // No see-all: `/persons` browses P and V, not the 445,804-row N tier, so the link would
    // promise a result set the destination cannot reproduce.
  },
  {
    id: "funds",
    label: { bg: "Проекти по еврофондове", en: "EU-funds projects" },
    limit: CAP.funds,
    kind: "server",
    fetch: fetchFundProjects,
    // No see-all: the obvious target, /procurement/contracts, browses the ЗОП corpus, which
    // holds none of these rows. No funds-project browser reads ?q yet.
  },
  {
    id: "interreg",
    // Named for the corpus, not folded into „еврофондове": `fund_projects` holds ZERO
    // Interreg rows (Interreg runs on Jems, not ИСУН), the two share no key, and the money
    // shown is the Bulgarian partners' share rather than a project's own value.
    // ⚠️ THE NOUN LEADS, IN BOTH LANGUAGES, AND THAT IS TWO FIXES IN ONE RENAME.
    // „(трансгранични)" is a bare plural adjective with no noun — Bulgarian does not carry
    // one alone the way English carries „(cross-border)" — and it renders `uppercase` in the
    // sticky header, which makes the gap louder. And `HubSearch` lowercases the FIRST
    // CHARACTER of every label for its „Няма съвпадения в: …" line, on the stated assumption
    // that labels are sentence-case; a label starting with a proper noun came out as
    // „interreg (трансгранични)". Leading with the noun keeps the brand capitalised.
    label: {
      bg: "Трансгранични проекти (Interreg)",
      en: "Cross-border projects (Interreg)",
    },
    limit: CAP.interreg,
    kind: "server",
    fetch: fetchInterregOperations,
  },
];
