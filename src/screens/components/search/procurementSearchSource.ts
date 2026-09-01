// The ONE `/api/db/procurement-search` request, and the SIX normalizers over it.
//
// WHY IT IS SHARED. That endpoint answers institutions AND companies from a single call, so
// any hub offering both groups issues it TWICE per keystroke for the same needle unless the
// two sources await the same promise. `governanceSearch.ts` solved that inside itself; the
// global home offers the same two groups, so a second private copy would put the duplicate
// back — one per hub rather than one per group, which is the same defect with a longer
// fuse. Extracted here so there is one in-flight map for the whole app.
//
// ⚠️ KEYED BY THE QUERY, NOT CACHED ACROSS QUERIES. The box debounces and aborts, so the
// only overlap worth collapsing is two sources asking for the SAME needle in the same tick.
// A stale entry is replaced as soon as the needle changes, so this can never answer one
// query with another's rows.
//
// ⚠️ THE ROUTE ALREADY RUNS ALL SIX SEARCHES ON EVERY CALL. `groupQueries(needle)` builds
// contractors, awarders, contract titles, tender subjects, ИСУН projects and Interreg
// operations unconditionally and awaits them with `Promise.allSettled`, and it pays for both
// bounded totals and the shliokavitsa rewrite besides — so a consumer that renders only two
// of the six is discarding four groups it has already been billed for. Surfacing them is
// client mapping, NOT more SQL and NOT another request.
//
// WHAT READS IT TODAY: `homeSearch` (awarders + companies), `ProcurementSearchTile` (the
// contract/tender item builders and `moreCountLabel`) and `FundsFinder` (the two destination
// helpers). The four `fetch*` group adapters and the two metadata readers have no caller yet
// — they are the home finder's remaining four groups and its „виж всички" labels, landing in
// Phase 5 of the plan, and are tested here.
//
// ⚠️ THE PROMISE BINDS TO THE FIRST CALLER'S `AbortSignal`, which is only safe because
// `HubSearch` gives every source the same one — it fires all server sources in a single pass
// on one controller per debounced query. A caller with a controller of its own would inherit
// an abort it never requested, and its group would render as FAILED rather than empty.

import {
  Briefcase,
  ClipboardList,
  Coins,
  Globe,
  Landmark,
  Receipt,
} from "lucide-react";
import type { SearchItem } from "@/ux/search/EntitySearchTile";
import { decodeEntities } from "@/lib/decodeEntities";
import { isLinkableCompanyKey } from "@/lib/companyKey";

export interface NamedProcurementEntity {
  eik: string;
  name: string;
  contractsEur?: number;
}

/** A signed contract. `key` is `hash(releaseId::contractId::contractorEik::tag)` — 0 of
 *  410,369 contain a character outside `[A-Za-z0-9_-]`, so the encoding below is defensive
 *  rather than load-bearing, which is the right way round. */
export interface ProcurementContractRow {
  key: string;
  title: string;
  date: string;
  awarderName: string;
  contractorName: string;
  amountEur: number | null;
}

/** A ЗОП procedure, keyed by УНП. */
export interface ProcurementTenderRow {
  unp: string;
  subject: string;
  publicationDate: string;
  buyerName: string;
  estimatedValueEur: number | null;
}

/** An ИСУН project. `contractNumber` is the key `/funds/contract/:number` reads. */
export interface FundProjectRow {
  contractNumber: string;
  title: string;
  beneficiaryEik: string | null;
  beneficiaryName: string | null;
  programName: string | null;
  totalEur: number | null;
}

/** An Interreg operation, keyed by its keep.eu id — `operationId` is NULL for every
 *  2014-2020 row, so there is no other stable key. */
export interface InterregOperationRow {
  keepId: number;
  title: string;
  programmeBg: string | null;
  period: string;
  /** The BULGARIAN partners' combined share, never the cross-border operation total — the
   *  latter includes the foreign partners and overstates the Bulgarian side several-fold. */
  bgBudgetEur: number | null;
  /** The Bulgarian partner name that matched, when the hit came through the partner arm
   *  rather than the (English) title — so a Cyrillic search can show WHY a Latin-titled
   *  project is in the list. */
  partnerHit: string | null;
}

export interface ProcurementSearchResponse {
  companies?: NamedProcurementEntity[];
  awarders?: NamedProcurementEntity[];
  contracts?: ProcurementContractRow[];
  tenders?: ProcurementTenderRow[];
  funds?: FundProjectRow[];
  interreg?: InterregOperationRow[];
  /** Total matches per "see all" group, bounded to 100 server-side (the UI renders 100 as
   *  "99+"). Equal to the shown length when the preview was not capped. */
  contractsTotal?: number;
  tendersTotal?: number;
  altQuery?: string | null;
}

let inFlight: { q: string; p: Promise<ProcurementSearchResponse> } | null =
  null;

export const sharedProcurementSearch = (
  query: string,
  signal: AbortSignal,
): Promise<ProcurementSearchResponse> => {
  if (inFlight?.q === query) return inFlight.p;
  const p = fetch(`/api/db/procurement-search?q=${encodeURIComponent(query)}`, {
    signal,
  }).then((r) => {
    // Throw rather than degrade: HubSearch tells a failed group from an empty one and drops
    // it from its „searched in: …" line. Swallowing would report our outage as an absence.
    if (!r.ok) throw new Error(`procurement-search: ${r.status}`);
    return r.json() as Promise<ProcurementSearchResponse>;
  });
  const entry = { q: query, p };
  inFlight = entry;
  p.then(
    (body) => {
      if (metaByQuery.size >= META_CACHE_MAX) metaByQuery.clear();
      metaByQuery.set(query, {
        altQuery: body.altQuery ?? null,
        contractsTotal: body.contractsTotal ?? 0,
        tendersTotal: body.tendersTotal ?? 0,
      });
    },
    () => {},
  );
  // ⚠️ A SETTLED FAILURE IS EVICTED, AND WITHOUT THIS THE CACHE POISONS A NEEDLE FOR EVER.
  // A rejection — a 500, or the abort `HubSearch` fires on EVERY keystroke — would stay
  // cached under its query, so backspacing to a just-aborted needle returns the rejected
  // promise and never re-issues the request. Both groups then vanish, AND their names
  // vanish from „Няма съвпадения в: …", which is the outage-reported-as-absence failure
  // this module's own header forbids. Only the entry we installed is cleared, so a newer
  // query's entry is never removed by an older one's rejection.
  p.catch(() => {
    if (inFlight === entry) inFlight = null;
  });
  return p;
};

/** TEST ONLY — clears the in-flight entry so one case cannot answer the next. */
export const __resetProcurementSearchCache = (): void => {
  inFlight = null;
  metaByQuery.clear();
};

/**
 * Per-query metadata a SYNCHRONOUS `seeAll` callback needs. `HubSearch` calls
 * `seeAll(query)` during render and cannot await the promise, so these have to be sitting
 * here by the time a group has rows — which they are, because a group only renders once its
 * fetch resolved.
 *
 * ⚠️ KEYED, AND WRITTEN UNCONDITIONALLY. A single mutable slot is answered by whichever of
 * several in-flight requests resolves last, and a write gated on „am I still in flight" is
 * never performed at all when a later source displaces the entry first — both shapes have
 * shipped in this repo (see personSearchSource's header, where the second one reached
 * production). A stale write lands under its own query's key and reads are by key, so an
 * out-of-order resolution cannot make one query wear another's rewrite.
 *
 * The unconditional write is pinned by a test ("records the rewrite even when a LATER request
 * has displaced this entry"), because a mutation adding that gate is otherwise invisible: no
 * consumer displaces the entry TODAY, so the guard would look harmless right up until a
 * second source did.
 */
const metaByQuery = new Map<
  string,
  { altQuery: string | null; contractsTotal: number; tendersTotal: number }
>();
/** Small on purpose: a hot-path lookup for the CURRENT query, not a store. */
const META_CACHE_MAX = 8;

/**
 * The needle a „see all" must carry — the one the rows actually came from.
 *
 * ⚠️ NOT WHAT THE READER TYPED. The browse tables these links land on run their own search
 * and do not carry the route's shliokavitsa rewrite, so a link built from the typed query
 * advertises rows the destination cannot find: measured on „6umen", the preview shows 6
 * contracts and `/procurement/contracts?q=6umen` returns 1.
 */
export const procurementAltQuery = (query: string): string =>
  metaByQuery.get(query)?.altQuery || query;

/**
 * „ (12)" / „ (99+)" for a capped preview, or "" when everything is shown.
 *
 * The pure half, exported because `ProcurementSearchTile` runs its OWN request and never
 * fills `metaByQuery` — so it cannot call the lookup below and would otherwise carry a second
 * copy of this sentence. Three decisions live here and all three are a contract with the
 * route: the `>` comparison, the bound, and the literal „99+".
 *
 * ⚠️ THE 100 IS `boundedTotal`'s OWN `LIMIT 100` in functions/db_routes.js. Named once so a
 * change to the route cannot leave one surface reporting „99+" while the other reports an
 * exact number that is no longer the ceiling.
 */
export const moreCountLabel = (
  total: number | undefined,
  shown: number,
): string =>
  total && total > shown ? ` (${total >= 100 ? "99+" : total})` : "";

/**
 * The same label, read from the shared response by query.
 *
 * ⚠️ THE COUNT AND THE LINK HAVE DIFFERENT BASES WHEN THE REWRITE FIRED, and the pairing
 * happens here for the first time. `boundedTotal` counts `term ∪ alt` — the route's own
 * comment says so, and it has to, because the preview it labels can be filled entirely by
 * rows the plain needle never matched — while `procurementAltQuery` sends only `alt`. So on a
 * rewritten needle this can promise more rows than the destination returns, by at most the
 * term-only match count (measured 1 for „6umen", where the union is capped at 100 anyway).
 * Over-promising and bounded; narrowing the count to `alt` alone would instead UNDER-count
 * the preview it is labelling, which is the worse direction.
 */
export const procurementMoreCount = (
  query: string,
  kind: "contracts" | "tenders",
  shown: number,
): string =>
  moreCountLabel(
    kind === "contracts"
      ? metaByQuery.get(query)?.contractsTotal
      : metaByQuery.get(query)?.tendersTotal,
    shown,
  );

export const fetchProcurementAwarders = async (
  query: string,
  signal: AbortSignal,
): Promise<SearchItem[]> =>
  (await sharedProcurementSearch(query, signal)).awarders?.map((a) => ({
    id: `awarder-${a.eik}`,
    to: `/awarder/${a.eik}`,
    primary: decodeEntities(a.name),
    secondary: a.eik,
    amountEur: a.contractsEur,
    icon: Landmark,
  })) ?? [];

export const fetchProcurementCompanies = async (
  query: string,
  signal: AbortSignal,
): Promise<SearchItem[]> =>
  (await sharedProcurementSearch(query, signal)).companies
    // ⚠ A link promises somewhere to go. `contractor_eik` carries synthetic keys — `ph-`
    // (a filler registration number) and `np-` (a natural person keyed by name) — which
    // render a page but name nothing anybody can check against a register.
    // `isLinkableCompanyKey` is the one predicate for that, and it deliberately KEEPS
    // `obed-` consortium carriers, whose page is the only route from a joint bid to the
    // firms behind it.
    ?.filter((c) => isLinkableCompanyKey(c.eik))
    .map((c) => ({
      id: `company-${c.eik}`,
      to: `/company/${c.eik}`,
      primary: decodeEntities(c.name),
      secondary: c.eik,
      amountEur: c.contractsEur,
      icon: Briefcase,
    })) ?? [];

// ── Destinations ───────────────────────────────────────────────────────────────────────
//
// Exported so the funds finder and this module cannot disagree about where a hit goes, while
// each surface keeps its OWN subtitle: `/funds` leads with the beneficiary because the page is
// about beneficiaries, the global finder leads with the programme because the reader arrived
// from nowhere in particular. Presentation is per-surface; the destination is not.

/** An ИСУН project's own page. The number carries dots and slashes, so it is encoded. */
export const fundProjectHref = (contractNumber: string): string =>
  `/funds/contract/${encodeURIComponent(contractNumber)}`;

/** An Interreg operation's page, keyed by its keep.eu id.
 *
 *  ⚠️ THE ENCODE IS UNREACHABLE TODAY AND STAYS ANYWAY, so nobody deletes it as dead code:
 *  `InterregOperationRow.keepId` is a `number`, whose string form is always URL-safe, which
 *  means NO test can discriminate an implementation without it. It is here for the day the
 *  producer widens the type — keep.eu's own ids are numeric, but this signature accepts a
 *  string because the funds finder passes one through `String()`. */
export const interregHref = (keepId: number | string): string =>
  `/funds/interreg/${encodeURIComponent(String(keepId))}`;

// ── The four groups the home adapter used to discard ───────────────────────────────────

/** A signed contract. `/procurement/contract/:key` — the route is `:id`, same path. */
export const contractItems = (body: ProcurementSearchResponse): SearchItem[] =>
  (body.contracts ?? []).map((c) => ({
    id: `contract-${c.key}`,
    to: `/procurement/contract/${encodeURIComponent(c.key)}`,
    primary: decodeEntities(c.title),
    // The CONTRACTOR where there is one, else the buyer. Which end of the deal a row names
    // is what tells two identically-titled „Доставка на хранителни продукти" apart.
    secondary: `${c.date} · ${decodeEntities(c.contractorName || c.awarderName)}`,
    amountEur: c.amountEur,
    icon: Receipt,
  }));

/** A ЗОП procedure. `/tenders/:unp`. */
export const tenderItems = (body: ProcurementSearchResponse): SearchItem[] =>
  (body.tenders ?? []).map((t) => ({
    id: `tender-${t.unp}`,
    to: `/tenders/${encodeURIComponent(t.unp)}`,
    primary: decodeEntities(t.subject),
    secondary: `${t.publicationDate} · ${decodeEntities(t.buyerName)}`,
    amountEur: t.estimatedValueEur,
    icon: ClipboardList,
  }));

/**
 * An ИСУН project.
 *
 * ⚠️ IT LINKS TO THE PROJECT, NOT TO ITS BENEFICIARY, AND IT KEEPS A PROJECT WITH NO EIK.
 * The older builder routed each hit to `/company/:beneficiaryEik` and DROPPED any row
 * without one — so a reader searching for a project was sent to a company page, and projects
 * whose beneficiary the corpus cannot key were invisible. `/funds/contract/:number` is the
 * project's own page and `contract_number` is present on every row, so neither is necessary.
 */
export const fundItems = (body: ProcurementSearchResponse): SearchItem[] =>
  (body.funds ?? [])
    .filter((f) => f.contractNumber)
    .map((f) => ({
      id: `fund-${f.contractNumber}`,
      to: fundProjectHref(f.contractNumber),
      // An untitled project renders as its contract number, never as a blank row: the row is
      // a real project either way and a reader can still recognise and open it.
      primary: decodeEntities(f.title?.trim() || f.contractNumber),
      secondary:
        decodeEntities(
          [f.programName, f.beneficiaryName].filter(Boolean).join(" · "),
        ) || undefined,
      amountEur: f.totalEur,
      icon: Coins,
    }));

/**
 * An Interreg operation — its OWN group, never folded into the ИСУН one.
 *
 * They are different corpora with no common key: `fund_projects` holds zero Interreg rows
 * (Interreg runs on Jems, not ИСУН), and an operation's `operationId` is NULL for every
 * 2014-2020 row, so only the keep.eu id is always present. Merging them would force a NULL
 * key on one side.
 *
 * ⚠️ The money is `bgBudgetEur` — the Bulgarian partners' share — and never the operation
 * total, which includes the foreign partners and overstates the Bulgarian side several-fold.
 */
export const interregItems = (body: ProcurementSearchResponse): SearchItem[] =>
  (body.interreg ?? []).map((r) => ({
    id: `interreg-${r.keepId}`,
    to: interregHref(r.keepId),
    // keep.eu publishes titles in English only, so this is the English one on both language
    // surfaces rather than an invented translation.
    primary: decodeEntities(r.title?.trim() || String(r.keepId)),
    secondary:
      decodeEntities(
        [r.programmeBg, r.period, r.partnerHit].filter(Boolean).join(" · "),
      ) || undefined,
    amountEur: r.bgBudgetEur,
    icon: Globe,
  }));

export const fetchProcurementContracts = async (
  query: string,
  signal: AbortSignal,
): Promise<SearchItem[]> =>
  contractItems(await sharedProcurementSearch(query, signal));

export const fetchProcurementTenders = async (
  query: string,
  signal: AbortSignal,
): Promise<SearchItem[]> =>
  tenderItems(await sharedProcurementSearch(query, signal));

export const fetchFundProjects = async (
  query: string,
  signal: AbortSignal,
): Promise<SearchItem[]> =>
  fundItems(await sharedProcurementSearch(query, signal));

export const fetchInterregOperations = async (
  query: string,
  signal: AbortSignal,
): Promise<SearchItem[]> =>
  interregItems(await sharedProcurementSearch(query, signal));
