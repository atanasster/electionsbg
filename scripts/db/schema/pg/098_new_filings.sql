-- 098_new_filings.sql — the new-filing feed behind the watchlist (audit T3.10).
--
-- "A new declaration appeared for someone you follow" needs one thing the corpus did not
-- expose: WHEN a filing entered our data. The register itself carries no publication date —
-- filed_at is when the declarant filed, which for a backfilled year is a decade ago — so
-- recency has to come from the ingest layer. ingest_first_seen already records it, keyed on
-- source='cacbg_declarations' with key = declaration.source_url, and it joins all 47,983
-- filings exactly.
--
-- FIRST-SEEN IS NOT PUBLICATION. A filing first seen today may have sat in the register for
-- years and simply not been ingested until now; a backfill stamps tens of thousands of old
-- filings with the same date. The feed therefore describes what is NEW TO THIS SITE, and the
-- UI must say so rather than implying the official just filed. Both dates are returned so
-- the surface can show the filing's own period next to when we picked it up.
--
-- NO ACCOUNTS, AND THE LIST NEVER LEAVES THE BROWSER. The site has no auth, so a watchlist
-- is a list of slugs held in localStorage. An earlier revision sent that list to the server
-- as a query parameter and filtered there; it was correct that nothing was STORED in the
-- database, but the request itself carried the reader's political interests into the access
-- log and — because functions/index.js sets `Cache-Control: public, s-maxage=3600` — into a
-- shared CDN cache key. A comment promising "no record of who follows whom" is not worth
-- much when the URL is the record.
--
-- So the server only ever emits the SITE-WIDE feed, identical for every reader, and the
-- browser filters it against the local list. The tradeoff is honest and bounded: a followed
-- person whose filing has fallen out of the recent window will not appear. Nothing about a
-- reader is transmitted, logged or cached.
--
-- §6 PRIVACY GATE as everywhere else: the person must be active + public, and a filing that
-- resolves to no person never surfaces (an unattributed filing is not news about anyone).

-- The site-wide feed: what arrived most recently, newest first.
DROP FUNCTION IF EXISTS declaration_new_filings(integer);
CREATE OR REPLACE FUNCTION declaration_new_filings(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    -- ORDER BY THE TIMESTAMP, not the rendered date. to_char() truncates to a day, and every
    -- marker in a backfill shares one day — so ordering the aggregate on the TEXT field left
    -- a constant primary key and the feed silently fell through to its slug tiebreak and
    -- came out ALPHABETICAL under a "newest first" heading. The sortable value is carried
    -- out of the subquery for exactly this reason.
    SELECT jsonb_agg(r ORDER BY seen_at DESC, url)
      FROM (
        SELECT f.first_seen_at AS seen_at,
               d.source_url AS url,
               jsonb_build_object(
                 'slug', p.slug,
                 'name', p.display_name,
                 'year', d.declaration_year,
                 'fiscalYear', d.fiscal_year,
                 'declarationType', d.declaration_type,
                 'institution', d.institution,
                 'positionTitle', d.position_title,
                 'firstSeen', to_char(f.first_seen_at, 'YYYY-MM-DD'),
                 'filedAt', to_char(d.filed_at, 'YYYY-MM-DD'),
                 'sourceUrl', d.source_url
               ) AS r
          FROM ingest_first_seen f
          JOIN declaration d ON d.source_url = f.key
          JOIN person p ON p.person_id = d.person_id
         WHERE f.source = 'cacbg_declarations'
           AND p.status = 'active' AND p.is_public_figure
         -- Deterministic ordering INSIDE the limit too, or which rows survive the cut
         -- changes between calls on a first-seen tie (a backfill ties tens of thousands).
         ORDER BY f.first_seen_at DESC, d.source_url
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
      ) s
  ), '[]'::jsonb);
$$;

-- There is deliberately NO per-watchlist serving function. Filtering by a slug list here
-- would mean transmitting that list; see the note at the top of this file.

-- No index is added for the join: declaration.source_url already carries a UNIQUE index
-- (declaration_source_url_key) and a second one on the same column is pure duplication.
CREATE INDEX IF NOT EXISTS idx_ingest_first_seen_cacbg
  ON ingest_first_seen (first_seen_at DESC)
  WHERE source = 'cacbg_declarations';
