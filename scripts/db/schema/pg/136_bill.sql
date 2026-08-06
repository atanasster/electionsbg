-- 136_bill.sql — the bill dimension over the roll-call corpus (plan §6.1, phase P4).
--
-- WHAT A ROW IS, AND WHAT IT IS NOT. One row per (ns, title stem) that REACHED A SECOND
-- READING. Not "every bill the chamber saw": a bill that had a first reading and never came
-- back has no row here, by design, because the tile on /parliament counts exactly this set
-- and a table whose COUNT(*) disagreed with the number on the page would be the drift the
-- whole hub plan exists to remove. `bills_reached_second_reading.data.test.ts` holds the
-- two against each other.
--
-- THE STEM SPLIT IS TYPESCRIPT, NOT A SQL REGEX. secondReadingStem() in
-- scripts/parliament/derived/hub_stats.ts owns it, for the reason 104_mp_roster.sql gives
-- for keeping BRAND_ALIASES out of SQL: the rule has a documented trap in it (a title
-- carrying „второ гласуване" in a PROCEDURAL position is a FIRST reading, and matching the
-- phrase instead of requiring the split to fire counted 8 extra bills on the 52nd), and a
-- second copy of that rule in PL/pgSQL is a copy that will not learn the next trap.
--
-- final_item IS DELIBERATELY NULLABLE AND ALWAYS NULL TODAY. Populating it needs a
-- whole-bill adoption marker, and this corpus has none — §4.2 measured that the largest
-- second-reading stem ends on yes:38 no:4 abstain:135, a rejected amendment rather than an
-- adoption, so "the last item of the stem" is not it. The column is where that will live if
-- a source for it ever appears; it is not a claim that the question is solved. Anything
-- reading it must treat NULL as "not derivable", never as "not adopted".
--
-- Measured over the committed corpus: 504 bills across nine parliaments (44:68 45:2 46:13
-- 47:64 48:48 49:124 50:27 51:133 52:25), 401 of them (79.6%) with a first reading the
-- resolver could match by stem.

CREATE TABLE IF NOT EXISTS bill (
  bill_id integer  PRIMARY KEY,
  ns      smallint NOT NULL,
  -- The title before „ – второ гласуване". Article votes on one bill share it.
  stem    text     NOT NULL,
  -- The earliest item whose FIRST-reading stem matches, when one exists. NULL for the 20%
  -- with no matchable first reading — a bill can reach the floor through a committee route
  -- whose title does not carry the marker.
  first_reading_item integer REFERENCES vote_item (item_id),
  -- See the header. NULL is "not derivable", not "not adopted".
  final_item         integer REFERENCES vote_item (item_id),
  UNIQUE (ns, stem)
);
CREATE INDEX IF NOT EXISTS idx_bill_ns ON bill (ns);

-- 134 declares vote_item.bill_id without the constraint, because bill did not exist yet.
-- Added here, and idempotently: exec() sends a migration as one implicit transaction, so a
-- duplicate-object error would roll the whole file back on every re-apply.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vote_item_bill_id_fkey'
  ) THEN
    ALTER TABLE vote_item
      ADD CONSTRAINT vote_item_bill_id_fkey
      FOREIGN KEY (bill_id) REFERENCES bill (bill_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vote_item_bill
  ON vote_item (bill_id) WHERE bill_id IS NOT NULL;

COMMENT ON TABLE bill IS
  'Bills that REACHED A SECOND READING, one row per (ns, title stem). NOT every bill the chamber saw — a first reading that never came back has no row. 504 rows. Loaded by db:load:rollcall:pg.';
COMMENT ON COLUMN bill.stem IS
  'Title before the second-reading marker. Split by secondReadingStem() in TypeScript, never by a SQL regex.';
COMMENT ON COLUMN bill.final_item IS
  'ALWAYS NULL today. The corpus has no whole-bill adoption marker; NULL means "not derivable", never "not adopted".';
COMMENT ON COLUMN vote_item.bill_id IS
  'The bill this item votes on, for first- and second-reading items of a bill that reached a second reading. NULL for every other item.';
