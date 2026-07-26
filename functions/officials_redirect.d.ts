// Types for the CJS /officials URL parser (officials_redirect.js), so the dev Vite plugin
// (vite/db-api.ts) can import it type-safely. Runtime is plain JS shared with the Cloud
// Function — the same arrangement as db_table.d.ts / db_routes.d.ts.

export interface OfficialsUrl {
  /** "" or "/en" — keeps the redirect in the language the reader was reading. */
  prefix: string;
  /** The officials slug to look up, or null when the path is under /officials but is not a
   *  valid profile URL (garbled slug, nested path, bare section). Null means 404, never
   *  "fall through". */
  slug: string | null;
}

/** Returns null when the path is not an /officials page — including `/officials/assets`,
 *  which is a real page and must fall through to the SPA. */
export declare const officialsPath: (
  path: string | null | undefined,
) => OfficialsUrl | null;

/** officialSlug()'s mint format: latin kebab stem + 6-hex disambiguator. */
export declare const OFFICIALS_SLUG: RegExp;

/** Self-contained HTML body for an /officials URL that resolves to nobody. */
export declare const NOT_FOUND_HTML: string;
