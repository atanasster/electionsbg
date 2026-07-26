-- 108_official_candidate_link.sql — the candidateLink decoration for the municipal roster,
-- moved off the by_obshtina/<code>.json shards into Postgres.
--
-- Plan: docs/plans/persons-pg-retirement-v1.md (Tier 1.5). The roster shards carry a
-- `candidateLink` on every mayor / deputy-mayor / chair / councillor row — party (canonical
-- id → colour + label), ballot position, preference votes, elected flag, and for the ~5% of
-- councillors who also served in NS an MP photo + id. MyAreaCouncilTile (avatars + party
-- colours) and MyAreaGovernmentCard (the mayor's party) render it; the migration to
-- municipal_officials_table would have regressed both, so the decoration comes here.
--
-- KEYED BY official_slug — the same key as municipal_officials_table (person_role.ref for
-- an official_muni listing). ONE ROW PER ROSTER LISTING, so a person who sits on two bodies
-- carries a link per seat, exactly as the shards did.
--
-- This is a plain TABLE, not a matview: it is a name-join (roster name ↔ local-election
-- slate ↔ parliament index) that has no closed-form in SQL — the same join
-- scripts/officials/candidate_links.ts runs to decorate the JSON. load_official_candidate_
-- links_pg.ts computes it in TS and COPYs the result, then REFRESHes municipal_officials_
-- table so the LEFT JOIN below picks it up.
--
-- IDEMPOTENT / EMPTY-FIRST. Created here (CREATE TABLE IF NOT EXISTS) so 102's
-- `CREATE MATERIALIZED VIEW … LEFT JOIN official_candidate_link` never fails on a database
-- that has never run the loader — it simply sees zero links until the loader fills it.
-- The loader TRUNCATEs + COPYs, never DROPs, so 102's dependency on the table survives a
-- reload. Same shape and reasoning as 104_mp_roster's empty-first tables.

CREATE TABLE IF NOT EXISTS official_candidate_link (
  official_slug      text PRIMARY KEY,
  -- Local-election cycle the slate row was lifted from (e.g. "2023_10_29_mi").
  cycle              text NOT NULL,
  -- Verbatim party / coalition name from the slate; '' for an MP-only match (no slate row).
  party_name         text NOT NULL DEFAULT '',
  -- Canonical party id → canonical_parties.json for colour + label. NULL for an MP-only
  -- match, or a slate row whose party did not resolve to a canonical id.
  party_canonical_id text,
  -- 1-based ballot position; 0 for an MP-only match (consumers read "no slate data" off
  -- the absent party id, matching the JSON's synthetic listPos=0).
  list_pos           int  NOT NULL,
  pref_votes         int  NOT NULL,
  is_elected         boolean NOT NULL,
  -- The small overlap of councillors who also served in NS: parliament MP id + photo URL.
  mp_id              int,
  photo_url          text
);
