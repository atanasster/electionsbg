// The one predicate that decides whether a derived identifier may become a URL.
//
// Every prerendered page family mints `dist/<path>/index.html` and a matching
// sitemap `<loc>`, so an id that needs percent-encoding, contains a slash, or is
// empty produces a `<loc>` with no file behind it — the sitemap-validity defect
// this repo has hit before. Each family adds its OWN extra rule on top (a
// degenerate fund slug, a body_code that lost its lowercasing), but the
// path-safety half is the same everywhere and belongs in one place.

/** A slug safe both as a URL path segment and as a `dist/<path>/` directory
 *  name: lowercase ASCII, digits and internal hyphens, non-empty, no leading
 *  hyphen. Deliberately stricter than encodeURIComponent's idea of safe — the
 *  point is that no escaping is NEEDED, not that escaping is possible. */
export const isCrawlableSlug = (s: string | null | undefined): boolean =>
  typeof s === "string" && /^[a-z0-9][a-z0-9-]*$/.test(s);
