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

/**
 * Decide whether the `db` function should handle a request as a /person page.
 *
 * @param {string|null|undefined} path request path, e.g. "/person/ivan-petrov-a1b2c3"
 * @returns {{prefix: string, slug: string|null}|null}
 *   - `null` — not a /person page; the caller falls through to everything else.
 *   - `{prefix, slug}` — a /person page. `prefix` is "" or "/en" so a redirect keeps the
 *     reader in the language they were reading. `slug` is null only when there is nothing
 *     to look up (a nested path, the bare section, an undecodable segment); those are
 *     served the shell rather than redirected or 404'd.
 *
 * NO SHAPE TEST, deliberately. This used to pre-filter on a `kebab + 6-char base36 [+ -N]`
 * pattern, and the pattern was simply not a description of the slug space: the `mp-<id>[-n]`
 * family carries no disambiguator at all. Measured 2026-08-08 against local Postgres — the
 * pattern rejected 14 of 23,916 retired slugs, every one of them with a dead source and a
 * live servable target, i.e. 14 URLs that should 301 and instead served the shell and
 * noindexed themselves. That is the exact defect this module exists to remove, so the
 * pre-filter was buying a skipped database probe at the price of a wrong answer.
 *
 * person_slug_retired's PK is the only authority on what is retired. A pattern can only ever
 * be a SECOND definition of the slug space, and this one had already drifted from the minter
 * (2,205 live servable slugs also failed it). The cost of asking the database instead is one
 * indexed PK probe, memoised per instance in index.js. A percent-encoded legacy name link
 * (/person/<cyrillic name>, still honoured by PersonProfileScreen) simply misses the index
 * and falls through to the shell, exactly as it did when the pattern rejected it.
 */
const personPath = (path) => {
  const parts = String(path || "")
    .split("/")
    .filter(Boolean);
  const prefix = parts[0] === "en" ? "/en" : "";
  const rest = prefix ? parts.slice(1) : parts;
  if (!rest.length || rest[0] !== "person") return null;
  if (rest.length !== 2) return { prefix, slug: null };
  try {
    // The stored slug is decoded text; a URL carrying %D0%98… must be compared in the same
    // form. Malformed encoding cannot be any slug, so it takes the shell.
    return { prefix, slug: decodeURIComponent(rest[1]) };
  } catch {
    return { prefix, slug: null };
  }
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
  // Resolve the shell BEFORE touching the response. If loadShell rejects, the caller's catch
  // must find a response it has not started answering with, so it can serve FALLBACK_SHELL.
  const shell = await loadShell();
  res.status(200).type("text/html; charset=utf-8").send(shell);
  return true;
};

/** A retired person slug -> the slug that replaced it, or null. Two indexed lookups against
 *  unique indexes (person_slug_retired_pkey, person_slug_key).
 *
 *  THIS DUPLICATES person_slug_redirect() (103), ON PURPOSE, and the earlier claim here that
 *  a serving function "would be new" was simply wrong — 103 has shipped one since the table
 *  existed. What it does not have is 082's real servability rule: 103 gates the target on
 *  `is_public_figure` alone, this gates on `status='active' AND (is_public_figure OR
 *  identity_confidence='verified')`, which is what person_by_slug() actually serves. 103 is
 *  also called by officials_person_slug() (106), so widening it there changes the live
 *  officials 301 as well — a deliberate decision, not a cleanup, and not one to make from
 *  inside this module. The other difference runs the other way: 103 FOLLOWS the chain
 *  (depth <= 8) and this takes one hop, which is safe only because collapseSlugRedirectChains()
 *  flattens the table on write. Measured 2026-08-08 over all 23,916 rows: 0 chained rows and
 *  0 disagreements between the two. person_slug_redirect.data.test.ts holds that at 0, so the
 *  divergence stays measured rather than assumed.
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
  RETIRED_TARGET_SQL,
};
