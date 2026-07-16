-- At-signing contract value — the counterpart to the current-basis `amount_eur`.
--
-- `amount_eur` holds the CURRENT (post-annex) contract value — "текуща стойност"
-- — flipped in place by scripts/procurement/anexi_current_value.ts from the ЦАИС
-- ЕОП анекси feed, so every SUM(amount_eur) is the current basis (matching SIGMA)
-- with no COALESCE. `signing_amount_eur` preserves the ORIGINAL at-signing value,
-- populated ONLY when an annex moved the value (NULL ⇒ amount_eur IS the signing
-- value). It drives the per-contract signed-vs-current Δ and is the euro-peg
-- canary's check target (it, not the annexed amount_eur, pegs to native `amount`).
--
-- ALTER-based (001's CREATE TABLE IF NOT EXISTS is a no-op on an existing DB).

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS signing_amount_eur double precision;
