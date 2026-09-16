import { TOOLS } from "../tools/registry";
import { stemPrefix, translitKey } from "../tools/translit";
import type { Domain } from "../tools/types";

// The domain-scope trigger for candidate pre-selection (plan C2.2).
//
// This module is the WIDENING arm of the pre-selector: it names the domains a
// question could plausibly belong to so the cloud model is shown that domain's
// tools instead of relying on lexical retrieval alone. It never runs a tool, calls
// a model, or reads the network, so its whole behaviour is measurable for free —
// see domainScope.test.ts, which scores it against the starter bank and the
// registry examples and pins the boundary traps below.
//
// It deliberately OVER-includes: a domain that should not be in scope costs
// budget (the cap prunes it), while a domain wrongly left out makes its tools
// UNREACHABLE, which no later stage can repair. So the anchors are generous, and
// the only things suppressed are the false friends a prefix match would capture:
// `съветва` (to advise) under `съвет`, and `градоустрой`/`градин` under `град`.
// The false friends are SUFFIXES of the stem, not other words — `гражданин`
// ("citizen") does not begin with `град` in either script, and romanized it is
// `grazhdanin`, which no `grad` prefix can reach.

// One anchor: either a single stem matched against romanized query tokens, or a
// phrase matched against a window of consecutive tokens.
//
// A phrase exists because the tokenizer splits on `[^\p{L}\p{N}]+`, so no single
// token ever contains a space: `"tell me about"` can only match as a SEQUENCE.
// Written as a one-token stem it would be dead code that no test could see fire.
export type Anchor =
  | {
      stem: string;
      // Tokens the prefix would otherwise capture wrongly.
      deny?: string[];
    }
  | { phrase: string[] };

// A phrase suppresses an anchor for the whole question. `министерският съвет` is
// the Council of Ministers — national government — and the `съвет` (council)
// anchor would otherwise route it to the municipal domain. Expressed over TOKENS
// in either word order, because "Council of Ministers" and "Министерският съвет"
// put the words the other way round and a raw regex also has to get case,
// inflection and the `ъ → a` romanization right.
//
// `minist` spans every romanization of the root: ministar (министър), ministerski
// (министерски), ministerstvo (министерство), ministrite (министрите) and the
// English minister/ministry/ministerial. A narrower `minister` stem misses
// `министър` entirely — translitKey implements the official ъ → a, so the standard
// Bulgarian noun romanizes to `ministar`.
const MINISTER_STEMS = ["minist"];
const COUNCIL_STEMS = ["savet", "council"];
const suppressesCouncil = (tokens: string[]): boolean =>
  tokens.some((t, i) => {
    if (!COUNCIL_STEMS.some((c) => t === c || t.startsWith(c))) return false;
    // ±2, not ±1: English puts the words as "Council of Ministers".
    const near = [
      tokens[i - 2],
      tokens[i - 1],
      tokens[i + 1],
      tokens[i + 2],
    ].filter(Boolean) as string[];
    return near.some((n) => MINISTER_STEMS.some((m) => n.startsWith(m)));
  });

// Exported so the test can assert every declared anchor is REACHABLE — the check
// that catches a stem which can never match anything.
export const ANCHORS: Record<Domain, Anchor[]> = {
  elections: [
    { stem: "избор" },
    { stem: "вот" },
    { stem: "глас" },
    { stem: "парти" },
    { stem: "парламент" },
    { stem: "депутат" },
    { stem: "мандат" },
    { stem: "президент" },
    { stem: "преференц" },
    { stem: "активност" },
    { stem: "балотаж" },
    { stem: "секци" },
    { stem: "кандидат" },
    { stem: "тур" },
    { stem: "mps" },
    { stem: "election" },
    { stem: "vote" },
    { stem: "ballot" },
    { stem: "party" },
    { stem: "parliament" },
    { stem: "turnout" },
    { stem: "presidential" },
    { stem: "runoff" },
    { stem: "seat" },
    { stem: "mandate" },
    { stem: "precinct" },
    { stem: "candidate" },
    { stem: "round" },
  ],
  local: [
    { stem: "кмет" },
    { stem: "кметств" },
    { stem: "общин" },
    { stem: "съвет", deny: ["съветва"] },
    { stem: "село" },
    { stem: "град", deny: ["градоустрой", "градин"] },
    { stem: "район" },
    { stem: "населено" },
    { stem: "местн" },
    { stem: "mayor" },
    { stem: "municipal" },
    { stem: "council", deny: ["counsel"] },
    { stem: "settlement" },
    { stem: "village" },
    { stem: "town" },
    { stem: "district" },
    { stem: "local" },
  ],
  place: [
    { stem: "разкажи" },
    { stem: "представ" },
    { stem: "профил" },
    { stem: "profile" },
    { stem: "overview" },
    { phrase: ["tell", "me", "about"] },
  ],
  fiscal: [
    { stem: "бюджет" },
    { stem: "ддс" },
    { stem: "исун" },
    { stem: "кзк" },
    { stem: "разход" },
    { stem: "приход" },
    { stem: "дълг" },
    { stem: "данък" },
    { stem: "minist" },
    { stem: "поръчк" },
    { stem: "договор" },
    { stem: "търг" },
    { stem: "изпълнител" },
    { stem: "доставчик" },
    { stem: "еврофонд" },
    { stem: "субсиди" },
    { stem: "фонд" },
    { stem: "програм" },
    { stem: "бенефициент" },
    { stem: "обществени" },
    { stem: "изразход" },
    { stem: "budget" },
    { stem: "spending" },
    { stem: "revenue" },
    { stem: "debt" },
    { stem: "tax" },
    { stem: "procurement" },
    { stem: "contract" },
    { stem: "tender" },
    { stem: "contractor" },
    { stem: "supplier" },
    { stem: "subsid" },
    { stem: "fund" },
    { stem: "programme" },
    { stem: "program" },
    { stem: "beneficiary" },
    { stem: "vat" },
    { stem: "isun" },
    { stem: "interreg" },
    { stem: "kzk" },
    { stem: "amend" },
    { phrase: ["public", "money"] },
  ],
  people: [
    { stem: "магистрат" },
    { stem: "съдия" },
    { stem: "съдеб" },
    { stem: "прокурор" },
    { stem: "декларац" },
    { stem: "имот" },
    { stem: "имуществ" },
    { stem: "богат" },
    { stem: "връзк" },
    { stem: "назначен" },
    { stem: "чиновник" },
    { stem: "поименен" },
    { stem: "mps" },
    { stem: "official" },
    { stem: "magistrate" },
    { stem: "judge" },
    { stem: "prosecutor" },
    { stem: "declaration" },
    { stem: "asset" },
    { stem: "wealth" },
    { stem: "connection" },
    { stem: "appointed" },
    { stem: "named" },
    { phrase: ["civil", "servant"] },
  ],
  // `indicators` is the catch-all domain: macro, prices, land, schools, tourism,
  // water, defence, judiciary caseload, social, waste, roads. It is also the
  // second-largest (40 tools) and holds EVERY prices/basket/chain tool, so an
  // empty trigger set here would leave 17% of the registry reachable only by
  // lexical retrieval.
  indicators: [
    { stem: "кошниц" },
    { stem: "цена" },
    { stem: "цени" },
    { stem: "продукт" },
    { stem: "вериг" },
    { stem: "магазин" },
    { stem: "инфлац" },
    { stem: "бвп" },
    { stem: "безработ" },
    { stem: "населен" },
    { stem: "раждаем" },
    { stem: "смъртн" },
    { stem: "гориво" },
    { stem: "ток" },
    { stem: "газ" },
    { stem: "училищ" },
    { stem: "матура" },
    { stem: "туризъм" },
    { stem: "отпадък" },
    { stem: "вода" },
    { stem: "водоснаб" },
    { stem: "отбрана" },
    { stem: "път" },
    { stem: "бедност" },
    { stem: "земеползв" },
    { stem: "площ" },
    { stem: "статистик" },
    { stem: "показател" },
    { stem: "данък" },
    { stem: "tax" },
    { stem: "price" },
    { stem: "basket" },
    { stem: "product" },
    { stem: "chain" },
    { stem: "store" },
    { stem: "inflation" },
    { stem: "gdp" },
    { stem: "unemployment" },
    { stem: "population" },
    { stem: "land" },
    { stem: "fuel" },
    { stem: "electricity" },
    { stem: "school" },
    { stem: "matura" },
    { stem: "tourism" },
    { stem: "waste" },
    { stem: "water" },
    { stem: "defence" },
    { stem: "defense" },
    { stem: "caseload" },
    { stem: "road" },
    { stem: "poverty" },
    { stem: "regional" },
    { stem: "macro" },
  ],
};

export type ScopeSignals = {
  // A resolved place/settlement (an EKATTE or obshtina pin). Supplied by the
  // caller, which owns the place data; this module stays data-free so it can be
  // evaluated without a corpus.
  place?: boolean;
  // A resolved party token.
  party?: boolean;
  // A resolved person name.
  person?: boolean;
};

// The curated anchors are written in each language's own script; both sides are
// romanized into ONE space before comparison, so `герб`/`gerb` and
// `министър`/`ministar` agree. Anchors are romanized once at module load.
type FlatAnchor =
  | { domain: Domain; kind: "stem"; stem: string; deny: string[] }
  | { domain: Domain; kind: "phrase"; phrase: string[] };

const anchorIndex: FlatAnchor[] = (Object.keys(ANCHORS) as Domain[]).flatMap(
  (domain) =>
    ANCHORS[domain].map(
      (a): FlatAnchor =>
        "stem" in a
          ? {
              domain,
              kind: "stem",
              stem: translitKey(a.stem),
              deny: (a.deny ?? []).map(translitKey),
            }
          : { domain, kind: "phrase", phrase: a.phrase.map(translitKey) },
    ),
);

// Romanize, then split into whole tokens on anything that is not a letter or a
// digit. Tokenizing is what makes `съд` ≠ `съдържа`: they are different TOKENS,
// where a boundary regex over the raw string has to be right about every case.
export const scopeTokens = (text: string): string[] =>
  translitKey(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

const MIN_TOKEN = 4;

// A SECOND, DERIVED vocabulary: every token the registry's own bilingual examples
// use, mapped to the domain(s) of the tools that use it. The curated list above
// encodes domain semantics and the false-friend rules; this one supplies the
// actual phrasing the starter bank is written in ("пътища", "болници",
// "лекарства", "разкажи"), which no hand-written list keeps up with as tools are
// added.
//
// It is a deliberate THIRD index over the registry `examples` field: `ai/llm/retrieve.ts`
// builds a fuse.js index over the same corpus for tool-level relevance, and
// `ai/app/toolTopics.json` tags tools with topics. Neither substitutes here — fuse
// cannot encode the false-friend denies, and toolTopics.json was measured
// inadequate by the plan (35 of 90 fiscal tools covered, 4 double-assigned). The
// divergence is intentional; keep it documented rather than "consolidating" the
// mechanisms.
//
// Over-inclusion is SAFE here and deliberate: an extra domain costs prompt budget
// that the cap prunes, while a missing domain makes its tools unreachable.
const derived: Map<string, Set<Domain>> = (() => {
  const m = new Map<string, Set<Domain>>();
  for (const tool of TOOLS)
    for (const ex of tool.examples)
      for (const token of scopeTokens(`${ex.bg} ${ex.en}`)) {
        if (token.length < MIN_TOKEN) continue;
        const set = m.get(token) ?? new Set<Domain>();
        set.add(tool.domain);
        m.set(token, set);
      }
  return m;
})();
// The same vocabulary grouped by domain, so a query token can be prefix-matched
// against a domain's stems instead of scanning every token.
const derivedByDomain: Map<Domain, string[]> = (() => {
  const m = new Map<Domain, string[]>();
  for (const [token, domains] of derived)
    for (const d of domains) {
      const arr = m.get(d);
      if (arr) arr.push(token);
      else m.set(d, [token]);
    }
  return m;
})();

// One token vs one domain's derived stems: `stemPrefix` (shared with typoMatch),
// applied in either direction so inflection is tolerated both ways — the query
// "общината" reaches the stem "община", and the stem "общин" reaches "община". A
// 4-character derived token can therefore only ever match EXACTLY, because the
// shared rule requires a 5-character prefix.
const derivedHit = (token: string, stems: readonly string[]): boolean =>
  stems.some((s) => stemPrefix(token, s));

const matchesAnchor = (anchor: FlatAnchor, tokens: string[]): boolean => {
  if (anchor.kind === "stem")
    return tokens.some(
      (token) =>
        !anchor.deny.some((d) => token.startsWith(d)) &&
        (token === anchor.stem || token.startsWith(anchor.stem)),
    );
  const { phrase } = anchor;
  if (!phrase.length || phrase.length > tokens.length) return false;
  for (let i = 0; i + phrase.length <= tokens.length; i++)
    if (phrase.every((p, j) => tokens[i + j] === p)) return true;
  return false;
};

/**
 * The PRECISE layer: curated anchors plus entity priors. This is where the
 * false-friend rules live, so it is the layer the trap tests assert on. It is
 * selective but incomplete — measured 2026-09-16 over 816 cases per language:
 * curated-only reachability en 0.517 / bg 0.563 — which is why it is not the
 * whole arm.
 */
export const curatedDomains = (
  question: string,
  signals: ScopeSignals = {},
): Domain[] => {
  const tokens = scopeTokens(question);
  // The `съвет` anchor is dropped for the whole question when it is the Council
  // of Ministers rather than a municipal council.
  const suppressed = new Set(
    suppressesCouncil(tokens) ? COUNCIL_STEMS.map(translitKey) : [],
  );
  const out = new Set<Domain>();
  for (const anchor of anchorIndex) {
    if (anchor.kind === "stem" && suppressed.has(anchor.stem)) continue;
    if (matchesAnchor(anchor, tokens)) out.add(anchor.domain);
  }
  // Entity priors: an EKATTE place, a party token, a resolved person name. These
  // are signals the caller resolved from data, not text matches.
  if (signals.place) {
    out.add("local");
    out.add("place");
  }
  if (signals.party) out.add("elections");
  if (signals.person) out.add("people");
  return [...out];
};

/**
 * The BREADTH layer: the derived vocabulary. Near-complete (measured 2026-09-16:
 * en 0.9975 / bg 0.9939 on its own) and deliberately unselective — it unions to
 * ~4.4 of 6 domains on average, because a domain label is coarse and the corpus
 * vocabulary overlaps heavily across domains ("община" appears in both municipal
 * and fiscal tools).
 *
 * It exists so that no gold domain is unreachable. Its cost is prompt budget,
 * which is why it is ranked BELOW the curated layer and pruned first.
 */
export const derivedDomains = (tokens: string[]): Domain[] => {
  const out = new Set<Domain>();
  for (const token of tokens) {
    if (token.length < MIN_TOKEN) continue;
    for (const [domain, stems] of derivedByDomain)
      if (derivedHit(token, stems)) out.add(domain);
  }
  return [...out];
};

export type RankedDomain = {
  domain: Domain;
  // 2 = curated (an anchor or an entity prior fired) · 1 = derived only.
  // The byte cap drops strength-1 domains before strength-2 ones, so widening
  // never costs reachability and only ever costs budget.
  strength: 1 | 2;
};

/** The widening arm, ordered so a pruning cap removes the weakest evidence first. */
export const domainScopeRanked = (
  question: string,
  signals: ScopeSignals = {},
): RankedDomain[] => {
  const tokens = scopeTokens(question);
  const curated = new Set(curatedDomains(question, signals));
  const out = new Map<Domain, 1 | 2>();
  for (const d of curated) out.set(d, 2);
  for (const d of derivedDomains(tokens)) if (!out.has(d)) out.set(d, 1);
  return (
    [...out.entries()]
      .map(([domain, strength]) => ({ domain, strength }))
      // Code-unit order, not localeCompare: the module's whole selling point is
      // reproducibility, and these six names are plain lowercase ASCII.
      .sort(
        (a, b) =>
          b.strength - a.strength ||
          (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0),
      )
  );
};

/**
 * The union: every domain this arm makes available.
 *
 * CONTRACT — an empty result means "no evidence at all": empty or punctuation-only
 * input, or a bare follow-up like "А втория тур?" whose subject is in the previous
 * turn. Callers must treat that as "widen to nothing" and fall back to lexical
 * retrieval and the core pins, rather than assuming a domain. A caller that has
 * the conversation should pass the resolved current question, as
 * `ai/orchestrator/routeScope.ts` does by splitting on `Текущ въпрос:` — this
 * module deliberately takes only one utterance.
 */
export const domainScope = (
  question: string,
  signals: ScopeSignals = {},
): Domain[] => domainScopeRanked(question, signals).map((d) => d.domain);

/** Every domain that owns at least one registered tool — the full widening target. */
export const ALL_DOMAINS: Domain[] = [
  ...new Set(TOOLS.map((t) => t.domain)),
].sort();

/**
 * The tools a domain scope makes reachable. Used by the free harness to score
 * whether the GOLD tool's domain was in scope — the widening arm's own recall,
 * which is the ceiling on anything downstream can pick.
 */
export const toolsInDomains = (domains: readonly Domain[]): typeof TOOLS =>
  TOOLS.filter((t) => domains.includes(t.domain));
