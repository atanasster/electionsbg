-- GENERATED FILE — DO NOT EDIT.
-- Source: src/lib/shlyoRules.ts · Generator: scripts/db/gen_sql/shlyo_query_fold.ts
-- Regenerate: npm run gen:shlyo-sql   ·   Verify: npm run gen:shlyo-sql -- --check
--
-- SHLIOKAVITSA, server side. translit_bg_latin() (000_search_fns.sql) folds Cyrillic to
-- Streamlined Latin, so „Желязков" and „Zhelyazkov" already meet. What it cannot reach is
-- the Latin-side spelling a Bulgarian actually types — „6umen", „4erven", „sofiq",
-- „plowdiw" — because those fold to themselves.
--
-- Measured before this existed: „Jelqzkov" returned 0 rows from person_search while
-- „Jelyazkov" returned 2. pg_trgm's %> absorbs the letter-for-letter variants and hides
-- half the gap; what it cannot absorb is a substitution that changes the letter COUNT,
-- which is every rule below.
--
-- PRECONDITION: the argument is ALREADY FOLDED — compose this with translit_bg_latin(),
-- never call it on raw input. It does NOT lowercase, because its TypeScript twin does not
-- either, and adding a lower() here made the two disagree on every mixed-case input
-- ("6T" -> "shT" in TS, "sht" in SQL). Latent, since both callers pre-fold; a gate written
-- from lowercase examples would have passed while the two diverged.
--
-- THREE CONTRACTS, all inherited from the shared rule table:
--
--   1. QUERY SIDE ONLY. Compose it with the query parameter — never store its output.
--      A Latin trade name "Wow Ltd" folds to `wowltd` and would be indexed as `vovltd`.
--      No *_fold_shlyo column may exist.
--   2. STRICTLY ADDITIVE. Probe the plain needle first and this one only after it misses,
--      appending. It can add rows; it must never remove one.
--   3. THE INDEX STILL SERVES. Only the parameter side is transformed, so
--      `name_fold %> shlyo_query_fold(translit_bg_latin($1))` uses idx_person_search_fold
--      exactly as the un-rewritten probe does.
--
-- The rules, in application order (order is a contract — "6t" before "6", and the two "ya"
-- producers before the y rule, whose lookahead then protects their vowel):
--   6t             -> sht   щ
--   6              -> sh    ш
--   4              -> ch    ч
--   9              -> ya    я
--   q              -> ya    я
--   j              -> zh    ж
--   w              -> v     в
--   x              -> h     х
--   y(?![aeiou])   -> a     ъ typed as y; a real й/ю/я keeps its vowel
--
-- c -> ts (ц) is DELIBERATELY ABSENT: it would refold every Latin trade name carrying a
-- "c" (Keytruda, Abemaciclib) away from what the reader typed. Do not "complete" it.

CREATE OR REPLACE FUNCTION shlyo_query_fold(txt text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$
  SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(txt, ''), '6t', 'sht', 'g'), '6', 'sh', 'g'), '4', 'ch', 'g'), '9', 'ya', 'g'), 'q', 'ya', 'g'), 'j', 'zh', 'g'), 'w', 'v', 'g'), 'x', 'h', 'g'), 'y(?![aeiou])', 'a', 'g');
$$;
