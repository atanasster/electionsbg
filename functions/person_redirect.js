// The /person/<retired-slug> -> /person/<current-slug> 301.
//
// Sibling of officials_redirect.js, and deliberately the same shape — its own module so a
// test can exercise it against a fake req/res without importing the functions entry point
// (which would run defineSecret + makeDb at import time), and so vite/db-api.ts can mount
// the identical parser in the dev server.
//
// WHY THIS EXISTS. `person_slug_retired` (103) records every slug a re-resolve retired,
// already flattened to a live target by collapseSlugRedirectChains(). Nothing served that
// map: `/person/**` had no hosting rewrite, so a retired URL fell through `**` to
// /index.html and returned 200 with the HOMEPAGE's <title> and canonical, after which the
// SPA rendered the name-keyed portfolio fallback — which calls useNoindex(). Measured
// 2026-08-07: 23,916 retired slugs, every one of them with a live, servable target, all
// serving that page; Google reported 9,752 URLs "Excluded by 'noindex' tag".
//
// A firebase.json redirect rule cannot do this for the same reason 106 gives for officials:
// the pairs are data, not a pattern, and 23,916 of them is 20x Firebase's per-site limit.
//
// WHAT THIS OWNS. Once the `/person/*` rewrite is in place this function is the ONLY thing
// that can answer a non-prerendered person URL, so it must not return false for one — a
// fall-through would reach the /api/db JSON routes and answer a browser navigation with
// {"error":"unknown db route"}. Anything it does not redirect it serves as the SPA shell,
// byte-for-byte what hosting served before the rewrite existed.
//
// PRERENDERED PAGES NEVER REACH IT. Firebase Hosting ranks exact-match static content ABOVE
// rewrites, so the 25,167 prerendered `dist/person/<slug>/index.html` pages are served
// statically and this branch only ever sees the rest. The site already proves that ordering:
// `**` -> /index.html is the last rewrite in firebase.json and every prerendered page still
// serves its own <title> rather than the shell's.

/** The mint format of a person slug: a latin kebab stem, a 6-char base36 disambiguator, and
 *  optionally a `-N` collision suffix (petko-petkov-17j32b-2). Base36, NOT hex — the officials
 *  minter used hex, this one does not, and `[0-9a-f]` would silently pass over every slug
 *  carrying g-z (georgi-lazarov-jqfasq). Deliberately a SHAPE test only: a slug that looks
 *  right but matches nothing simply falls through to the shell, so the cost of being wrong
 *  here is a skipped lookup, never a wrong answer. Legacy name-keyed links
 *  (/person/<cyrillic name>, still honoured by PersonProfileScreen) fail it and keep working. */
const PERSON_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*-[0-9a-z]{6}(-\d+)?$/;

/**
 * Decide whether the `db` function should handle a request as a /person page.
 *
 * @param {string|null|undefined} path request path, e.g. "/person/ivan-petrov-a1b2c3"
 * @returns {{prefix: string, slug: string|null}|null}
 *   - `null` — not a /person page; the caller falls through to everything else.
 *   - `{prefix, slug}` — a /person page. `prefix` is "" or "/en" so a redirect keeps the
 *     reader in the language they were reading. `slug` is null when the path is under
 *     /person but is not slug-shaped (a legacy name link, a nested path, the bare section);
 *     those are served the shell rather than redirected or 404'd.
 */
const personPath = (path) => {
  const parts = String(path || "")
    .split("/")
    .filter(Boolean);
  const prefix = parts[0] === "en" ? "/en" : "";
  const rest = prefix ? parts.slice(1) : parts;
  if (!rest.length || rest[0] !== "person") return null;
  if (rest.length !== 2) return { prefix, slug: null };
  const slug = rest[1];
  return { prefix, slug: PERSON_SLUG.test(slug) ? slug : null };
};

/**
 * Serve one /person request: 301 to the current slug, or hand back the SPA shell.
 *
 * @param {{path?: string, originalUrl?: string}} req
 * @param {object} res express-style response
 * @param {{resolve: (slug: string) => Promise<string|null>, loadShell: () => Promise<string>}} deps
 *   `resolve` maps a retired slug to its live target (null = not retired). `loadShell`
 *   returns the SPA shell HTML and must not reject — the caller owns the fallback.
 * @returns {Promise<boolean>} true when handled; false when this is not a /person URL.
 */
const handlePersonRequest = async (req, res, { resolve, loadShell }) => {
  const hit = personPath(req.path || "");
  if (!hit) return false;

  // Hosting's blanket `**` header rule would clobber a function-set Cache-Control on any
  // path with no more specific entry, so firebase.json carries a `/person/**` entry whose
  // only job is to stop that — the value that actually ships is this line. Same mechanism
  // as /officials/*, documented at length in officials_redirect.js.
  res.set("Cache-Control", "public, max-age=300, s-maxage=3600");

  if (hit.slug) {
    const target = await resolve(hit.slug);
    // 301, not 302: a re-slug is permanent, and a 302 would keep the retired URL in the
    // index — which is the whole point of serving this.
    if (target) {
      const url = req.originalUrl || "";
      const q = url.indexOf("?");
      const qs = q >= 0 ? url.slice(q) : "";
      res.redirect(301, `${hit.prefix}/person/${target}${qs}`);
      return true;
    }
  }

  // Not retired, or not slug-shaped. Serve the shell — the SAME 200 hosting served before
  // this rewrite existed. Deliberately NOT a 404: ~100k people are servable but not
  // prerendered (25,167 of 126,004 have a static page), and 404ing them to tidy up the
  // handful of genuinely dead slugs would take out every one of those working pages.
  res
    .status(200)
    .type("text/html; charset=utf-8")
    .send(await loadShell());
  return true;
};

/** A retired person slug -> the slug that replaced it, or null. Two indexed lookups against
 *  unique indexes (person_slug_retired_pkey, person_slug_key).
 *
 *  NEITHER predicate is decoration, and they guard opposite ends:
 *
 *  The JOIN re-applies 082 person_by_slug()'s OWN servability rule to the TARGET, so a 301
 *  can never land on a page that renders the noindex fallback — one bad URL becoming a
 *  redirect to a bad URL. Measured 2026-08-07: all 23,916 targets pass, so today it filters
 *  nothing; it is here for the re-resolve that retires somebody into a person later marked
 *  private or inactive.
 *
 *  The NOT EXISTS guards the SOURCE: never redirect away from a slug that still serves a
 *  person. Being in person_slug_retired is not proof a slug is dead — the retired map and
 *  the person table are written by different runs, and slug locks accumulate PER DATABASE,
 *  so the two can disagree. Measured the same day, and this is the reason the clause exists:
 *  10 slugs the LOCAL database lists as retired resolve to live, prerendered, fully servable
 *  people on prod. Static hosting happens to shadow those particular URLs, but relying on
 *  that would make the redirect correct by luck. The rule this encodes is the honest one —
 *  redirect a slug only when it no longer resolves on the SAME database being asked. */
const RETIRED_TARGET_SQL = `
  SELECT r.target_slug AS slug
    FROM person_slug_retired r
    JOIN person p ON p.slug = r.target_slug
   WHERE r.slug = $1
     AND p.status = 'active'
     AND (p.is_public_figure OR p.identity_confidence = 'verified')
     AND NOT EXISTS (
       SELECT 1 FROM person old
        WHERE old.slug = r.slug
          AND old.status = 'active'
          AND (old.is_public_figure OR old.identity_confidence = 'verified')
     )`;

module.exports = {
  personPath,
  handlePersonRequest,
  PERSON_SLUG,
  RETIRED_TARGET_SQL,
};
