/**
 * The site's canonical origin — scheme + host, no trailing slash.
 *
 * ONE definition. Every canonical, `og:url`, `hreflang`, sitemap `<loc>`,
 * JSON-LD `@id`, `llms.txt` link and prerendered `href` derives from this, so
 * the Наясно domain migration is a one-line edit here plus a rebuild rather
 * than a sweep across a dozen files that must not disagree.
 *
 * Before this existed the string was typed out in eleven places across
 * `scripts/`, `src/`, `ai/` and `functions/`, plus `index.html`, `robots.txt`
 * and two CORS configs. Nothing checked that they agreed, and a partial change
 * is the worst possible state: some pages declare one canonical, some another,
 * and Google resolves the disagreement itself.
 *
 * ## Deliberately NOT an environment variable
 *
 * An env override buys nothing here. The origin is baked into ~248k prerendered
 * files at build time, so switching it requires a full rebuild and redeploy
 * either way — an env var makes neither the flip nor the rollback faster than
 * editing this line, and it would add a second source of truth that
 * `siteOrigin.test.ts` could not check. See `docs/plans/naiasno-rebrand-v1.md`
 * §3.
 *
 * ## The copies this cannot reach
 *
 * `functions/` is a separate deploy package and cannot import from `src/`;
 * `index.html`, `public/robots.txt` and the CORS configs are static. Those keep
 * their own copies, and `scripts/lib/siteOrigin.test.ts` fails when any of them
 * disagrees with this constant. That gate is what makes the migration
 * verifiable — change this line, run the test, and it names every file still
 * carrying the old origin.
 *
 * ## The trailing-slash contract this does NOT encode
 *
 * Hosting runs `trailingSlash: false`, so every URL is the no-slash form —
 * except the two roots, which invert: the BG root keeps its slash
 * (`${SITE_ORIGIN}/`) while the EN root does NOT (`${SITE_ORIGIN}/en`, never
 * `/en/`). That asymmetry lives at the call sites, not here; see
 * `CLAUDE.md` and `tests/seo.spec.ts`.
 */
export const SITE_ORIGIN = "https://electionsbg.com";
