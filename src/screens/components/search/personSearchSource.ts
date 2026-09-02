// The ONE `/api/db/person-search` request, and the pure pieces every consumer of it needs.
//
// WHY IT IS SHARED. That endpoint answers THREE tiers from a single call — `power` (public,
// resolved), `money` (private owners whose companies took public money) and `others` (the
// long-tail private owners) — so any hub offering more than one of them issues it once per
// GROUP per keystroke unless the sources await the same promise. `procurementSearchSource.ts`
// made this argument for the procurement endpoint; this is the person half of it.
//
// ⚠️ KEYED BY THE FULL REQUEST, NOT BY THE QUERY ALONE. `decl=1|0` is a different request —
// the declarations hub asks for both as two calls, because scope RANKS and never filters —
// so a key of `q` alone would answer the „has filed" group with the „has not" group's rows.
// Not cached across queries: the box debounces and aborts, so the only overlap worth
// collapsing is two sources asking for the SAME needle in the same tick.
//
// WHAT READS IT TODAY: `governanceSearch`, `declarationsSearch` and — through
// `personSearchGroups` — `/procurement`'s combined box. `ProcurementSearchTile` still runs its
// own `fetch` for the response itself (it drives an `EntitySearchTile` rather than a
// `HubSearch`), so the destinations and labels are unified across all three while the REQUEST
// is shared by two. `companyPeopleItems` / `balancedPrivate` / `fetchCompanyPeople` have no
// caller yet: they are the home finder's V/N group, landing in Phase 5, and are tested here.
//
// Plan: docs/plans/home-search-expansion-v1.md §3.2-3.3 + Phase 3.

import { Users, Coins, FileText } from "lucide-react";
import type { SearchItem } from "@/ux/search/EntitySearchTile";
import { decodeEntities } from "@/lib/decodeEntities";
import { isSharedNameIdentity } from "@/screens/person/sharedNameIdentity";

/** One ranked person row — snake_case, as the route returns raw columns.
 *  tier P = public figure, V = money-linked private owner, N = other owner. */
export interface PersonHit {
  /** `slug:<slug>` (a real person row) | `fold:<name_fold>` (a name-fold identity).
   *  ⚠️ THE KEY NAMESPACE, NOT THE TIER, DECIDES THE DESTINATION — see `personHref`. */
  key: string;
  name: string;
  tier: "P" | "V" | "N";
  /** A CODE (politician / executive / magistrate / …), not a label. */
  position_type: string | null;
  /** The SPECIFIC office (mayor / councillor / magistrate / …), P only. */
  primary_role?: string | null;
  party?: string | null;
  place_label: string | null;
  top_eik?: string | null;
  firms_count?: number;
  public_money_eur?: number;
  identity_confidence?: string;
  href: string;
  has_declaration?: boolean;
}

export interface PersonSearchResponse {
  power?: PersonHit[];
  money?: PersonHit[];
  others?: PersonHit[];
  /** The shliokavitsa-rewritten needle the rows came from, or null. A "see all" MUST use it:
   *  the browse tables it lands on run their own search and do not carry this rewrite. */
  altQuery?: string | null;
}

/** `decl=1` filed, `decl=0` not filed, absent = no restriction. */
export type DeclFilter = "1" | "0" | undefined;

/** The request key. `decl` FIRST and a separator between, so that a query which happens to
 *  look like a decl value cannot collide with a real one. `decl` is a closed set
 *  ({"1","0",undefined}) and the separator sits at a fixed position, so any printable
 *  character works — this one is chosen for being greppable.
 *
 *  ⚠️ It was a literal U+0000 for one commit, which made this file BINARY to git (`git diff`
 *  reported `Bin 0 -> 14455 bytes`, 0 insertions) and invisible to `grep`, while eslint and
 *  tsc stayed clean. Never put a control character in source to save a comparison. */
const keyOf = (query: string, decl: DeclFilter): string =>
  `${decl ?? ""}|${query}`;

let inFlight: { key: string; p: Promise<PersonSearchResponse> } | null = null;

/**
 * The needle each answered query actually came from, so a SYNCHRONOUS `seeAll` callback can
 * read it. `HubSearch` calls `seeAll(query)` during render and cannot await anything, so the
 * value has to be sitting here by the time a group has rows to show — which it is, because a
 * group only renders once its fetch resolved.
 *
 * ⚠️ KEYED ON THE QUERY ALONE, NOT ON (query, decl), AND WRITTEN UNCONDITIONALLY. Both
 * choices are load-bearing and the first cut got both wrong:
 *
 *   - `altQuery` is a pure function of the QUERY server-side — the route derives it from the
 *     shliokavitsa rewrite and never looks at `decl` — so a per-decl key buys nothing and
 *     splits one answer across two slots.
 *   - Gating the write on „am I still the in-flight entry" looks symmetric with the eviction
 *     below and is not. `HubSearch` fires every source in ONE pass, so the declarations hub's
 *     `decl=1` call is displaced by its `decl=0` call before either resolves; the `decl=1`
 *     response then found `inFlight !== entry` and wrote nothing, and „Виж всички с
 *     декларация" shipped the un-rewritten needle for ever. A reader typing „Jelqzkov" was
 *     shown six people and sent to `/persons?q=Jelqzkov&decl=1`, which returns zero — the
 *     exact dead end this plumbing exists to prevent, and a REGRESSION against what the
 *     single unconditional slot it replaced used to do.
 *
 * A stale write can only ever land under its OWN query's key, and reads are by key, so an
 * out-of-order resolution cannot make one query wear another's rewrite.
 */
const altByQuery = new Map<string, string | null>();
/** Small on purpose: this is a hot-path lookup for the CURRENT query, not a store. Cleared
 *  wholesale rather than evicted one by one — the only entry that matters is the newest. */
const ALT_CACHE_MAX = 8;

/**
 * ⚠️ THE PROMISE BINDS TO THE FIRST CALLER'S `AbortSignal`, AND THAT IS ONLY SAFE BECAUSE
 * `HubSearch` GIVES EVERY SOURCE THE SAME ONE. It fires all server sources in a single pass
 * on one `AbortController` per debounced query, so "the first caller's signal" and "every
 * caller's signal" are the same object. A caller with a controller of its own — a second
 * search surface on one page, or a component migrated to this module without that property —
 * would inherit an abort it never requested: its group would render as FAILED and drop out of
 * „Няма съвпадения в: …", which is the outage-reported-as-absence failure this module's own
 * header forbids. Give such a caller its own fetch, or key the entry by signal too.
 */
export const sharedPersonSearch = (
  query: string,
  signal: AbortSignal,
  decl?: DeclFilter,
): Promise<PersonSearchResponse> => {
  const key = keyOf(query, decl);
  if (inFlight?.key === key) return inFlight.p;
  const p = fetch(
    `/api/db/person-search?q=${encodeURIComponent(query)}` +
      (decl ? `&decl=${decl}` : ""),
    { signal },
  ).then((r) => {
    // Throw rather than degrade: HubSearch tells a failed group from an empty one and drops
    // it from its „searched in: …" line. Swallowing would report our outage as an absence.
    if (!r.ok) throw new Error(`person-search: ${r.status}`);
    return r.json() as Promise<PersonSearchResponse>;
  });
  const entry = { key, p };
  inFlight = entry;
  p.then(
    (body) => {
      if (altByQuery.size >= ALT_CACHE_MAX) altByQuery.clear();
      altByQuery.set(query, body.altQuery ?? null);
    },
    () => {
      // ⚠️ A SETTLED FAILURE IS EVICTED, AND WITHOUT THIS THE CACHE POISONS A NEEDLE FOR
      // EVER. A rejection — a 500, or the abort HubSearch fires on EVERY keystroke — would
      // stay cached under its key, so backspacing to a just-aborted needle returns the
      // rejected promise and never re-issues the request. Both people groups would then
      // vanish AND their names would vanish from „Няма съвпадения в: …", which is the
      // outage-reported-as-absence failure this module exists to prevent. Only the entry we
      // installed is cleared, so a newer query's entry survives an older one's rejection.
      if (inFlight === entry) inFlight = null;
    },
  );
  return p;
};

/** The needle a „see all" for this query must carry, or the query itself.
 *
 *  Takes no `decl`: the rewrite is decl-independent (see `altByQuery`), so both declarations
 *  groups read one answer. Falls back to the typed query, which is the safe direction — a
 *  link to what the reader typed is at worst as good as the box's own first attempt. */
export const personAltQuery = (query: string): string =>
  altByQuery.get(query) || query;

/** TEST ONLY — clears the in-flight entry so one case cannot answer the next. */
export const __resetPersonSearchCache = (): void => {
  inFlight = null;
  altByQuery.clear();
};

// ── Destinations ───────────────────────────────────────────────────────────────────────
//
// ⚠️ BRANCH ON THE KEY NAMESPACE, NEVER ON THE TIER. They are different questions, and
// conflating them throws away a working page for most of the V tier: measured 2026-09-02,
// 69,367 of 84,557 V rows carry a `slug:` key and a real `/person/<slug>` href, against
// 15,190 that are name-fold identities. `load_person_search_pg.ts`'s V-real arm exists for
// exactly that reason — its own comment says these rows "belong in the money (V) tier by
// their REAL slug … Without this they would fall through to the tr_officers arm and route by
// /person/<name> with a 'name_fold' badge despite being verified" — and a tier test undoes it.
export const personHref = (h: PersonHit): string =>
  h.key.startsWith("slug:")
    ? h.href
    : // A name-fold identity has no slug; the route is the raw name and the segment must be
      // encoded (126's own column comment says so — it can contain spaces and punctuation).
      `/person/${encodeURIComponent(h.name)}`;

// ── Labels ─────────────────────────────────────────────────────────────────────────────

/** position_type CODE → display label.
 *
 *  The codes are `person_browse_table.primary_facet` with `company`/`concession` collapsed to
 *  `private_sector` (`load_person_search_pg.ts`), so SIX values exist live — private_sector,
 *  politician, executive, public_sector, magistrate, regulator — and all six are mapped. The
 *  extra entries cover the wider `person_source.facet` vocabulary in case that collapse is
 *  ever relaxed. An unmapped code falls back to ITSELF, which leaks raw English to a BG
 *  reader; that is the failure this map's completeness prevents, and it is why a new facet
 *  belongs here the day the loader stops folding it away. */
const POSITION_LABEL: Record<"bg" | "en", Record<string, string>> = {
  bg: {
    politician: "Политик",
    executive: "Изпълнителна власт",
    public_sector: "Публичен сектор",
    magistrate: "Магистрат",
    regulator: "Регулатор",
    private_sector: "Частен сектор",
    ngo: "НПО",
    donor: "Дарител",
    ds: "Досие ДС",
    sanctions: "Санкции",
    media: "Медии",
    professional: "Нотариус/ЧСИ",
    other: "Друго",
  },
  en: {
    politician: "Politician",
    executive: "Executive",
    public_sector: "Public sector",
    magistrate: "Magistrate",
    regulator: "Regulator",
    private_sector: "Private sector",
    ngo: "NGO",
    donor: "Donor",
    ds: "State Security file",
    sanctions: "Sanctions",
    media: "Media",
    professional: "Notary/bailiff",
    other: "Other",
  },
};

export const positionLabel = (code: string | null, bg: boolean): string =>
  (code && POSITION_LABEL[bg ? "bg" : "en"][code]) || code || "";

/** Localizes a `person_role.role` code — `usePersonLabels().roleLabel`, passed in because this
 *  module is not a component and cannot call a hook. */
export type RoleLabeler = (role: string | null | undefined) => string;

/**
 * „Кмет · Столична община" — the SPECIFIC office, with the broad facet only as a fallback.
 *
 * ⚠️ THE BROAD FACET IS NOT AN ACCEPTABLE ANSWER WHERE A SPECIFIC ONE EXISTS. „Политик ·
 * Столична община" is true of Sofia's mayor and of 46,158 other people; it is what tells two
 * namesakes apart that this line is for. All 56 distinct `primary_role` codes in the corpus
 * have a `pp_role_*` key in the CORE locale file (verified 2026-09-02), so the fallback is a
 * guard against a NEW code rather than an expected path — but it stays, because the resolver
 * mints role codes from source data and a new one appears before anyone writes its label.
 */
export const roleSubtitle = (
  h: PersonHit,
  bg: boolean,
  roleLabel?: RoleLabeler,
): string => {
  const role =
    (h.primary_role && roleLabel?.(h.primary_role)) ||
    positionLabel(h.position_type, bg);
  return [role, h.place_label]
    .filter(Boolean)
    .map((x) => decodeEntities(String(x)))
    .join(" · ");
};

/**
 * The identity caveat a row's confidence licenses — THREE states, not two.
 *
 * ⚠️ `shared_name` HAD NO CAVEAT AT ALL until 2026-09-02, and it is the one that most needs
 * one: it means the Commerce Registry positively records SEVERAL DIFFERENT PEOPLE under this
 * name (081), so the row almost certainly spans more than one human. `/person` and `/persons`
 * both say so; the search dropdowns said nothing, for 4,376 rows. `name_fold` is the weaker
 * „this is a name match, not a verified person" (15,190 + 445,804 rows). `verified` and
 * `resolved` carry none — 64,991 V rows are verified people with real slugs.
 *
 * The predicate is `isSharedNameIdentity`, shared with the profile, so the two cannot decide
 * differently about one person. Its own header notes it is fail-safe by construction:
 * disagreement produces the caveat, never its absence.
 */
export const identityCaveat = (h: PersonHit, bg: boolean): string | null => {
  if (isSharedNameIdentity({ identityConfidence: h.identity_confidence }))
    return bg ? "няколко лица" : "several people";
  if (h.identity_confidence === "name_fold")
    return bg ? "съвпадение по име" : "name match";
  return null;
};

/** „3 фирми · няколко лица" — the private-tier subtitle. */
export const firmsSubtitle = (h: PersonHit, bg: boolean): string => {
  const n = Number(h.firms_count) || 0;
  // Bulgarian singularises at one exactly as English does — „1 фирма", „2 фирми". The
  // English side has always done this; the Bulgarian side said „1 фирми" for every
  // single-company owner, which is most of the long tail.
  const firms = bg
    ? `${n} ${n === 1 ? "фирма" : "фирми"}`
    : `${n} ${n === 1 ? "company" : "companies"}`;
  const caveat = identityCaveat(h, bg);
  return caveat ? `${firms} · ${caveat}` : firms;
};

// ── The V/N quota ──────────────────────────────────────────────────────────────────────

/**
 * A balanced preview of the two private tiers.
 *
 * ⚠️ ONE LIST WITH V FIRST WOULD REPRODUCE THE BUG THIS SPLIT EXISTS TO FIX, one level down.
 * V is money-linked and outranks N by construction (`rank_static` stratifies P ≫ V ≫ N), so a
 * common name fills the whole cap with V rows and the 445,804-row N tier is unreachable from
 * the home page. Take one from each while both have rows, then let whichever still has rows
 * fill the remainder — so a query matching only one tier still fills its budget.
 *
 * Deterministic: no sort, no scoring. Each tier already arrives ranked.
 */
export const balancedPrivate = (
  money: PersonHit[],
  others: PersonHit[],
  cap: number,
): PersonHit[] => {
  const out: PersonHit[] = [];
  let i = 0;
  while (out.length < cap && (i < money.length || i < others.length)) {
    if (i < money.length && out.length < cap) out.push(money[i]);
    if (i < others.length && out.length < cap) out.push(others[i]);
    i += 1;
  }
  return out;
};

// ── Sources ────────────────────────────────────────────────────────────────────────────

/**
 * Public figures (tier P).
 *
 * ⚠️ NO `amountEur`, DELIBERATELY. `public_money_eur` on a P row is money that reached
 * COMPANIES LINKED TO the person — 1,232 of them carry one, up to €992M — and rendering it
 * beside a name on `/governance/declarations`, a hub about DECLARED wealth, states a figure
 * under a basis the heading does not carry. The procurement tile shows it (its own heading is
 * about public money and `buildPersonGroups` maps that group itself), and the governance
 * finders never did; folding both onto one builder silently gave it to the two that did not.
 * A surface that wants it should say so at its own call site.
 *
 * The icon splits on a FILING, not on the tier: `FileText` when the register holds one,
 * `Users` otherwise — the same pair both governance boxes used before this module existed.
 */
export const publicPeopleItems = (
  body: PersonSearchResponse,
  bg: boolean,
  roleLabel?: RoleLabeler,
): SearchItem[] =>
  (body.power ?? []).map((h) => ({
    id: `pw-${h.key}`,
    to: personHref(h),
    primary: decodeEntities(h.name),
    secondary: roleSubtitle(h, bg, roleLabel) || undefined,
    icon: h.has_declaration ? FileText : Users,
  }));

/** Commerce-Registry people (tiers V + N), balanced. */
export const companyPeopleItems = (
  body: PersonSearchResponse,
  bg: boolean,
  cap: number,
): SearchItem[] => {
  // ⚠️ THE ARRAY A ROW CAME FROM DECIDES ITS PRESENTATION, NOT ITS `tier` FIELD. They agree
  // today, and reading the field would quietly disagree the day the route puts a row in the
  // other array — an N-tier row arriving under `money` would then render with no money and a
  // plain icon inside the money-linked half of the list, which reads as "this owner took
  // nothing" rather than as a producer change.
  const v = new Set(body.money ?? []);
  return balancedPrivate(body.money ?? [], body.others ?? [], cap).map((h) => {
    const linked = v.has(h);
    return {
      id: `${linked ? "mn" : "ot"}-${h.key}`,
      to: personHref(h),
      primary: decodeEntities(h.name),
      secondary: firmsSubtitle(h, bg),
      // ⚠️ MONEY ONLY FOR THE MONEY-LINKED ARM. `public_money_eur` is 0 for the N tier by
      // construction — that tier is "every other Commerce-Registry owner" — and rendering a 0
      // beside a name reads as a measured zero rather than as "not in this basis".
      amountEur: linked ? h.public_money_eur : undefined,
      icon: linked ? Coins : Users,
    };
  });
};

export const fetchPublicPeople = async (
  query: string,
  signal: AbortSignal,
  bg: boolean,
  roleLabel?: RoleLabeler,
  decl?: DeclFilter,
): Promise<SearchItem[]> =>
  publicPeopleItems(
    await sharedPersonSearch(query, signal, decl),
    bg,
    roleLabel,
  );

export const fetchCompanyPeople = async (
  query: string,
  signal: AbortSignal,
  bg: boolean,
  cap: number,
): Promise<SearchItem[]> =>
  companyPeopleItems(await sharedPersonSearch(query, signal), bg, cap);
