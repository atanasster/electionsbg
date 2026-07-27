-- Per-MP full bio profile, served verbatim by /api/db/mp-profile so useMpProfile
-- stops downloading the data/parliament/profiles/{id}.json shard tree from the
-- bucket (persons-pg-retirement-v1 T2.3b). The blob is the trimmed parliament.bg
-- profile the scraper caches (A_ns_* fields: CV, languages, past terms, birth
-- place, contacts) — display-only, looked up by id, never filtered server-side, so
-- it is stored whole rather than exploded into columns. The .webp photos stay on
-- the bucket (Decision 3); only this metadata moves.
--
-- Deliberately NO foreign key to mp_profile(mp_id): the profiles tree covers every
-- MP ever scraped (~4.3k), including ~2.2k historical MPs absent from the current
-- roster index.json (mp_profile), and all of them must live here so the whole tree
-- can leave the bucket. Sibling of mp_profile (104) / mp_car — mp_id is the key,
-- the payload is a detail of it.

CREATE TABLE IF NOT EXISTS mp_profile_detail (
  mp_id   integer PRIMARY KEY,
  payload jsonb   NOT NULL
);
