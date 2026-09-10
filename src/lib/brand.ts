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
