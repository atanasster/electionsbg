-- 101_declaration_subject_alias.sql — the filings the loader DROPS, kept as identity evidence.
--
-- Plan: docs/plans/persons-pg-retirement-v1.md (T0.1b).
--
-- THE PROBLEM THIS EXISTS TO FIX. `declaration.source_url` is UNIQUE, and one filing is
-- written under two slugs when an official holds two posts, so load_declarations_pg drops
-- the second copy ("2436 duplicate URLs skipped"). That dedup is correct — one filing, one
-- row. But the dropped row was also the only evidence that the two officials slugs are the
-- SAME HUMAN, and throwing it away breaks the person layer downstream:
--
--   Димитър Георгиев Тасков is Управител of two hospitals, so the officials ingest — which
--   mints hash(canonicalDeclarantName|institution) — gave him two slugs:
--     dimitr-georgiev-taskov-14e4c2  СОБАЛ "Д-р Тасков" ООД, гр. Търговище
--     dimitr-georgiev-taskov-39b7b6  СОБАЛ "Луксор" ЕООД, гр. Пловдив
--   ONE filing (source_url …C910DA38…207270.xml, entry Г4422, control hash CF952D5C) is
--   listed under both. The loader kept it under -14e4c2 and dropped it under -39b7b6.
--
-- resolve_persons.registerIdByRef() then derives its second gold key — the Сметна палата
-- per-person GUID — by reading `declaration`. -14e4c2 gets a GUID; -39b7b6 gets NULL,
-- because its only filing was dropped. The gold-key aliasing that exists precisely to bind
-- "a register person to every slug the officials ingest minted for them" therefore never
-- fires, two person rows are created for one man, his role lands on one and his wealth on
-- the other, and /officials/assets renders him with no net worth. 106 officials were
-- affected this way — €2.79M in his case.
--
-- So: keep the dropped (subject_ref, source_url) pairs. Not as declarations — they are
-- duplicates and must never be counted, summed or served — but as the identity evidence
-- registerIdByRef needs. The GUID guard there is unchanged: a ref carrying more than one
-- distinct GUID is still SKIPPED rather than guessed at, so this can only ever ADD a
-- correct union, never invent one.
--
-- WHY A NAME IS STORED AND CHECKED. The GUID guard ("a ref carrying two distinct GUIDs is
-- skipped") protects against one slug holding two register persons. It does NOT protect the
-- new direction this table opens: trusting that two refs sharing a source_url are one human.
-- That is true of the register's own duplicate listings, but the inference is only as good
-- as the source, and a gold key overrides every name/patronymic/namesake veto downstream.
-- So the alias carries the declarant name and registerIdByRef requires it to agree with the
-- winning filing's — cheap, and it keeps a bad row in this table from silently merging two
-- different people.
--
-- Written by load_declarations_pg.ts phase 1 (TRUNCATE + COPY in the same transaction as
-- the corpus, so the two can never disagree) and read by db:resolve:persons, which runs
-- between phase 1 and phase 2 — the ordering that makes this work at all.

CREATE TABLE IF NOT EXISTS declaration_subject_alias (
  subject_ref    text NOT NULL,
  source_url     text NOT NULL,
  tier           text NOT NULL,
  -- The name as the register printed it on THIS listing. Stored so the union this table
  -- enables is auditable and gateable: registerIdByRef only accepts an alias whose name
  -- folds to the same person as the filing that won. Without it the table asserts "these
  -- two refs are one human" on the strength of a shared URL alone, and a gold key is the
  -- one tier no namesake veto can override — see the header.
  declarant_name text,
  PRIMARY KEY (subject_ref, source_url)
);

-- registerIdByRef groups by subject_ref; index the other side of that read too.
CREATE INDEX IF NOT EXISTS idx_declaration_subject_alias_url
  ON declaration_subject_alias (source_url);
