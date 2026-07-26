// The /officials/<slug> -> /person/<slug> 301 (T1.1) — URL parsing and the not-found body.
// Plan: docs/plans/persons-pg-retirement-v1.md.
//
// Its own module rather than a helper inside index.js for two reasons: requiring index.js
// from a test would run defineSecret + makeDb at import time, and every export of the
// functions entry point is something the deploy CLI inspects. vite/db-api.ts imports it too,
// so the dev server and the Cloud Function decide identically.
//
// The SQL side is officials_person_slug() in 106_officials_redirect.sql — that is where the
// "why not a firebase.json redirect rule" argument lives.

/** officialSlug()'s mint format: a latin kebab stem plus a 6-hex disambiguator. The same
 *  shape 103's backfill and scripts/person/load_slug_redirects.ts test against. Exported so
 *  the corpus test can assert the live refs still match it. */
const OFFICIALS_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*-[0-9a-f]{6}$/;

/** The body served when an /officials URL resolves to nobody. HTML, not JSON: this is a
 *  page URL reached by a reader following a stale link or an old search result, and the
 *  API's `{"error":…}` shape would render as raw text in their browser. Deliberately tiny
 *  and self-contained — it is served by a Cloud Function with no access to the SPA shell. */
const NOT_FOUND_HTML = `<!doctype html>
<html lang="bg"><head><meta charset="utf-8">
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Профилът не е намерен | Наясно</title></head>
<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem">
<h1>Профилът не е намерен</h1>
<p>Страниците на длъжностните лица вече са част от общия профил на човек.
Този адрес не съответства на никого.</p>
<p><a href="/officials/assets">Класация по декларирани активи</a> ·
<a href="/">Начало</a></p>
<hr>
<p lang="en">This profile page has moved into the unified person profile, and this address
does not match anyone. <a href="/officials/assets">Asset ranking</a> · <a href="/">Home</a></p>
</body></html>`;

/**
 * Decide whether the `db` function should handle a request as an /officials page.
 *
 * @param {string|null|undefined} path request path, e.g. "/officials/ivan-petrov-a1b2c3"
 * @returns {{prefix: string, slug: string|null}|null}
 *   - `null` — not an /officials page at all (or `/officials/assets`); the caller falls
 *     through to the /api/db JSON routes.
 *   - `{prefix, slug}` — an /officials page. `prefix` is "" or "/en" so the redirect keeps
 *     the reader in the language they were reading. `slug` is null when the path is under
 *     /officials but is not a valid profile URL — a garbled slug, a nested path, the bare
 *     section. Those must NOT fall through to the JSON routes: once the hosting rewrite is
 *     in place nothing else can serve them, and `{"error":"unknown db route"}` is a bad
 *     answer for a browser. The caller 404s them with the HTML body above.
 *
 * `assets` is excluded here AND routed ahead of the wildcard in firebase.json. Two guards
 * because they fail differently: a later edit can reorder the hosting rules, and this one
 * cannot see that happen. /officials/assets is a real page — turning the leaderboard into a
 * 404 would be a worse regression than the one the redirect fixes.
 */
const officialsPath = (path) => {
  const parts = String(path || "")
    .split("/")
    .filter(Boolean);
  const prefix = parts[0] === "en" ? "/en" : "";
  const rest = prefix ? parts.slice(1) : parts;
  if (!rest.length || rest[0] !== "officials") return null;
  // The leaderboard and anything nested under it stay with the SPA.
  if (rest[1] === "assets") return null;
  if (rest.length !== 2) return { prefix, slug: null };
  const slug = rest[1];
  return { prefix, slug: OFFICIALS_SLUG.test(slug) ? slug : null };
};

/**
 * Serve one /officials request: 301 to the person page, or 404 with the body above.
 *
 * Lives here, not inline in index.js, so it can be tested against a fake req/res without
 * importing the functions entry point (which would run defineSecret + makeDb). The branch
 * ORDER is the thing worth pinning — this must run ahead of the /api/db origin, method and
 * rate-limit gates, every one of which is wrong for a browser navigation.
 *
 * @param {{path?: string, originalUrl?: string}} req
 * @param {object} res express-style response
 * @param {(slug: string) => Promise<string|null>} resolve slug -> target person slug
 * @returns {Promise<boolean>} true when this request was handled; false when the caller
 *   should fall through to the /api/db routes.
 */
const handleOfficialsRequest = async (req, res, resolve) => {
  const hit = officialsPath(req.path || "");
  if (!hit) return false;

  // NOTE: the Cache-Control set here is currently DISCARDED in production — firebase.json's
  // `**` header rule (`no-cache, max-age=0, must-revalidate`) wins over function-set
  // headers. The hosting header rule that makes these effective lands with the
  // `/officials/*` rewrite, so the two arrive together; the dev server (no hosting layer)
  // already honours them.
  res.set("Cache-Control", "public, max-age=300, s-maxage=3600");

  const notFound = () =>
    res.status(404).type("text/html; charset=utf-8").send(NOT_FOUND_HTML);

  if (!hit.slug) {
    notFound();
    return true;
  }
  const target = await resolve(hit.slug);
  if (!target) {
    // Honest 404. Redirecting an unresolvable slug to /officials/assets or /person would be
    // a soft-404 — a 200 for a URL that has no content — which is worse for both the reader
    // and the index than saying it is gone.
    notFound();
    return true;
  }
  // The query string is carried over: ?utm_source=… must not lose its attribution, and
  // ?elections=… is real cross-page state (the URL contract in CLAUDE.md) that /person reads.
  const url = req.originalUrl || "";
  const q = url.indexOf("?");
  const qs = q >= 0 ? url.slice(q) : "";
  // 301, not 302: the move is permanent by design (Decision 1 retires
  // OfficialProfileScreen), and a 302 would keep the old URL in the index.
  res.redirect(301, `${hit.prefix}/person/${target}${qs}`);
  return true;
};

module.exports = {
  officialsPath,
  handleOfficialsRequest,
  OFFICIALS_SLUG,
  NOT_FOUND_HTML,
};
