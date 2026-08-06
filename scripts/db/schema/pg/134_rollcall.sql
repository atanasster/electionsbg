-- 134_rollcall.sql — the National Assembly roll-call corpus in Postgres.
--
-- Loaded by scripts/db/load_rollcall_pg.ts from data/parliament/votes/sessions/*.json.
-- Nothing derived lives here; 135_rollcall_derived.sql builds the matviews on top.
--
-- Plan: docs/plans/parliament-hub-v1.md §6.1. It calls these migrations 132–134; 132 and
-- 133 were taken by transport_facility_map and tr_company_place while the plan was being
-- written, so the family is 134–136.
--
-- ---------------------------------------------------------------------------
-- WHICH ITEM SET THIS HOLDS: ALL 16,741 raw items. 15,096 STAND; 1,645 carry
-- `superseded_by` and MUST be filtered out by anything that aggregates.
--
--     WHERE superseded_by IS NULL     -- 15,096 rows. Every derivation needs this.
--
-- `dedupeRevotes` collapses an item and its "прегласуване" (and verbatim same-day repeats)
-- so a decision voted N times counts once, and EVERY derived JSON artifact is computed
-- after it — 1,645 items, 9.8% of the corpus, as many as 500 in the 51st NS alone. A
-- matview that forgets the filter over-counts by that much and still returns a 200, which
-- is why the filter is stated here in the table this migration creates rather than only in
-- the plan: 135's four matviews are written against this comment.
--
-- The collapsed rows are KEPT rather than dropped because the raw roll is evidence — a
-- motion put to the floor twice is itself a fact about the chamber, and /votes/<date>
-- should be able to say so. Storing only the survivors would discard 1,645 real votes to
-- make one COUNT(*) match a number in a document.
--
-- ---------------------------------------------------------------------------
-- WHY THE KEY IS (ns, mp_id) AND NEVER mp_id.
--
-- parliament.bg RECYCLES member ids across parliaments: the corpus holds 1,370 distinct
-- mp_id for 2,366 seats, and after normalising whitespace and punctuation 26 of those ids
-- carry two genuinely different people —
--
--   3103 → ДИМИТЪР БОЙЧЕВ ПЕТРОВ  ||  ДЕНИЦА ДИМИТРОВА СИМЕОНОВА
--   3113 → ВЛАДИМИР СЛАВЧЕВ ВЪЛЕВ ||  ДИМИТЪР АНГЕЛОВ ИВАНОВ
--
-- A plain FK from vote_cast.mp_id to mp_profile.mp_id would silently merge two people's
-- voting records. The composite FK below is what makes those 26 ids safe, and it is also
-- why person_role.ref = mp_id::text (no NS column) remains an ambiguous bridge for them —
-- a person-layer problem this migration does not pretend to solve.

CREATE TABLE IF NOT EXISTS party_dim (
  party_id  smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ns        smallint NOT NULL,
  short     text     NOT NULL,
  UNIQUE (ns, short)
);

-- The (ns, mp_id) dimension the id recycling forces.
CREATE TABLE IF NOT EXISTS mp_seat (
  ns        smallint NOT NULL,
  mp_id     integer  NOT NULL,
  name      text     NOT NULL,
  -- LAST-SEEN affiliation, for display only. It is NOT a join key: 179 of 2,366 seats
  -- (8%) change party mid-term, almost always to НЕЗ when a member leaves their group
  -- (44:1564 ГЕРБ→НЕЗ, 45:3537 БСП→ДБ, 47:3993 ИТН→НЕЗ). Any derivation that groups by
  -- party MUST use vote_cast.party_id, which is the affiliation at the moment of the cast.
  -- Grouping here would compare those 179 members against a group they had already left,
  -- and would do it without any row count looking wrong.
  party_id  smallint REFERENCES party_dim,
  PRIMARY KEY (ns, mp_id)
);

CREATE TABLE IF NOT EXISTS vote_item (
  -- Synthetic, assigned in (date, item_no) order over the RAW set.
  item_id       integer  PRIMARY KEY,
  ns            smallint NOT NULL,
  date          date     NOT NULL,
  item_no       smallint NOT NULL,
  slug          text,
  title         text,
  topic         text     NOT NULL,
  -- Set by 136; NULL for every non-bill item and for every row until the bill resolver runs.
  bill_id       integer,
  reading       smallint,
  -- The item this one was superseded by, when a re-vote collapsed it. NULL for the row
  -- that stands. Kept so the raw roll is recoverable without re-reading the JSON.
  superseded_by integer  REFERENCES vote_item (item_id),
  yes           smallint,
  no            smallint,
  abstain       smallint,
  absent        smallint,
  UNIQUE (ns, date, item_no)
);
CREATE INDEX IF NOT EXISTS idx_vote_item_ns_date ON vote_item (ns, date);
-- The /votes/:date path. Separate from (ns, date) because the route has no NS in it.
CREATE INDEX IF NOT EXISTS idx_vote_item_date ON vote_item (date);
CREATE INDEX IF NOT EXISTS idx_vote_item_ns_topic ON vote_item (ns, topic);

CREATE TABLE IF NOT EXISTS vote_cast (
  item_id  integer  NOT NULL REFERENCES vote_item (item_id),
  mp_id    integer  NOT NULL,
  -- DENORMALISED, and it earns its place: without it the per-NS aggregates hash-join
  -- through vote_item and SEQ-SCAN the fact table — measured 183 ms / 25,769 buffers
  -- against 77 ms / 3,124 with it. The column packs into existing alignment padding
  -- beside `vote` and is immutable per item, so it cannot drift.
  ns       smallint NOT NULL,
  -- 'y' | 'n' | 'a' | 'x'. One byte, no TOAST, no enum-ordering trap.
  vote     "char"   NOT NULL,
  -- The affiliation AT THE MOMENT OF THE CAST — the only party column any derivation may
  -- group by. See the note on mp_seat.party_id.
  party_id smallint REFERENCES party_dim,
  PRIMARY KEY (item_id, mp_id),
  FOREIGN KEY (ns, mp_id) REFERENCES mp_seat (ns, mp_id)
);
CREATE INDEX IF NOT EXISTS idx_vote_cast_ns_mp
  ON vote_cast (ns, mp_id) INCLUDE (vote, party_id);
CREATE INDEX IF NOT EXISTS idx_vote_cast_mp_item
  ON vote_cast (mp_id, item_id) INCLUDE (vote);

COMMENT ON TABLE vote_item IS
  'ALL 16,741 roll-call agenda items. 15,096 stand; the rest carry superseded_by. AGGREGATE WITH "WHERE superseded_by IS NULL" or over-count by 9.8%. Loaded by db:load:rollcall:pg.';
COMMENT ON TABLE vote_cast IS
  'One row per (item, MP). party_id is the affiliation at cast time — group by this, never mp_seat.party_id.';
COMMENT ON COLUMN mp_seat.party_id IS
  'Last-seen affiliation, display only. 8% of seats change party mid-term; use vote_cast.party_id to group.';
COMMENT ON COLUMN vote_item.superseded_by IS
  'Set when a re-vote collapsed this item into another. NULL for the item that stands.';
