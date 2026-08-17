// Build-time enumeration of the /council/:code pages for the SEO prerender +
// sitemap, read straight from Postgres.
//
// The council corpus lives ONLY in Postgres (migrations 160/161) — the JSON tree
// under data/council/ is the LOADER'S INPUT, not a serving artifact, and it is
// capped and stripped besides. So this follows seo_courts.ts exactly: one query,
// shared by the prerender builder AND the sitemap enumerator, degrading to []
// on any failure via the common readSeoRows() envelope.
//
// ⚠️ THE PAGE URL IS THE FRONTEND CODE, NOT THE COUNCIL KEY. `council_muni_code`
// is a many-to-one bridge and three council keys (BGS01, PDV01, VAR01) are also
// OTHER municipalities' frontend codes — so enumerating `council_muni` directly
// would emit /council/BGS01, a URL that resolves to nothing and which a reader
// in Айтос would reasonably expect to be theirs. One row per COUNCIL, carrying
// the canonical frontend code the serving function actually accepts.
//
// NO COMMITTED MANIFEST, deliberately — same reasoning as seo_courts.ts. The
// codes are derived deterministically by db:load:council:pg from the committed
// municipalities list, so local and cloud agree and a local mint is safe.

import { readSeoRows } from "./seo_read";

export type SeoCouncil = {
  /** The URL segment: a frontend obshtina code (BGS04, SFO_CITY, PER32…). */
  code: string;
  /** The council's own key (BGS01, SOF) — for logs and cross-referencing only. */
  councilCode: string;
  name: string;
  resolutions: number;
  hasNamedVotes: boolean;
  namedVotes: number;
  /** Newest decision, and newest decision carrying named votes. The second lags
   *  the first wherever a council has stopped publishing them. */
  newestDecidedOn: string | null;
  newestNamedOn: string | null;
};

type Row = {
  code: string | null;
  council_code: string;
  name: string;
  resolutions: string | number | null;
  has_named_votes: boolean;
  named_votes: string | number | null;
  newest_decided_on: string | null;
  newest_named_on: string | null;
};

// Prefer a non-S2 frontend code so Sofia enumerates as SFO_CITY rather than an
// arbitrary район — the same ordering council_overview() uses, so the hub's
// links and the prerendered URLs cannot disagree.
const QUERY = `
  SELECT (
           SELECT c.frontend_code FROM council_muni_code c
            WHERE c.obshtina_code = m.obshtina_code
            ORDER BY (c.frontend_code LIKE 'S2%'), c.frontend_code
            LIMIT 1
         )                                        AS code,
         m.obshtina_code                          AS council_code,
         m.name                                   AS name,
         m.resolution_count                       AS resolutions,
         m.has_named_votes                        AS has_named_votes,
         m.named_vote_count                       AS named_votes,
         max(r.decided_on)::text                  AS newest_decided_on,
         max(r.decided_on) FILTER (WHERE r.has_named_votes)::text
                                                  AS newest_named_on
    FROM council_muni m
    LEFT JOIN council_resolution r ON r.obshtina_code = m.obshtina_code
   GROUP BY m.obshtina_code, m.name, m.resolution_count,
            m.has_named_votes, m.named_vote_count
   ORDER BY m.resolution_count DESC, m.obshtina_code
`;

/**
 * @returns One entry per council reachable at a /council/:code URL (16 today).
 *   **Never throws** — returns `[]` and warns on any failure, so a build without
 *   Postgres omits the family instead of aborting. An empty result therefore
 *   means *either* no database *or* a failed query.
 */
export const readSeoCouncils = async (): Promise<SeoCouncil[]> => {
  const rows = await readSeoRows<Row>("/council/*", QUERY);
  const kept = rows.filter((r) => !!r.code);
  if (kept.length !== rows.length) {
    // A council with no bridge row cannot be linked OR prerendered, and it is
    // invisible in a green build. Drops 0 of 16 today, which means this only
    // ever fires on the day something upstream changes — exactly the day to be
    // told.
    console.warn(
      `[seo] councils: ${rows.length - kept.length} of ${rows.length} have no ` +
        `frontend code and were skipped: ` +
        rows
          .filter((r) => !r.code)
          .map((r) => r.council_code)
          .join(", "),
    );
  }
  return kept.map((r) => ({
    code: r.code as string,
    councilCode: r.council_code,
    name: r.name,
    resolutions: Number(r.resolutions ?? 0),
    hasNamedVotes: r.has_named_votes === true,
    namedVotes: Number(r.named_votes ?? 0),
    newestDecidedOn: r.newest_decided_on,
    newestNamedOn: r.newest_named_on,
  }));
};
