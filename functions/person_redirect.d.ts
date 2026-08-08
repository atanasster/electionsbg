// Types for the CJS /person URL parser (person_redirect.js), so the dev Vite plugin
// (vite/db-api.ts) can import it type-safely. Runtime is plain JS shared with the Cloud
// Function — the same arrangement as officials_redirect.d.ts.

export interface PersonUrl {
  /** "" or "/en" — keeps the redirect in the language the reader was reading. */
  prefix: string;
  /** The decoded person slug to look up, or null when there is nothing to look up (a nested
   *  path, the bare section, an undecodable segment). Null means "serve the shell" — never a
   *  404, and never a fall-through. There is no shape test: the database is the authority on
   *  what is retired (see the note on personPath). */
  slug: string | null;
}

/** Returns null when the path is not a /person page. */
export declare const personPath: (
  path: string | null | undefined,
) => PersonUrl | null;

/** Retired slug -> live target, re-applying 082 person_by_slug()'s servability predicate so
 *  a 301 can never land on a page that renders the noindex fallback. One bind param: the
 *  retired slug. */
export declare const RETIRED_TARGET_SQL: string;

/** Serve one /person request: 301 to the current slug, or hand back the SPA shell. Returns
 *  false only when the path is not a /person URL. */
export declare const handlePersonRequest: (
  req: { path?: string; originalUrl?: string },
  res: unknown,
  deps: {
    resolve: (slug: string) => Promise<string | null>;
    loadShell: () => Promise<string>;
  },
) => Promise<boolean>;
