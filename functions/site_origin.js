/**
 * The site's canonical origin, for the `functions/` package.
 *
 * ⚠️ This is a SECOND copy of `src/lib/siteOrigin.ts`, and it has to be:
 * `functions/` is deployed to Cloud Functions as its own npm package with its
 * own `package.json`, so it cannot import from `src/`. Bundling the whole app
 * source into the function deploy to avoid one string is a bad trade.
 *
 * The two are kept honest by `scripts/lib/siteOrigin.test.ts`, which reads this
 * file and fails when it disagrees with the TypeScript constant. Change one,
 * the test names the other.
 *
 * What reads it: `spa_page.js` (the head tags for the ~256k function-served
 * `/funds/contract`, `/funds/interreg` and `/company` pages, plus the
 * non-prerendered `/person` URLs) and `index.js` (the OpenRouter
 * `HTTP-Referer`, and the origin the SPA shell is fetched from).
 */
const SITE_ORIGIN = "https://electionsbg.com";

module.exports = { SITE_ORIGIN };
