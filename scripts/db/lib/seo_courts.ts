// Build-time enumeration of the /court/:bodyCode pages for the SEO prerender +
// sitemap, read straight from Postgres.
//
// `judicial_body` lives ONLY in Postgres — there is no committed shard behind it
// — so this follows seo_settlements.ts exactly: one build-time query, shared by
// the prerender builder AND the sitemap enumerator, returning [] on ANY failure
// (Postgres unreachable, migration 116 not applied, court_load/magistrate
// absent). A Postgres-less build then emits neither the pages nor their <loc>
// entries, which is what keeps the sitemap-validity rule (every <loc> needs a
// real dist/<path>/index.html) true by construction: one source, not two.
//
// NO COMMITTED MANIFEST, deliberately. /person/** mints
// data/person/prerender_slugs.json from the SERVING database because
// `person_slug_lock` accumulates per database, so two databases hand the same
// people different slugs. `judicial_body.body_code` is derived deterministically
// by db:load:judicial-bodies:pg from `magistrate.court ∪ court_load.name`, so
// local and cloud agree and a local mint is safe. Do not copy the person
// machinery here.

import { Pool } from "pg";
import { DATABASE_URL } from "./pg";

export type SeoCourt = {
  bodyCode: string;
  name: string;
  kind: string;
  tier?: string | null;
  place?: string | null;
  placeCode?: string | null;
  /** Magistrates declaring to the ИВСС from this body. */
  magistrates: number;
  /** Latest published court_load year, when the ВСС publishes one for it. */
  year?: number | null;
  judges?: number | null;
  filedPerMonth?: number | null;
  resolvedPerMonth?: number | null;
  /** Span of the published workload series — the "since X" in the prose. */
  firstYear?: number | null;
  lastYear?: number | null;
  /**
   * Mirrors judicial_body_detail()'s flag of the same name, and carries the
   * same warning: it separates "the ВСС publishes no workload for this body"
   * (true, `year` null — 104 of the 284 bodies) from "the workload bridge was
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
 * the sitemap enumerator. It is trivially true today (all 284 body_codes are
 * lowercase ASCII slugs, verified), but a gate that lives in two copies is how a
 * sitemap grows <loc>s with no file behind them, so it exists as one named
 * export rather than as an inline regex on each side.
 */
export const isCrawlableCourt = (b: { bodyCode?: string | null }): boolean =>
  typeof b.bodyCode === "string" && /^[a-z0-9][a-z0-9-]*$/.test(b.bodyCode);

type Row = {
  body_code: string;
  name: string;
  kind: string;
  tier: string | null;
  place: string | null;
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
  mags AS (
    SELECT s.body_code, count(*)::int AS n
    FROM src s JOIN magistrate m ON m.court = s.source_name
    GROUP BY s.body_code
  ),
  yrs AS (
    SELECT s.body_code, min(c.year)::int AS first_year, max(c.year)::int AS last_year
    FROM src s JOIN court_load c ON c.name = s.source_name
    GROUP BY s.body_code
  ),
  -- Same tie-break as judicial_body_detail(): 28 administrative courts fold two
  -- court_load spellings onto one body, so prefer the better-staffed filing.
  latest AS (
    SELECT DISTINCT ON (s.body_code)
           s.body_code, c.year, c.judges,
           c.filed_per_month::float8    AS filed_per_month,
           c.resolved_per_month::float8 AS resolved_per_month
    FROM src s JOIN court_load c ON c.name = s.source_name
    ORDER BY s.body_code, c.year DESC, c.judges DESC NULLS LAST, c.name COLLATE "C"
  )
  SELECT b.body_code, b.name, b.kind, b.tier, b.place, b.place_code,
         COALESCE(m.n, 0) AS magistrates,
         y.first_year, y.last_year,
         l.year, l.judges, l.filed_per_month, l.resolved_per_month,
         EXISTS (SELECT 1 FROM latest) AS sources_built
  FROM judicial_body b
  LEFT JOIN mags   m ON m.body_code = b.body_code
  LEFT JOIN yrs    y ON y.body_code = b.body_code
  LEFT JOIN latest l ON l.body_code = b.body_code
  ORDER BY b.body_code
`;

export const readSeoCourts = async (): Promise<SeoCourt[]> => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const { rows } = await pool.query<Row>(QUERY);
    return rows.filter(isCrawlableRow).map((r) => ({
      bodyCode: r.body_code,
      name: r.name,
      kind: r.kind,
      tier: r.tier,
      place: r.place,
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
  } catch (err) {
    console.warn(
      `[seo] judicial bodies: Postgres unavailable, skipping /court/* pages (${
        (err as Error)?.message ?? String(err)
      })`,
    );
    return [];
  } finally {
    await pool.end().catch(() => {});
  }
};

const isCrawlableRow = (r: Row): boolean =>
  Boolean(r.name) && isCrawlableCourt({ bodyCode: r.body_code });
