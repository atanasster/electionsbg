// Types for the CJS /person URL parser (person_redirect.js), so the dev Vite plugin
// (vite/db-api.ts) can import it type-safely. Runtime is plain JS shared with the Cloud
// Function — the same arrangement as officials_redirect.d.ts.

export interface PersonUrl {
  /** "" or "/en" — keeps the redirect in the language the reader was reading. */
  prefix: string;
  /** The person slug to look up, or null when the path is under /person but is not
   *  slug-shaped (a legacy name link, a nested path, the bare section). Null means "serve
   *  the shell" — never a 404, and never a fall-through. */
  slug: string | null;
}

/** Returns null when the path is not a /person page. */
export declare const personPath: (
  path: string | null | undefined,
) => PersonUrl | null;

/** The mint format of a person slug: latin kebab stem + 6-char BASE36 disambiguator +
 *  optional `-N` collision suffix. Base36, not hex — see the note on the runtime const. */
export declare const PERSON_SLUG: RegExp;

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
