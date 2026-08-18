// The ONE definition of "does this free-text name / title belong to culture".
//
// Every figure the culture surfaces publish about a corpus that has no culture
// EIK dimension — ИСУН beneficiaries, ДФЗ beneficiaries, Interreg operation
// titles — is produced by one of the matchers below, and by nothing else. It
// exists because `docs/plans/culture-investigative-v1.md` was drafted with four
// headline figures whose matching was never written down, and re-deriving them
// showed the largest one was mostly false positives.
//
// WHY THIS IS TYPESCRIPT AND NOT SQL: nothing that serves a request needs it.
// The EIK-keyed sector filter (`SECTOR_BROWSE_PACKS`, `?sector=`) is what
// `db_table.js` and the `/api/db` routes use, and that is a set of digits, not a
// name match. These matchers are for LOADERS, GENERATORS and DATA TESTS — all of
// which run under tsx and can import this file — so there is deliberately no SQL
// twin to drift from it. Render them into SQL with the helpers at the foot.
// (Contrast `asset_share_multiplier`, which needs a TS+SQL pair precisely
// because a Cloud Function route cannot import TypeScript.)
//
// ⚠️ It is NOT the only definition of "which bodies are culture" in this repo,
// and must not be read as one. `kulturaReferenceData.ts` holds the curated EIK
// allowlist, hand-classified by BUDGET PRINCIPAL, and that file decides
// membership for anything with an EIK. This file answers the strictly weaker
// question a NAME can answer, for the three corpora where no EIK dimension
// exists. Where both can speak they must agree, and
// `culture_match.data.test.ts` asserts it: every `STATE_CULTURE_INSTITUTE_EIKS`
// member with an ИСУН row must be admitted here. That test is not decoration —
// it is what caught `театр` (below) failing to match „Народен театър".
//
// ── THE TWO WAYS A STEM GOES WRONG ───────────────────────────────────────────
//
// (1) TOO WIDE — a culture stem is a prefix of an unrelated word. Unanchored,
// this does not merely add noise, it can invert the figure. Four instances, all
// measured:
//
//   `опера`   → оператор / операция / кооперация / оперативен.
//               Unguarded, `Електроенергиен системен оператор ЕАД` — the
//               national grid operator — contributes €189,443,288 of ИСУН grant
//               from TWO rows, on its own larger than the true sector total.
//   `култур`  → аквакултури / агрикултури / агрокултури / фуражни култури.
//               The trap `kulturaReferenceData.ts` already documents for the EIK
//               list („Институт по полски култури").
//   `изкуств` → изкуствен интелект. One digital-innovation hub, €4,868,890.
//   `cultur`  → agriculture / aquaculture / viticulture / horticulture, which are
//               core Interreg cross-border subject matter. Measured: 21
//               operations / 25 BG partner rows / €4,025,980 — 7.6% of the
//               thematic arm — matching on NOTHING ELSE.
//
// (2) TOO NARROW — a Bulgarian FUGITIVE VOWEL. Several culture nouns carry a `ъ`
// in the nominative singular that DISAPPEARS in the plural and the adjective:
// театър→театри/театрален, ансамбъл→ансамбли, кинотеатър→кинотеатри. A stem
// taken from the adjective therefore cannot match the singular, which is how
// every institution actually writes its own name. Measured: `театр` missed 24
// theatres and €14,641,941 — including Народен театър „Иван Вазов" and Държавен
// сатиричен театър, BOTH members of `STATE_CULTURE_INSTITUTES` — while still
// matching nine adjectival rows, so no count went to zero and no test noticed.
//
// The rule that falls out: **write the stem short enough to survive the vowel,
// then check what else it catches.** `теат` and `ансамб` are safe as substrings
// (no unrelated Bulgarian word carries either — verified against the corpus, not
// assumed); `опера` and `кино` are not, and are word-anchored instead.
//
// ⚠️ Adding a term without running BOTH checks — what else does it match, and
// does it survive the singular — is how every defect above shipped.
// `culture_match.data.test.ts` pins each named case, but a NEW bad stem is
// invisible to it until someone adds its case.

/** A matcher term. `bare` is the unguarded spelling the term would have had
 *  without anchoring, and exists ONLY so a test can prove the anchoring still
 *  changes the number. Omit it when the term needs no anchoring. */
type Term = { readonly re: string; readonly bare?: string };

const patternOf = (terms: readonly Term[], anchored = true): string => {
  const parts = terms
    .map((t) => (anchored ? t.re : (t.bare ?? t.re)))
    // An EMPTY alternative matches the empty string, i.e. every row — so a term
    // whose unanchored form is subsumed by another term's (`\yarts\y` under a
    // bare `art`) declares `bare: ""` and is dropped here rather than widening
    // the pattern to everything. Silent catastrophe if this filter is removed.
    .filter((re) => re.length > 0);
  if (!parts.length) throw new Error("cultureMatch: empty pattern");
  return parts.join("|");
};

// ── ИСУН / ДФЗ — the Bulgarian name arm ──────────────────────────────────────

const CULTURE_NAME_TERMS: readonly Term[] = [
  { re: "читалищ" }, // народно читалище
  { re: "музе" }, // музей / музеен
  { re: "теат" }, // театър / театри / театрален — NEVER `театр`; see (2) above
  { re: "галери" }, // галерия
  { re: "библиотек" }, // библиотека / библиотекознание
  { re: "филхармони" },
  { re: "ансамб" }, // ансамбъл / ансамбли — same fugitive vowel as театър
  { re: "художествен" }, // Национална художествена академия / гимназия
  { re: "изкуств" }, // изкуство / изкуства — see `изкуствен` in the exclusions
  { re: "\\yопера\\y", bare: "опера" }, // the opera house, never оператор
  { re: "\\yоперен" },
  { re: "\\yоперна" },
  { re: "\\yкино\\y", bare: "кино" },
  { re: "\\yкинот" }, // кинотека
  { re: "култур" }, // култура / културен — see the crop terms in the exclusions
];

export const CULTURE_NAME_INCLUDE = patternOf(CULTURE_NAME_TERMS);

/** Lexical false positives ONLY — words that merely contain a culture stem.
 *  Never a policy exclusion: a body kept out for having the wrong budget
 *  principal belongs in `kulturaReferenceData.ts`'s `EXCLUDED_EIKS`, keyed by
 *  EIK. Mixing the two would make a name pattern carry a policy.
 *
 *  ⚠️ SEMANTICS: this is a WHOLE-VALUE VETO. A name matching any term here is
 *  dropped even if it also carries a genuine culture term, so „Читалище при
 *  земеделска кооперация" would be lost. Measured on both corpora today the
 *  overlap is empty, which is what makes the cheap form safe; re-check it when
 *  either corpus reloads, and switch to a residual-text test if rows appear. */
export const CULTURE_NAME_EXCLUDE = [
  "аквакултур", // аквакултури — fish farming
  "агр[иоа]култур", // агрикултури / агрокултури — both spellings are live
  "фуражн", // фуражни култури
  "полск(и|а) култур",
  "земеделск(и|а) култур",
  "растителн", // растителни култури
  "култури\\y", // the bare plural is always crops in this corpus
  "изкуствен", // изкуствен интелект
  // The `опер-` family. `\yопера\y` already excludes most of these by
  // anchoring, so several are inert TODAY and kept deliberately: the anchoring
  // and the exclusion guard the same trap by different means, and a future
  // relaxation of one must not silently remove the other.
  "оператор",
  "операц",
  "оператив",
  "кооперат", // кооперация AND кооператив
].join("|");

// ── Interreg — the English theme arm ─────────────────────────────────────────
//
// A DIFFERENT question from the two above, and the difference is load-bearing:
// this matches an OPERATION's title (what the project is about), not a
// PARTNER's name (who the body is). The two answers are ~5x apart and their
// partner populations barely overlap — the thematic arm is overwhelmingly
// общини and NGOs. A surface picks one and says which.
//
// keep.eu publishes 86% of these titles in English only, so this is `title_en`.

const INTERREG_THEME_TERMS: readonly Term[] = [
  { re: "cultur" }, // cultural / culture — guarded by the -culture compounds below
  { re: "heritage" },
  { re: "museum" },
  { re: "theatre" },
  { re: "theater" },
  // NEVER bare `art`: unanchored it matches Partnership, Participation, Smart
  // and Department. Measured, 121 of 361 matched operations matched on nothing
  // but that substring, carrying 28% of the BG partner rows and 24% of the money.
  { re: "\\yart\\y", bare: "art" },
  { re: "\\yarts\\y", bare: "" },
  { re: "artistic" },
];

export const INTERREG_CULTURE_THEME_INCLUDE = patternOf(INTERREG_THEME_TERMS);

/** The English half of the `култур`→`аквакултури` trap. `cultur` cannot be
 *  word-anchored (it must match `cultural`), so the compounds are excluded by
 *  name. Measured: 21 operations / €4,025,980 — 7.6% of the thematic arm —
 *  matched on nothing else. Same whole-value veto semantics as the name
 *  exclusions above; verified today that no operation carries both an agronomy
 *  compound and a genuine culture term. */
export const INTERREG_CULTURE_THEME_EXCLUDE = [
  "agricultur",
  "aquacultur",
  "horticultur",
  "viticultur",
  "apicultur",
  "silvicultur",
  "sericultur",
  "permacultur",
  "maricultur",
  "monocultur",
  "arboricultur",
  "floricultur",
  "piscicultur",
].join("|");

// ── The читалища arm ─────────────────────────────────────────────────────────
//
// Народните читалища are a sub-group of the culture set, not a synonym for it,
// and they are the ONLY culture presence in the ДФЗ corpus — no state culture
// institution files a farm subsidy. Kept separate so a surface can say
// „читалища" when that is what it counted, rather than implying the sector.
export const CHITALISHTE_NAME_INCLUDE = "читалищ";

// ── SQL rendering ────────────────────────────────────────────────────────────

/** Postgres string literal — doubles any single quote. The patterns above are
 *  compile-time constants, so this is hygiene rather than injection defence. */
const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** Callers pass a column reference, sometimes qualified (`o.title_en`). It is
 *  always a literal at the call site today, so this is a typo guard rather than
 *  a security boundary — but it is the one input to this module that is not a
 *  compile-time constant, so it is checked rather than trusted. */
const col = (c: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(c))
    throw new Error(`cultureMatch: not a plain column reference: ${c}`);
  return c;
};

export type MatchOpts = {
  /** `false` renders the INCLUDE half alone. For tests that prove the exclusion
   *  list still changes the number — never for a published figure. */
  withExclusions?: boolean;
  /** `false` renders the pre-anchoring spellings. Same purpose, same rule. */
  anchored?: boolean;
};

const predicate = (
  c: string,
  terms: readonly Term[],
  exclude: string,
  opts: MatchOpts,
): string => {
  const ref = col(c);
  const include = `${ref} ~* ${lit(patternOf(terms, opts.anchored !== false))}`;
  if (opts.withExclusions === false) return `(${include})`;
  return `(${include} AND ${ref} !~* ${lit(exclude)})`;
};

/** The culture NAME predicate, for `fund_projects.beneficiary_name` and
 *  `agri_subsidies.name`. */
export const cultureNameSql = (c: string, opts: MatchOpts = {}): string =>
  predicate(c, CULTURE_NAME_TERMS, CULTURE_NAME_EXCLUDE, opts);

/** The Interreg THEMATIC predicate, over an operation title (`title_en`). */
export const interregThemeSql = (c: string, opts: MatchOpts = {}): string =>
  predicate(c, INTERREG_THEME_TERMS, INTERREG_CULTURE_THEME_EXCLUDE, opts);

/** The читалища sub-group. No exclusions: the stem has no known collision. */
export const chitalishteNameSql = (c: string): string =>
  `(${col(c)} ~* ${lit(CHITALISHTE_NAME_INCLUDE)})`;
