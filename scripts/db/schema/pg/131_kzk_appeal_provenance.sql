-- Provenance for kzk_appeals' tier-2 outcome columns.
--
-- WHY: `outcome` / `decision_date` have two possible authors — the ~2,098 rows
-- produced interactively before any crawler existed (irreplaceable, no committed
-- generator) and the rows the matcher derives from `kzk_decisions`. Until now
-- they were indistinguishable, so every writer had to use the most conservative
-- rule that keeps the hand-made ones safe: `COALESCE(existing, EXCLUDED)`,
-- fill-only.
--
-- That protects the old values and has a nasty second effect: it makes a WRONG
-- new value permanent. Once the matcher writes a bad outcome, no later run can
-- correct it, because fill-only refuses to touch a non-NULL cell. A matcher fix
-- would ship and change nothing.
--
-- This column is what lets the two be told apart:
--
--   decision_act_no IS NOT NULL  → machine-derived from that act. RE-DERIVABLE:
--                                  a later, better matcher may overwrite it.
--   decision_act_no IS NULL      → hand-seeded (or never set). PROTECTED: writers
--                                  fill it only when the row has no outcome at all.
--
-- It is also the audit trail: "which act produced this outcome" was previously
-- unanswerable, so a suspicious classification could not be traced back to the
-- ruling it came from.
--
-- Separate from 042 on purpose. 042 DROPs and rebuilds tenders_list,
-- contracts_list, appealed_ocids and upheld_ocids CASCADE — far too heavy to
-- re-apply from a small rejoin script, and applying it just to add a column would
-- blank two matviews the risk index reads until they were refreshed.
--
-- Applied by scripts/procurement/kzk_rejoin.ts and by the T4 crawler. Idempotent.

ALTER TABLE kzk_appeals
  ADD COLUMN IF NOT EXISTS decision_act_no text;

-- The audit direction: given an act, which complaints did it resolve. Partial —
-- most rows have no outcome, and the ones that do are the only ones worth indexing.
CREATE INDEX IF NOT EXISTS idx_kzk_appeals_decision_act
  ON kzk_appeals(decision_act_no) WHERE decision_act_no IS NOT NULL;
