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
// WHAT READS IT TODAY — five surfaces, and the split between them matters:
//   through the SHARED request (`sharedProcurementSearch`, one in-flight promise per needle):
//     `homeSearch` (all six group adapters + `procurementAltQuery` + `procurementMoreCount`),
//     `governanceSearch` (awarders + companies), `FundsFinder` (the destination helpers).
//   with their OWN request:
//     `ProcurementSearchTile` (`/procurement`'s box — it also passes its own `limit`),
//     `cultureSearch` (`/culture`'s box — same, one `&limit` per group).
// That split is load-bearing for `metaByQuery`: the two private-request callers never fill
// it, so they must use the PURE `moreCountLabel`, never `procurementMoreCount`.
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
import { SCOPE_ALL, SCOPE_PARAM } from "@/data/scope/constants";

export interface NamedProcurementEntity {
  eik: string;
  /** The alias that MATCHED — one buyer's spelling on one contract, not a register name. */
  name: string;
  /** The EIK's whole procurement history. ⚠ Not necessarily about `name`; see `ownEur`. */
  contractsEur?: number;
  /** The money filed under THIS (eik, name) — the evidence that `contractsEur` may not be
   *  about `name`. Nothing renders it today; see the rejected-rules note below for why it is
   *  carried anyway (any future fix needs it, and it is free — the route already selects it).
   *  ⚠️ NULL/undefined means „not computed on this database" (a `db:load:pg` predating the
   *  column) — NEVER zero. A zero is a real answer: „this spelling earned nothing". */
  ownEur?: number | null;
  /** The EIK's dominant name in the corpus, by that same measure. NULL when not computed. */
  primaryName?: string | null;
}

/**
 * ⚠️ THERE IS DELIBERATELY NO MONEY-SUPPRESSION RULE HERE, AND TWO CANDIDATES WERE MEASURED
 * AND REJECTED. Read this before adding one.
 *
 * The defect is real: `search_contractors` takes the NAME from a per-(eik, name) row and the
 * MONEY from a per-EIK aggregate, so „Клет българия" ООД — filed once, for €6,036, against
 * БИТ И ТЕХНИКА's ЕИК 103795327 — advertised that company's whole €2,214,873. The obvious
 * fixes both fail against the corpus:
 *
 *   1. A SHARE FLOOR („withhold the figure when this name earned under k% of the EIK's
 *      money"). Refuted: the mis-keyed class is not concentrated at low shares. Measured
 *      2026-09-02 over 151 mis-keyed pairs — 101 sit ABOVE 1%, the 90th percentile is 32.6%
 *      and the worst is 46.4%, while a LEGITIMATE former name sits right among them
 *      („ЧЕЗ ТРЕЙД БЪЛГАРИЯ ЕАД", a real prior name of Електрохолд Трейд on the same EIK, is
 *      4.998% of its EIK). No threshold separates the two classes; the Клет case at 0.27% is
 *      the bottom of its own class, not typical of it.
 *   2. A CATEGORICAL TEST („this name is the dominant name of a DIFFERENT EIK"). Spares every
 *      rename (0 of ЧЕЗ Трейд's and Медекс's rows) and catches the class — but it is
 *      DIRECTIONLESS. Measured: of 275 flagged pairs, it flags the REAL Петрол (831496285,
 *      in tr_companies) because one of its aliases is also the dominant name of the typo EIK
 *      834496285. Suppressing there withholds a real company's real money.
 *
 * Withholding a figure from a named company on a rule that misfires is a worse failure than
 * the one being fixed, so the money stays and the ROW SAYS WHAT IT IS instead — see
 * `entitySubtitle`. That is honest in all three cases (rename, ЕИК typo, cross-company
 * mis-key) and cannot misfire, because it classifies nothing.
 *
 * What WOULD close it is a corpus-side flag that carries a DIRECTION — which of two EIKs
 * sharing a name is the better claimant, decided against `tr_companies` and the row counts.
 * That is a loader change, not a client threshold. Open work; the measurement above is the
 * evidence any attempt has to beat.
 */

/**
 * The name to show, and the alias to show beside it.
 *
 * ⚠️ THE MATCHED NAME STAYS THE HEADLINE. Replacing it with `primaryName` hides the query
 * from its own result: searching „Клементина" would return a row reading „ПЕТА
 * МНОГОПРОФИЛНА БОЛНИЦА ЗА АКТИВНО ЛЕЧЕНИЕ…", which is the same hospital and looks like a
 * mismatch. The dominant name is added as the SUBTITLE instead, where it answers „why am I
 * seeing this row" — and, in the mis-keyed case, tells the reader the EIK is somebody else.
 */
export const entitySubtitle = (
  e: NamedProcurementEntity,
  bg: boolean,
): string => {
  const p = e.primaryName;
  if (!p) return e.eik;
  // ⚠️ COMPARE WHAT THE ROW WILL SHOW, NOT WHAT THE WIRE SENT. Both halves render through
  // `decodeEntities`, and the fold keeps the LETTERS inside an entity — `&amp;` → „amp" —
  // so an entity-encoded spelling and its plain twin fold apart and the subtitle fires on a
  // name identical to the one above it. Measured 2026-09-02: 3 of 3 entity-carrying rows
  // misfired, e.g. „С &amp; Т БЪЛГАРИЯ ЕООД" rendering under „831131023 · в договорите:
  // С & Т БЪЛГАРИЯ  ЕООД" — the same name twice, differing by a double space.
  // `decodeEntities` is idempotent on entity-free input, so this is free for the rest.
  const shown = decodeEntities(p);
  // A value with no letters or digits names nobody — „---", „ ", „." — and printing it
  // asserts the corpus calls this EIK that. Same shape as `isSpouseHolder`'s letter guard.
  // 0 such rows today; `primary_name` is free corpus text chosen by argmax.
  if (!nameKey(shown) || sameName(shown, decodeEntities(e.name))) return e.eik;
  // ⚠️ „в договорите", NOT „в регистъра". This value is the dominant name in the CONTRACT
  // CORPUS, and 27% of the rows that render this subtitle name an EIK absent from
  // `tr_companies` altogether — 64.6% on the awarder side, where ministries and hospitals
  // have no Commerce-Register entry by construction (and `contractor_search` exists
  // precisely because ~32% of contractor EIKs do not either). „в регистъра" beside an EIK
  // reads as the Commerce Register, and attributing an unregistered spelling to a register
  // is the one direction this repo's „name match ≠ identity" rule forbids.
  return `${e.eik} · ${bg ? "в договорите: " : "in the contracts: "}${shown}`;
};

/** The comparison key: NFC, lower-cased, letters and digits only.
 *
 *  ⚠️ `normalize("NFC")` FIRST, and it is not cosmetic. `\p{L}\p{N}` excludes combining
 *  marks (category `Mn`), so the strip DELETES them — in NFD, „й" is „и" + U+0306 and the
 *  breve is dropped. Without normalizing, the fold is wrong in BOTH directions: it fails to
 *  collapse two encodings of „Найден", and it DOES collapse „Найден" with „Наиден", which
 *  are different Bulgarian names. 0 non-NFC rows today, but four independent procurement
 *  feeds write these names and none of them normalizes.
 *
 *  Deliberately NOT a token fold: a shared word is exactly the distinction that matters
 *  elsewhere in this repo, and here a genuinely different company name must stay visible.
 *
 *  ⚠️ KNOWN GAP: Cyrillic/Latin homoglyphs (А/A, Е/E, О/O, Р/P, С/C …) are distinct code
 *  points that render identically, so „ПЕТРОЛ АД" vs „ПЕТРОЛ AД" still prints the same
 *  visible name twice. Unquantified — a homoglyph probe needs a per-character sweep the
 *  fold cannot express in SQL. The repo owns a fold for this (`translit_bg_latin`
 *  server-side, `shlyoRules` client-side); wiring one in belongs here, in `nameKey`, so
 *  `sameName` stays one definition. */
const nameKey = (s: string): string =>
  s
    .normalize("NFC")
    .toLocaleLowerCase("bg")
    .replace(/[^\p{L}\p{N}]+/gu, "");

const sameName = (a: string, b: string): boolean => nameKey(a) === nameKey(b);

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

/**
 * Where an ENTITY row goes, and why it carries a scope.
 *
 * ⚠️ `pscope=all` IS THE POINT OF THESE HELPERS, not decoration. The euro figure on an
 * entity row is `search_contractors` / `search_awarders`' ALL-TIME total — those functions
 * take no date bound, because the search box is global and has no scope of its own — while
 * `/company/:eik` and `/awarder/:eik` default to the selected parliament's window. Measured
 * 2026-09-02: „Клет България" (130878827) previews €22,424,885 and the page it links to
 * showed €3,969,914, with the advertised figure appearing nowhere on it; МБАЛ „Княгиня
 * Клементина" (000689061) previews €62,620,984 against €685,098, a 91× gap. Corpus-wide only
 * 3.8% of contract money and 12.3% of contractors fall inside that default window, so for
 * 87.7% of companies the row promised a number and the destination said „Няма договори за
 * избрания период.".
 *
 * The see-all links BELOW these rows have carried `pscope=all` for exactly this reason since
 * they were written („'See all' must mean all-time" — ProcurementSearchTile) — the rows above
 * them did not, which is the whole defect. Both halves of a group now agree.
 *
 * ⚠️ THE FIX IS NOT TO SCOPE THE FIGURE INSTEAD. The box has no `?pscope`, so a scoped search
 * value would make the same company show a different number depending on which page the
 * reader happened to search from.
 *
 * ⚠️ AN EXPLICIT SEARCH STRING IS ALSO WHAT MAKES THIS DETERMINISTIC. These rows render
 * through react-router's `Link`, not `@/ux/Link`, so they never inherit `usePreserveParams`'
 * allowlist — a bare path navigates with an EMPTY query string and lands on the `ns` default
 * whatever the reader had selected. `pscope` IS in that allowlist, so from here on it rides
 * along on ordinary in-app links, exactly as the see-alls' already does.
 *
 * ⚠️ ACCEPTED COST 1 — THIS REPLACES A SCOPE THE READER CHOSE ELSEWHERE. Because `pscope` is
 * in that allowlist, a reader who picked `?pscope=y:2024` on /procurement, searched, and
 * clicked a row carries `all` onward for the rest of the session; nothing writes `y:2024`
 * back. Taken deliberately — a row whose figure the destination contradicts is the worse
 * failure — and the see-alls beside these rows have behaved this way since they were written.
 *
 * ⚠️ ACCEPTED COST 2 — THE SCOPE AND NOTHING ELSE. `SearchItem.to` is a bare string, so these
 * emit one fixed param rather than merging `usePreserveParams`' allowlist the way `seeAllTo`
 * does. `elections` therefore does NOT survive a row click, while it does survive a click on
 * the see-all in the same group. Only the global election anchor resets; the window — the one
 * thing the row's figure is about — is exactly what these set.
 *
 * ⚠️ NOT `useAwarderHref()` / `AwarderLink` / `CompanyLink`, which carry the reader's CURRENT
 * scope through `useScopedHref()`. That is right for a tile whose figures are already scoped
 * and wrong for a search row whose figure has no date bound. The two families sit one `use`
 * prefix apart in sibling directories, so these names say all-time out loud.
 */
const allTimeScope = `?${SCOPE_PARAM}=${SCOPE_ALL}`;

/** A contractor's page, on the ALL-TIME window the row's figure was measured over.
 *  ⚠ Not `CompanyLink`, which carries the reader's current scope. */
export const companyAllTimeHref = (eik: string): string =>
  `/company/${encodeURIComponent(eik)}${allTimeScope}`;

/** A buyer's page, same window — `/awarder/:eik` is routed to the same screen.
 *  ⚠ Not `useAwarderHref()`, which carries the reader's current scope. */
export const awarderAllTimeHref = (eik: string): string =>
  `/awarder/${encodeURIComponent(eik)}${allTimeScope}`;

/**
 * Buyer rows. PURE, and exported beside `contractItems`/`tenderItems` for the reason that
 * pair already carries: a consumer running its OWN request (`ProcurementSearchTile`,
 * `cultureSearch`) must be able to reuse the mapping without reusing the request.
 */
export const awarderItems = (
  body: ProcurementSearchResponse,
  // ⚠️ REQUIRED, not defaulted. It decides a user-visible SENTENCE, and a Bulgarian
  // default renders plausible Bulgarian prose inside an English UI at a 200 — unlike a
  // missing i18n key, which renders the key and is loud. Every call site already passes
  // it, so requiring it turns a future omission into a compile error at no cost.
  bg: boolean,
): SearchItem[] =>
  (body.awarders ?? []).map((a) => ({
    id: `awarder-${a.eik}`,
    to: awarderAllTimeHref(a.eik),
    primary: decodeEntities(a.name),
    secondary: entitySubtitle(a, bg),
    amountEur: a.contractsEur,
    icon: Landmark,
  }));

/**
 * Contractor rows.
 *
 * ⚠ A link promises somewhere to go. `contractor_eik` carries synthetic keys — `ph-` (a
 * filler registration number), `np-` (a natural PERSON keyed by name) and the documented
 * EMPTY STRING — which render a page but name nothing anybody can check against a register;
 * the empty key produces `/company/?pscope=all`, a path matching no route at all.
 * `isLinkableCompanyKey` is the one predicate for that, and it deliberately KEEPS `obed-`
 * consortium carriers, whose page is the only route from a joint bid to the firms behind it.
 *
 * ⚠️ THE FILTER IS WHY THIS IS A SHARED BUILDER RATHER THAN A MAPPING EACH CALLER REPEATS.
 * `ProcurementSearchTile` hand-rolled its own copy of these two and was therefore the one
 * surface still linking synthetic keys — the duplication was not cosmetic, it is what let the
 * two drift. A caller that maps `body.companies` itself re-opens that hole, and
 * `companyKey.test.ts`'s repo-wide net cannot see it: that net matches the JSX token
 * ``to={`/company/${…`` and an object literal calling a helper is invisible to it. Use this.
 */
export const companyItems = (
  body: ProcurementSearchResponse,
  /** Required — see `awarderItems`. */
  bg: boolean,
): SearchItem[] =>
  (body.companies ?? [])
    .filter((c) => isLinkableCompanyKey(c.eik))
    .map((c) => ({
      id: `company-${c.eik}`,
      to: companyAllTimeHref(c.eik),
      primary: decodeEntities(c.name),
      secondary: entitySubtitle(c, bg),
      amountEur: c.contractsEur,
      icon: Briefcase,
    }));

export const fetchProcurementAwarders = async (
  query: string,
  signal: AbortSignal,
  bg: boolean,
): Promise<SearchItem[]> =>
  awarderItems(await sharedProcurementSearch(query, signal), bg);

export const fetchProcurementCompanies = async (
  query: string,
  signal: AbortSignal,
  bg: boolean,
): Promise<SearchItem[]> =>
  companyItems(await sharedProcurementSearch(query, signal), bg);

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
