/**
 * The brand's NAME, as distinct from its origin (`src/lib/siteOrigin.ts`).
 *
 * Two constants, one definition each, because they change on different
 * schedules and for different reasons: the name is a rebrand, the origin is a
 * domain migration, and conflating them is what produced the state this file
 * was created to end — every page titling itself
 * `Наясно — … | electionsbg.com`, naming the new brand and the old domain in
 * one string.
 *
 * ## The suffix is PER-LOCALE, and that is enforced elsewhere
 *
 * `scripts/prerender/personRoutesEn.test.ts` asserts that no English title
 * carries Cyrillic, and the reason is not cosmetic: an `/en` title holding the
 * same Cyrillic string as its `/bg` twin makes the two mirrors compete for one
 * Bulgarian query across every sitemapped URL pair. A single `| Наясно` on both
 * sides would reintroduce exactly that, on every page at once.
 *
 * So English gets the Latin form. The two halves are structurally separable —
 * an English title lives under an `english: { … }` key or an `_EN` constant —
 * which is how the 227 English sites were told apart from the 222 Bulgarian
 * ones at the rename.
 *
 * ## The suffix is PARSED as well as appended
 *
 * `scripts/prerender/dynamicRoutes.ts` strips it back off a parent title before
 * composing a child one (`t.endsWith(SUFFIX) ? t.slice(0, -SUFFIX.length) : t`).
 * So the appending side and the stripping side must be the same string — which
 * is the whole reason this is a constant and not 444 literals. A strip that
 * silently stops matching does not throw; it leaves the suffix embedded in the
 * MIDDLE of a composed title.
 */

/** The brand name, as a reader sees it. */
export const BRAND_NAME = "Наясно";

/** Latin transliteration, for contexts that cannot carry Cyrillic. */
export const BRAND_NAME_LATIN = "Naiasno";

/** Appended to every Bulgarian document title. Leading separator included. */
export const BRAND_TITLE_SUFFIX = ` | ${BRAND_NAME}`;

/** The English twin. Latin, so an /en title carries no Cyrillic. */
export const BRAND_TITLE_SUFFIX_EN = ` | ${BRAND_NAME_LATIN}`;

/**
 * The wordmark, split at the pun the name is built on: **на** + **ясно**
 * ("into" + "clear"). The coral swipe goes under the second half, in the
 * generated assets (`drawWordmark`) and in the site header alike.
 *
 * The Latin twin splits at the SAME seam — `na` + `iasno`, not `nai` + `asno` —
 * because the join is a transliteration of the Cyrillic one and the swipe has
 * to land on the same morpheme. Split it anywhere else and the English mark
 * underlines a syllable that means nothing.
 *
 * ⚠️ The English side is Latin for the same reason `BRAND_TITLE_SUFFIX_EN` is:
 * an `/en` page should not carry Cyrillic a reader of that page cannot sound
 * out. `/en` was showing a Cyrillic header wordmark beside a `| Naiasno` title
 * until 2026-09-10 — the two halves of one lockup in two alphabets.
 *
 * The FAVICON cannot follow: it is one static file for both locales, so an
 * English visitor's tab keeps the Cyrillic monogram. That asymmetry is
 * accepted rather than overlooked — at 16px the mark reads as a shape, and the
 * alternative is shipping and serving two icon sets.
 */
export const BRAND_WORDMARK = { head: "на", tail: "ясно" } as const;
export const BRAND_WORDMARK_LATIN = { head: "na", tail: "iasno" } as const;

/** The square mark: the wordmark's first half. Capitalised in Latin, where a
 *  lowercase "na" reads as a word fragment rather than as a monogram. */
export const BRAND_MONOGRAM = BRAND_WORDMARK.head;
export const BRAND_MONOGRAM_LATIN = "Na";

/**
 * Whether the active locale takes the Cyrillic forms.
 *
 * ⚠️ THE PARAMETER IS OPTIONAL AND UNDEFINED MEANS BULGARIAN, which is not
 * defensive padding — `i18n.language` really is `undefined` before the instance
 * initialises, and a bare `lang.startsWith("bg")` therefore THROWS. It threw in
 * 197 component tests the moment this was first wired, because everything that
 * renders `SEO` or the header renders through it. In the app the same window
 * exists on the very first paint.
 *
 * Bulgarian is the right default rather than a coin toss: `src/i18n.ts` sets
 * both `lng` and `fallbackLng` to "bg", so "no answer yet" and "Bulgarian" are
 * the same state everywhere else in the app too.
 */
export const isBrandCyrillic = (lang?: string): boolean =>
  !lang || lang.startsWith("bg");

/** Both halves for the active locale. `lang` is anything i18n hands back. */
export const brandWordmark = (lang?: string) =>
  isBrandCyrillic(lang) ? BRAND_WORDMARK : BRAND_WORDMARK_LATIN;

export const brandMonogram = (lang?: string) =>
  isBrandCyrillic(lang) ? BRAND_MONOGRAM : BRAND_MONOGRAM_LATIN;

/** The full name for the active locale — Cyrillic in BG, Latin elsewhere. */
export const brandName = (lang?: string) =>
  isBrandCyrillic(lang) ? BRAND_NAME : BRAND_NAME_LATIN;

/** The document-title suffix for the active locale. */
export const brandTitleSuffix = (lang?: string) =>
  isBrandCyrillic(lang) ? BRAND_TITLE_SUFFIX : BRAND_TITLE_SUFFIX_EN;
