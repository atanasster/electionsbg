-- Consortium / framework attribution for joint procurement awards.
--
-- WHY. A joint award (обединение / ДЗЗД) is published by ЦАИС ЕОП as ONE contract
-- record whose supplier field concatenates the members ("EIK1; EIK2; …"). The
-- normalizers split its value EQUALLY across the members (one row each at value/N,
-- summing back to the true total — see scripts/procurement/normalize_eop.ts). That
-- keeps every TOTAL correct but invents a per-firm figure we do not actually know
-- ("we don't know how much each member collected"): a firm that only ever bids in
-- consortia looks like it won value/N outright, and top-contractor leaderboards
-- rank it on that fabricated share.
--
-- WHAT. For a genuine JOINT CONSORTIUM we move the full contract value onto ONE
-- carrier row — the source's ДЗЗД/обединение entity when it names one, else a
-- SYNTHETIC entity keyed by the sorted member-EIK set (so a recurring group is one
-- entity) and named from the members — and zero the member rows, which become
-- participation-only. Every `SUM(amount_eur) GROUP BY contractor_eik` surface then
-- auto-attributes the value to the consortium entity; the corpus/awarder TOTAL is
-- unchanged (carrier-full + members-zero == the prior split sum).
--
-- Multi-winner FRAMEWORKS (рамково споразумение awarded to many INDEPENDENT
-- suppliers — e.g. one €1.3bn drug tender with 16 competing distributors) are NOT
-- a joint entity: each firm is a real independent winner. We keep the equal split
-- and only TAG them (joint_kind='framework') so the UI can caption the shared
-- ceiling. A group is a framework iff "рамк" appears in its title/method/category
-- AND no member name is a named ДЗЗД; otherwise it is a consortium.
--
-- WHY plain columns + a rebuild function (NOT STORED GENERATED). Same reasoning as
-- 079_contracts_cais_id.sql: a STORED generated column forces a full-table rewrite
-- under AccessExclusiveLock (500s on every read during the window). These are plain
-- ADD COLUMNs (metadata-only) populated by rebuild_consortium() after the corpus
-- MERGE, which never blocks readers.
--
-- IMPORTANT — rebuild_consortium() MUST run on a freshly-merged corpus (every
-- member row at its EQUAL split, no synthetic carriers). That is exactly the state
-- right after CONTRACTS_MERGE_UPSERT_SQL: the MERGE restores each member row to the
-- shard's split value and anti-join-deletes prior synthetic carriers, and it never
-- touches these derived columns (they are absent from COLUMN_NAMES). load_pg.ts
-- calls it there. It is a no-op re-run on that fresh state, but is NOT valid on an
-- already-transformed table without a preceding MERGE.

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS joint_kind          text;      -- 'consortium' | 'framework' | NULL
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS consortium_role     text;      -- 'carrier' | 'member' | NULL
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS consortium_size     smallint;  -- member count N
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS consortium_eik      text;      -- carrier EIK (self on carrier; link on members)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS consortium_full_eur double precision; -- full joint value (== carrier amount_eur)

-- Member-participation lookup ("which joint contracts is firm X part of").
CREATE INDEX IF NOT EXISTS idx_contracts_consortium_member
  ON contracts(contractor_eik) WHERE consortium_role = 'member';
-- Consortium-entity page ("who are the members of carrier C").
CREATE INDEX IF NOT EXISTS idx_contracts_consortium_eik
  ON contracts(consortium_eik) WHERE consortium_eik IS NOT NULL;

-- The consortium regex — recognises the registered joint-entity forms, including
-- the spelled-out "Дружество по ЗЗД". Kept in one place so detection and carrier
-- selection agree.
CREATE OR REPLACE FUNCTION is_consortium_name(p_name text)
  RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_name ~* '(ДЗЗД|Обединение|Консорциум|Дружество по ЗЗД|ДЗ ?ЗД)'
$$;

-- Synthesised display name for an unnamed consortium, built from its member firms
-- (sorted names in). "Обединение: A, B, C"; ≥4 members → "Обединение: A, B +N още".
CREATE OR REPLACE FUNCTION consortium_carrier_name(p_names text[])
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_names IS NULL OR array_length(p_names, 1) IS NULL THEN 'Обединение'
    WHEN array_length(p_names, 1) <= 3
      THEN 'Обединение: ' || array_to_string(p_names, ', ')
    ELSE 'Обединение: ' || array_to_string(p_names[1:2], ', ')
         || ' +' || (array_length(p_names, 1) - 2) || ' още'
  END
$$;

CREATE OR REPLACE FUNCTION rebuild_consortium() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- (0) Reset. Synthetic carriers from a prior transform are already gone after the
  -- corpus MERGE (anti-join delete); this DELETE is a defensive no-op on that path.
  -- Flags are cleared so a contract that is no longer joint drops its old marker.
  DELETE FROM contracts WHERE contractor_eik LIKE 'obed-%';
  UPDATE contracts
     SET joint_kind = NULL, consortium_role = NULL, consortium_size = NULL,
         consortium_eik = NULL, consortium_full_eur = NULL
   WHERE joint_kind IS NOT NULL OR consortium_role IS NOT NULL;

  -- (1) Joint groups: >1 contractor on ONE contract, all rows the SAME positive
  -- amount (the equal-split signature). Varying-amount groups (distinct parallel
  -- awards under one id) are deliberately excluded.
  -- consortium_size counts the DISTINCT member EIKs (the member set), matching the
  -- split denominator the normalizers use. ramk/named are COALESCE'd to false: a
  -- NULL procurement_method must not make bool_or return NULL (which would drop the
  -- group from BOTH the framework tag AND the consortium collapse, silently leaving
  -- it on the fabricated equal split). The `count(DISTINCT title)=1` guard stops a
  -- shared ocid with NULL contract_id from pooling genuinely-distinct contracts
  -- (different titles) into one phantom consortium — member rows of ONE real award
  -- always share their title.
  CREATE TEMP TABLE _cg ON COMMIT DROP AS
  SELECT ocid, COALESCE(contract_id, '') AS cid,
         count(DISTINCT contractor_eik)::int AS n,
         sum(amount)                AS full_amount,
         sum(amount_eur)            AS full_eur,
         sum(signing_amount_eur)    AS full_signing,
         COALESCE(bool_or(title ~* 'рамк' OR COALESCE(procurement_method, '') ~* 'рамк'
                 OR COALESCE(category, '') ~* 'рамк'), false)  AS ramk,
         COALESCE(bool_or(is_consortium_name(contractor_name)), false)  AS named
  FROM contracts
  WHERE tag = 'contract' AND amount_eur > 0
  GROUP BY ocid, COALESCE(contract_id, '')
  HAVING count(DISTINCT contractor_eik) > 1
     AND count(DISTINCT round(amount_eur::numeric, 2)) = 1
     AND count(DISTINCT title) = 1;

  -- (2) Frameworks (рамк, no named ДЗЗД): independent parallel winners — keep the
  -- equal split, only tag them.
  UPDATE contracts c
     SET joint_kind = 'framework', consortium_size = g.n
  FROM _cg g
  WHERE g.ramk AND NOT g.named
    AND c.ocid = g.ocid AND COALESCE(c.contract_id, '') = g.cid
    AND c.tag = 'contract' AND c.amount_eur > 0;

  -- (3) Consortia = the rest.
  CREATE TEMP TABLE _cons ON COMMIT DROP AS
  SELECT * FROM _cg g WHERE NOT (g.ramk AND NOT g.named);

  -- Named carrier: the ДЗЗД/обединение member (lowest EIK on ties).
  CREATE TEMP TABLE _named_carrier ON COMMIT DROP AS
  SELECT DISTINCT ON (c.ocid, COALESCE(c.contract_id, ''))
         c.ocid, COALESCE(c.contract_id, '') AS cid,
         c.key AS carrier_key, c.contractor_eik AS carrier_eik
  FROM contracts c
  JOIN _cons g ON c.ocid = g.ocid AND COALESCE(c.contract_id, '') = g.cid
  WHERE g.named AND c.tag = 'contract' AND c.amount_eur > 0
    AND is_consortium_name(c.contractor_name)
  ORDER BY c.ocid, COALESCE(c.contract_id, ''), c.contractor_eik;

  -- Synthetic carrier for unnamed consortia — identity keyed by the sorted member
  -- EIK set (recurring groups consolidate), name synthesised from the members.
  CREATE TEMP TABLE _synth ON COMMIT DROP AS
  SELECT g.ocid, g.cid,
         'obed-' || left(md5(g.ocid || '|' || g.cid), 12) AS carrier_key,
         'obed-' || left(md5(m.eikset), 12)               AS carrier_eik,
         consortium_carrier_name(m.names)                 AS carrier_name
  FROM _cons g
  JOIN LATERAL (
    SELECT string_agg(DISTINCT c.contractor_eik, ',' ORDER BY c.contractor_eik) AS eikset,
           array_agg(DISTINCT c.contractor_name)                                AS names
    FROM contracts c
    WHERE c.ocid = g.ocid AND COALESCE(c.contract_id, '') = g.cid
      AND c.tag = 'contract' AND c.amount_eur > 0
  ) m ON true
  WHERE NOT g.named;

  -- (4) Zero + flag the member rows (every original group row that is NOT a promoted
  -- named carrier). Runs while the original rows still carry their split value; the
  -- synthetic carrier is inserted in (6), after this.
  UPDATE contracts c
     SET amount = 0, amount_eur = 0, signing_amount_eur = 0,
         joint_kind = 'consortium', consortium_role = 'member', consortium_size = g.n,
         consortium_eik = COALESCE(nc.carrier_eik, sy.carrier_eik),
         consortium_full_eur = g.full_eur
  FROM _cons g
  LEFT JOIN _named_carrier nc ON nc.ocid = g.ocid AND nc.cid = g.cid
  LEFT JOIN _synth sy         ON sy.ocid = g.ocid AND sy.cid = g.cid
  WHERE c.ocid = g.ocid AND COALESCE(c.contract_id, '') = g.cid
    AND c.tag = 'contract' AND c.amount_eur > 0
    AND (nc.carrier_key IS NULL OR c.key <> nc.carrier_key);

  -- (5) Promote the named carrier row to the full value. The native `amount` is
  -- the back-conversion of the pegged euro value (NOT SUM(amount)) so the EUR-peg
  -- invariant holds exactly — summing N rounded member amounts would drift past the
  -- 1-cent tolerance. Foreign-currency carriers keep SUM(amount) (the peg skips them).
  UPDATE contracts c
     SET amount = CASE
           WHEN upper(btrim(c.currency)) IN ('BGN','ЛВ','ЛВ.','ЛЕВА')
             THEN COALESCE(g.full_signing, g.full_eur) * 1.95583
           WHEN upper(btrim(c.currency)) = 'EUR'
             THEN COALESCE(g.full_signing, g.full_eur)
           ELSE g.full_amount END,
         amount_eur = g.full_eur,
         signing_amount_eur = g.full_signing,
         joint_kind = 'consortium', consortium_role = 'carrier', consortium_size = g.n,
         consortium_eik = c.contractor_eik, consortium_full_eur = g.full_eur
  FROM _cons g
  JOIN _named_carrier nc ON nc.ocid = g.ocid AND nc.cid = g.cid
  WHERE c.key = nc.carrier_key;

  -- (6) Insert one synthetic carrier per unnamed consortium (full value), copying
  -- the non-money fields from a representative member.
  INSERT INTO contracts (
    key, ocid, release_id, contract_id, tag, date, date_signed,
    awarder_eik, awarder_name, awarder_region, awarder_locality, awarder_postal, awarder_street,
    contractor_eik, contractor_eik_full, contractor_name,
    amount, currency, amount_eur, title, cpv, procurement_method, category,
    procurement_method_rationale, number_of_tenderers, eu_funded, eu_program,
    tender_period_start_date, tender_period_end_date, bundle_uuid, source_url,
    unp, lot_name, signing_amount_eur, cais_id,
    joint_kind, consortium_role, consortium_size, consortium_eik, consortium_full_eur)
  SELECT
    sy.carrier_key, r.ocid, r.release_id, r.contract_id, 'contract', r.date, r.date_signed,
    r.awarder_eik, r.awarder_name, r.awarder_region, r.awarder_locality, r.awarder_postal, r.awarder_street,
    sy.carrier_eik, NULL, sy.carrier_name,
    CASE
      WHEN upper(btrim(r.currency)) IN ('BGN','ЛВ','ЛВ.','ЛЕВА')
        THEN COALESCE(g.full_signing, g.full_eur) * 1.95583
      WHEN upper(btrim(r.currency)) = 'EUR'
        THEN COALESCE(g.full_signing, g.full_eur)
      ELSE g.full_amount END,
    r.currency, g.full_eur, r.title, r.cpv, r.procurement_method, r.category,
    r.procurement_method_rationale, r.number_of_tenderers, r.eu_funded, r.eu_program,
    r.tender_period_start_date, r.tender_period_end_date, r.bundle_uuid, r.source_url,
    r.unp, r.lot_name, g.full_signing, contract_cais_ref(r.unp, r.ocid),
    'consortium', 'carrier', g.n, sy.carrier_eik, g.full_eur
  FROM _synth sy
  JOIN _cons g ON g.ocid = sy.ocid AND g.cid = sy.cid
  JOIN LATERAL (
    SELECT * FROM contracts c
    WHERE c.ocid = sy.ocid AND COALESCE(c.contract_id, '') = sy.cid
      AND c.tag = 'contract' AND c.consortium_role = 'member'
    ORDER BY c.contractor_eik
    LIMIT 1
  ) r ON true;
END;
$$;

-- contracts_list is `SELECT c.*` — a view freezes its column list at creation, so
-- it won't expose the new joint_kind/consortium_* columns (which the contracts
-- DbDataTable projects) until recreated. Rebuild it via the shared helper (same one
-- 042/050 call) so the served column set can't drift by migration/load order.
SELECT rebuild_contracts_list();

-- NOTE — this file is re-exec'd at the TOP of every load (before the corpus MERGE),
-- so it deliberately does NOT call rebuild_consortium() here: at that point the
-- table still holds the PREVIOUS load's transformed rows (members zeroed), which is
-- not the fresh equal-split state rebuild_consortium() requires. load_pg.ts invokes
-- it right after the MERGE instead. Applying this migration standalone only adds the
-- columns/functions; the population lands on the next full reload.
