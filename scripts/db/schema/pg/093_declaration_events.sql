-- 093_declaration_events.sql — the disposals & third-party-expenses feed (audit T3.4).
--
-- The register records four things that are NOT part of the estate at filing time, and
-- which the site threw away entirely until the parser was fixed (audit T1.6): property and
-- vehicles TRANSFERRED in the prior year (tables 2 and 3.5), expenses a third party paid
-- for the declarant (table 14/15), and guarantees given in their favour (13/14).
--
-- They are the most editorially interesting rows in the whole declaration precisely because
-- they are not wealth: "sold the car the year before leaving office" and "someone else paid
-- for this trip" are transactions, not holdings. 9,127 of them are on file.
--
-- Two surfaces:
--   person_declaration_events(slug) — one person's, newest first, for their profile.
--   declaration_events_feed(kind, limit) — the site-wide feed, biggest first.
--
-- PUBLIC-SAFE. Both gate on the person being active + public (§6), the same predicate every
-- other person surface uses. The site-wide feed additionally resolves each row to a named
-- person, so an unresolved filing (person_id NULL) never surfaces — a disposal we cannot
-- attribute is one we do not publish.
--
-- NOT cohort-gated (091): unlike the accumulation gap, these are verbatim register facts
-- about a filing, not a derived metric about a person, so the narrower senior cohort does
-- not apply. The gate that does apply is attribution + the public-figure rule.

DROP FUNCTION IF EXISTS person_declaration_events(text);
CREATE OR REPLACE FUNCTION person_declaration_events(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH pick AS (
    SELECT person_id FROM person
     WHERE slug = p_slug AND status = 'active' AND is_public_figure LIMIT 1
  )
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', e.kind,
      'year', d.declaration_year,
      -- The PERIOD the filing covers, verbatim from the register — NOT a computed event
      -- year. `declaration_year - 1` would be right only for annuals: the parser sets
      -- declaration_year = fiscal_year + 1 for an annual but = fiscal_year for Entry /
      -- Vacate / Other, so subtracting one mislabels the year of a named person's
      -- transaction on every one-off filing. Null when the register does not state it,
      -- and the UI then shows the filing year rather than inventing one.
      'fiscalYear', d.fiscal_year,
      'declarationType', d.declaration_type,
      'institution', d.institution,
      'positionTitle', d.position_title,
      'description', e.description,
      'detail', e.detail,
      'location', e.location,
      'municipality', e.municipality,
      'areaSqm', e.area_sqm,
      'valueEur', round(e.value_eur),
      'legalBasis', e.legal_basis,
      'sourceUrl', d.source_url
    ) ORDER BY d.declaration_year DESC, e.value_eur DESC NULLS LAST, e.seq)
    FROM declaration_event e
    JOIN declaration d ON d.declaration_id = e.declaration_id
    JOIN pick ON pick.person_id = d.person_id
  ), '[]'::jsonb);
$$;

-- The site-wide feed. `p_kind` filters to one event kind (NULL = all); ordered by declared
-- value so the editorially interesting rows lead. Every row carries the person's slug +
-- name, so the feed links straight into the profile that explains it.
DROP FUNCTION IF EXISTS declaration_events_feed(text, int);
CREATE OR REPLACE FUNCTION declaration_events_feed(p_kind text, p_limit int)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT jsonb_agg(r ORDER BY (r->>'valueEur')::numeric DESC, r->>'slug')
      FROM (
        SELECT jsonb_build_object(
          'slug', p.slug,
          'name', p.display_name,
          'kind', e.kind,
          'year', d.declaration_year,
          'fiscalYear', d.fiscal_year,
          'institution', d.institution,
          'positionTitle', d.position_title,
          'description', e.description,
          'detail', e.detail,
          'location', e.location,
          'municipality', e.municipality,
          'valueEur', round(e.value_eur),
          'legalBasis', e.legal_basis,
          'sourceUrl', d.source_url
        ) AS r
        FROM declaration_event e
        JOIN declaration d ON d.declaration_id = e.declaration_id
        -- INNER join: an unattributed filing never reaches the public feed.
        JOIN person p ON p.person_id = d.person_id
                      AND p.status = 'active' AND p.is_public_figure
       WHERE (p_kind IS NULL OR e.kind = p_kind)
         -- 0 means UNPRICED in this corpus (092 rule 4), not "given away for nothing".
         AND e.value_eur IS NOT NULL AND e.value_eur > 0
       -- Explicit tie-breaks: value alone is not unique, and an unstable top-N would
       -- reorder named individuals between identical runs
       -- (reference_pg_payload_determinism).
       ORDER BY e.value_eur DESC, p.slug, e.declaration_id, e.seq
       -- Clamped HERE, not only in the HTTP route: 092 established that the limits live
       -- in the function so a second caller cannot widen them.
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
      ) t
  ), '[]'::jsonb);
$$;
