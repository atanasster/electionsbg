// Build-time enumeration of the /court/:bodyCode pages for the SEO prerender +
// sitemap, read straight from Postgres.
//
// `judicial_body` lives ONLY in Postgres — there is no committed shard behind it
// — so this follows seo_settlements.ts exactly: one query, shared by the
// prerender builder AND the sitemap enumerator, degrading to [] on any failure
// via the common readSeoRows() envelope.
//
// WHAT SHARING THE READER DOES AND DOES NOT BUY. One query in one place means
// the two callers cannot drift in what they select or how they filter it. They
// still RUN it independently, in separate processes at separate times (`npm run
// sitemap` vs the build), so a database that is up for one and down for the
// other can still leave the sitemap naming pages the prerender never wrote. The
// shared degrade-to-[] contract narrows that window — both callers fail the same
// way — it does not close it.
//
// NO COMMITTED MANIFEST, deliberately. /person/** mints
// data/person/prerender_slugs.json from the SERVING database because
// `person_slug_lock` accumulates per database, so two databases hand the same
// people different slugs. `judicial_body.body_code` is derived deterministically
// by db:load:judicial-bodies:pg from `magistrate.court ∪ court_load.name`, so
// local and cloud agree and a local mint is safe. Do not copy the person
// machinery here.

import { isCrawlableSlug } from "@/lib/urlSlug";
import { readSeoRows } from "./seo_read";

export type SeoCourt = {
  bodyCode: string;
  name: string;
  kind: string;
  tier: string | null;
  place: string | null;
  /** The seat in English, for the EN page. Null only if `place_dim` has no row
   *  for this obshtina — all 279 resolve today. */
  placeEn: string | null;
  placeCode: string | null;
  /** Magistrates declaring to the ИВСС from this body, CURRENT BENCH ONLY —
   *  the same basis judicial_body_detail() serves. See the QUERY's mags CTE. */
  magistrates: number;
  /** Latest published court_load year, when the ВСС publishes one for it. */
  year: number | null;
  judges: number | null;
  filedPerMonth: number | null;
  resolvedPerMonth: number | null;
  /** Span of the published workload series — the "since X" in the prose. */
  firstYear: number | null;
  lastYear: number | null;
  /**
   * Mirrors judicial_body_detail()'s flag of the same name, and carries the
   * same warning: it separates "the ВСС publishes no workload for this body"
   * (true, `year` null — 99 of the 279 bodies) from "the workload bridge was
   * never loaded on this database" (false). The two are shape-identical in the
   * rows, so prerendered prose that ignores it would assert, in static HTML on
   * every page, that the ВСС publishes no workload for Софийски градски съд.
   *
   * Stricter than the SQL function's version by one term: that one only checks
   * judicial_body_source_name, while a build also needs court_load itself to
   * carry rows. Applying 116 with apply_functions.ts creates the bridge empty;
   * a fresh clone has no court_load at all. Both mean "not loaded here".
   */
  sourcesBuilt: boolean;
};

/**
 * The crawlable gate — exported once and used by BOTH the prerender builder and
 * the sitemap enumerator. It is trivially true today (all 279 body_codes are
 * lowercase ASCII slugs, verified), but a gate that lives in two copies is how a
 * sitemap grows <loc>s with no file behind them, so it exists as one named
 * export rather than as an inline regex on each side.
 */
export const isCrawlableCourt = (b: { bodyCode?: string | null }): boolean =>
  isCrawlableSlug(b.bodyCode);

type Row = {
  body_code: string;
  name: string;
  kind: string;
  tier: string | null;
  place: string | null;
  place_en: string | null;
  place_code: string | null;
  magistrates: number;
  first_year: number | null;
  last_year: number | null;
  year: number | null;
  judges: number | null;
  filed_per_month: number | null;
  resolved_per_month: number | null;
  sources_built: boolean;
};

// `filed_per_month` / `resolved_per_month` are PG numeric, which node-postgres
// serializes as a STRING — cast to float8 in SQL so the builder formats a number
// rather than interpolating "5.68" verbatim and silently losing toFixed().
const QUERY = `
  WITH src AS (SELECT body_code, source_name FROM judicial_body_source_name),
  -- CURRENT BENCH ONLY — magistrate_current (070), the same view judicial_body_detail()
  -- and judicial_body_index() read, so this build-time reader cannot diverge from the
  -- page it prerenders. The reason is sharper here than in either: this number is
  -- written into STATIC HTML as an undated present-tense sentence ("N магистрати с
  -- декларации от този орган") and as schema.org numberOfEmployees. Against the raw
  -- table it absorbs the retained half — 122 of the 279 bodies over-counted, one by 23
  -- — and prerendered prose cannot be corrected by a reload the way a served payload
  -- can, since the next build is the only fix.
  mags AS (
    SELECT s.body_code, count(*)::int AS n
    FROM src s JOIN magistrate_current m ON m.court = s.source_name
    GROUP BY s.body_code
  ),
  yrs AS (
    SELECT s.body_code, min(c.year)::int AS first_year, max(c.year)::int AS last_year
    FROM src s JOIN court_load c ON c.name = s.source_name
    GROUP BY s.body_code
  ),
  -- Same tie-break as judicial_body_detail(): 28 administrative courts fold two
  -- court_load spellings onto one body, so prefer the better-staffed filing.
  -- KEEP THIS ORDER YEAR-FIRST. \`year\` below is this row's vintage and
  -- \`last_year\` is max(year) over the same set; they are equal only because of
  -- the leading \`c.year DESC\`. Re-ordering to prefer, say, the fuller filing
  -- across years desynchronises the two in a payload where nothing checks.
  latest AS (
    SELECT DISTINCT ON (s.body_code)
           s.body_code, c.year, c.judges,
           c.filed_per_month::float8    AS filed_per_month,
           c.resolved_per_month::float8 AS resolved_per_month
    FROM src s JOIN court_load c ON c.name = s.source_name
    ORDER BY s.body_code, c.year DESC, c.judges DESC NULLS LAST, c.name COLLATE "C"
  )
  SELECT b.body_code, b.name, b.kind, b.tier, b.place, b.place_code,
         -- The trailing qualifier is stripped because judicial_body.place is the
         -- seat SETTLEMENT ("София") while place_dim is the OBSHTINA ("Столична
         -- община" / "Sofia (capital municipality)"). The two coincide for every
         -- seat but one: without this, the 23 Sofia-seated bodies would read
         -- "seated in Sofia (capital municipality)" on the EN page against "със
         -- седалище в София" on the BG one.
         regexp_replace(pd.name_en, '\\s*\\([^)]*\\)$', '') AS place_en,
         COALESCE(m.n, 0) AS magistrates,
         y.first_year, y.last_year,
         l.year, l.judges, l.filed_per_month, l.resolved_per_month,
         EXISTS (SELECT 1 FROM latest) AS sources_built
  FROM judicial_body b
  LEFT JOIN mags   m ON m.body_code = b.body_code
  LEFT JOIN yrs    y ON y.body_code = b.body_code
  LEFT JOIN latest l ON l.body_code = b.body_code
  -- The English seat name for the EN page. \`place_dim.code\` is UNIQUE ONLY
  -- WITHIN A KIND (VAR is both an oblast and an obshtina), so the kind
  -- predicate is what keeps this a 1:1 join instead of doubling 28 rows.
  -- judicial_body.place_code is an obshtina code for all 279.
  LEFT JOIN place_dim pd ON pd.code = b.place_code AND pd.kind = 'obshtina'
  -- COLLATE "C" so the enumeration order is the same on every server regardless
  -- of its default collation (which ignores the hyphen at the primary level and
  -- interleaves \`aps-burgas\` between \`ap-plovdiv\` and \`ap-sofiya\`).
  ORDER BY b.body_code COLLATE "C"
`;

/**
 * Every judicial body that has a servable `/court/:bodyCode` page, ordered by
 * `body_code`.
 *
 * @returns One entry per crawlable row in `judicial_body` (279 today; 180 carry
 *   a `court_load` year, 99 do not). **Never throws** — returns `[]` and warns
 *   on any failure, so a build without Postgres omits the family instead of
 *   aborting. An empty result therefore means *either* no database *or* a failed
 *   query; `scripts/db/tests/seo_courts.data.test.ts` is the gate that tells
 *   them apart on a machine that has one.
 */
export const readSeoCourts = async (): Promise<SeoCourt[]> => {
  const rows = await readSeoRows<Row>("/court/*", QUERY);
  const kept = rows.filter(isCrawlableRow);
  if (kept.length !== rows.length) {
    // The gate drops 0 of 279 today, which means it only ever DOES anything on
    // the day something upstream changes — exactly the day to be told. A body
    // silently missing from both the prerender and the sitemap is invisible in a
    // green build; the count difference is not something anyone reads.
    const dropped = rows
      .filter((r) => !isCrawlableRow(r))
      .map((r) => r.body_code);
    console.warn(
      `[seo] judicial bodies: ${rows.length - kept.length} of ${rows.length} row(s) ` +
        `have no URL-safe body_code and were skipped: ${dropped.slice(0, 10).join(", ")}`,
    );
  }
  return kept.map((r) => ({
    bodyCode: r.body_code,
    name: r.name,
    kind: r.kind,
    tier: r.tier,
    place: r.place,
    placeEn: r.place_en,
    placeCode: r.place_code,
    magistrates: r.magistrates ?? 0,
    year: r.year,
    judges: r.judges,
    filedPerMonth: r.filed_per_month,
    resolvedPerMonth: r.resolved_per_month,
    firstYear: r.first_year,
    lastYear: r.last_year,
    sourcesBuilt: r.sources_built === true,
  }));
};

const isCrawlableRow = (r: Row): boolean =>
  Boolean(r.name) && isCrawlableCourt({ bodyCode: r.body_code });
