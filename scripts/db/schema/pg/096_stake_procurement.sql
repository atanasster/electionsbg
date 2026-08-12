-- 096_stake_procurement.sql — declared company stakes that hold public contracts (audit T3.8).
--
-- "An official declared owning company X; company X holds public contracts" is the most
-- legible conflict-of-interest signal in the corpus. It is also the easiest one to get
-- catastrophically wrong, because THE DECLARATION FORM CARRIES NO EIK.
--
-- Tables 10/11 record a company NAME and a registered office, nothing more —
-- declaration_stake.uic is 100% NULL across all 15,304 stake rows (measured 2026-08-12) and
-- always will be; the column exists for a source that turned out not to supply it. Every link
-- from a
-- declared stake to a contractor has to be RESOLVED, and a wrong resolution publishes
-- "this official's company won public money" against a named person who owns no such thing.
--
-- Hence three deliberately narrow gates. A row is published only when ALL hold:
--
--   A. NAME CANDIDACY — every TRADING company bearing the normalised declared name is a
--      candidate (entity_class='company': the register also holds ~31k NGOs, читалища,
--      cooperatives and foreign branches, and a declared ООД resolving against an
--      association is a false match that also inflates the ambiguity denominator).
--      Gate A used to demand the name identify exactly one company OUTRIGHT; that threw away
--      the case the registry itself can settle — two active `АКТИВ ГРУП` ЕООД exist and only
--      one has the declared holder as an officer. The uniqueness requirement is not dropped,
--      it MOVES to after gate B: a name still ambiguous once the footprint has spoken is
--      dropped, never resolved to a first match.
--
--   B. INDEPENDENT CONFIRMATION — the TR itself records THE DECLARED HOLDER at that exact EIK,
--      as an owner (tr_person_roles) or an officer (tr_officers), matched on name_fold. The
--      link then rests on two independent sources that agree (the person said so on their
--      declaration, and the state registry says so of its own accord), not on a string
--      similarity.
--
--      THE HOLDER, not the filer. Tables 10/11 name a holder per row and it is often a
--      spouse or a child: 8,526 of 15,304 stake rows carry one and only 4,431 are the filer.
--      Asking about the declarant for all of them did two things wrong — it could never
--      confirm the ~4,095 family rows however good the evidence, and it CONFIRMED 235 of them
--      off the declarant's own presence at the company, publishing "my wife owns X" as the
--      filer's own holding because the filer happened to be an officer there. 187 of those
--      235 no longer resolve, which is the fix and not a regression.
--
--   C. IDENTITY UNAMBIGUITY — the CONFIRMING person's folded name is NOT shared by two or
--      more active `person` records. This gate exists because B is a name_fold match and name_fold carries
--      no birth date and no EGN: when seven distinct people fold to "Георги Иванов Славов",
--      the registry row at that EIK may belong to any of them, and gate B confirms nothing.
--      Publishing under those conditions attributes a company — and its public money — to
--      whichever namesake we happen to hold a declaration for. It costs real recall (14 of
--      39 otherwise-servable person/company pairs, 36%) and that is the correct price:
--      recall loss is cheaper than false attribution. See person.namesake_risk (082), which
--      the site already maintains for exactly this "name match — identity not verified" case.
--
--      `n = 1`, never `n <= 1`. For a family holder n = 0 is common — 624 candidate rows —
--      and it means the person layer holds no row for that name, which is NOT evidence the
--      name is unique: `person` is not a census, and Моника Любомирова Станишева is an
--      officer at 14 companies while absent from it entirely. Admitting n = 0 would publish
--      those 624 on no identity evidence at all. It costs the `АКТИВ ГРУП` case that
--      motivated the family arm; the same price, paid for the same reason.
--
-- WHAT THE FAMILY ARM IS FOR, AND WHAT IT IS NOT. `holder_is_declarant` marks whose holding
-- a row describes. EVERY MONEY CONSUMER MUST FILTER ON IT: a spouse's company is not the
-- filer's holding and its contracts are not the filer's public money.
-- `person_stake_procurement()` below does. Measured: 2,043 own rows (563 people) and 391
-- family rows (157 people).
--
-- WHAT IS DELIBERATELY *NOT* DONE:
--   * The resolved uic is NOT written back into declaration_stake. That table is a faithful
--     record of what the XML said, and the XML said no EIK. Inference lives here, in a
--     derived layer that can be rebuilt or narrowed without touching the parse.
--   * Unconfirmed matches are not stored "for later" behind a confidence flag. A confidence
--     column invites a caller to render the low tier; there is nothing to render.
--   * consortium_eik is not matched, and a member's €0 placeholder row is not counted — see
--     the `won` CTE.
--
-- FRAMING. Owning a company that wins public contracts is lawful and common; the declaration
-- is how the system is *supposed* to work. The payload is therefore descriptive — amounts,
-- years, counts — and carries no risk score, no ranking and no adjective. Same discipline as
-- docs/methodology/accumulation-gap.md.
--
-- §6 PRIVACY GATE: person must be status='active' AND is_public_figure, as on every other
-- person-serving surface (082, 090, 093). NOT cohort-gated (091) — this is a verbatim
-- register fact joined to a public procurement record, not a derived metric about a person.

-- Normalise a company name for matching: drop the quoting styles declarants use
-- interchangeably („“ " ' `), drop punctuation, uppercase, strip the trailing legal form,
-- collapse whitespace. The legal form must come off BOTH sides: declarants write it into
-- the name ("НИЛСТРОЙ ЕООД") while the TR keeps it in its own legal_form column, so a
-- literal comparison matches only 9.2% of names against 65% after stripping.
--
-- THE ANCHOR IS LOAD-BEARING. An earlier revision used `\s*` before the alternation, which
-- matches ZERO whitespace and therefore truncates any name whose last word merely ENDS in
-- those letters: ГРАД→ГР, ПЛАНЕТ→ПЛАН, МАРКЕТ→МАРК, БОКАД→БОК. That mangled 201,884 of
-- 1,019,272 TR names (19.8%) and defeated gate A outright, because HAVING count(*)=1 then
-- ran on the mangled key: declared "БОК ООД" resolved to the unrelated company БОКАД, and
-- "Травъл План ООД" to ТРАВЪЛ ПЛАНЕТ, both against named declarants. Requiring a preceding
-- space (or the form being the entire string) is what makes gate A mean what it says.
--
-- Consequence accepted: glued spellings like "Смарт ТрейнингЕООД" no longer strip and simply
-- fail to match. A missed link is a non-event; a wrong link is a false accusation.
DROP MATERIALIZED VIEW IF EXISTS declaration_stake_company CASCADE;
-- No DROP FUNCTION here: idx_tr_companies_declared_norm below is an EXPRESSION index over this
-- function, so a DROP would fail (2BP01) on any database that already has it. CREATE OR REPLACE
-- rewrites the body in place and the index is rebuilt from the new definition — same reasoning
-- as the 077/003 DROP removals in CLAUDE.md, arrived at from the index side.
CREATE OR REPLACE FUNCTION declared_company_norm(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(
    btrim(regexp_replace(
      regexp_replace(
        upper(regexp_replace(regexp_replace(COALESCE(p_name, ''), '[„“”"''`.,]', ' ', 'g'),
                             '\s+', ' ', 'g')),
        '(^| )(ЕООД|ООД|ЕАД|АД|АДСИЦ|ЕТ|КД|КДА|СД|ДЗЗД) *$', '', 'g'),
      '\s+', ' ', 'g')),
  '');
$$;

-- WHOSE stake a declared row describes, in ONE place.
--
-- The stored `holder_is_declarant` column below is built from this, and so is the declared
-- SIDE of scripts/person/declared_vs_registry.ts — which cannot read the column, because it
-- counts rows of `declaration_stake`, where no flag exists. That report divides one by the
-- other, so the two sides must apply the same rule or it prints a coverage fraction its own
-- rows are not drawn from. Before this function they were four hand-copied predicates in two
-- SQL strings with no gate on any of them; now there is one definition and a test that the
-- script calls it. Same reason PERSON_GUID_SQL_PATTERN and shlyoRules.ts exist.
--
-- A NULL holder means the declarant: tables 10/11 leave it blank for one's own holding, and
-- the интереси forms (all 3,364 'role' + 125 'sole_trader' rows) have no holder column at all.
CREATE OR REPLACE FUNCTION stake_holder_is_declarant(p_holder text, p_name_fold text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_holder IS NULL OR translit_bg_latin(p_holder) = p_name_fold;
$$;

-- The registry side of the name join, indexed.
--
-- The matview build below pays one sequential pass over ~998k companies either way, which is
-- fine. `person_declared_stake_status` does NOT: it joins on the same expression per REQUEST,
-- and without this index every call re-evaluated four chained regexp_replace over the whole
-- register — measured 20,093 buffers and 1.99 s, against the ~2,000 this repo budgets for a
-- call every profile view makes, on a db-g1-small under a 10 s statement_timeout. With it,
-- 13.8 ms.
--
-- DELIBERATELY NOT IN `LOAD_INDEXES` (scripts/db/load_tr_pg.ts), unlike the eleven secondary
-- indexes that loader drops for the COPY and rebuilds after. Two reasons. It would make the TR
-- load depend on 096's function existing — a routine `db:load:tr:pg:cloud` failing on a
-- database where 096 was never applied is a worse trade than what it buys. And what it buys is
-- small: the expression over the whole indexed population is 2.0 s and the index is 44 MB, on
-- a load that is 34.9 minutes on Cloud SQL. So the COPY maintains it, on purpose.
CREATE INDEX IF NOT EXISTS idx_tr_companies_declared_norm
  ON tr_companies (declared_company_norm(name)) WHERE entity_class = 'company';

-- The resolution layer: one row per (stake row → confirmed EIK).
CREATE MATERIALIZED VIEW declaration_stake_company AS
WITH stake AS (
  SELECT s.declaration_id,
         s.seq,
         s.company_name,
         s.share_size,
         -- WHAT the declarant claimed. A 'role' row is a board seat, not a
         -- holding, and 54% of the интереси rows feeding this matview are roles
         -- — so this must reach the payload or the tile asserts ownership the
         -- filing does not support. See declaration_stake in 089.
         COALESCE(s.stake_kind, 'share') AS stake_kind,
         s.item_type,
         s.value_eur,
         d.person_id,
         -- The period the filing covers. declaration_year = fiscal_year + 1 for an annual
         -- but = fiscal_year for Entry/Vacate/Other, so COALESCE is the only reading that
         -- puts every filing's stake on the year it was actually held.
         COALESCE(d.fiscal_year, d.declaration_year) AS stake_year,
         p.name_fold,
         -- WHOSE holding this is. Tables 10/11 carry a holder per row, and it is NOT always
         -- the declarant: 8,526 of 15,304 stake rows name one and only 4,431 of those are
         -- the filer — the rest are a spouse or a child. Gate B used to ask only whether the
         -- TR placed the DECLARANT at the company, so ~4,095 rows could never be confirmed
         -- no matter how good the evidence for them was.
         --
         -- FOLD EQUALITY, which is exact, so it errs in both directions and only one of them
         -- is safe. A declarant who writes their own name in a VARIANT form — a maiden name
         -- against a hyphenated `person` row, „Адриана Иванова Попова" vs „Адриана Иванова
         -- Попова-Кръстева" — is classed as FAMILY, and their own company drops out of their
         -- own money: 42 rows share the first two name tokens with the declarant and differ
         -- on the fold, of which 3 are published. That is under-attribution, which is the
         -- right way to be wrong here.
         --
         -- The CONVERSE is the residual unsafe path, and gate C cannot see it: a spouse or
         -- child whose three names fold identically to the filer's — a father and son sharing
         -- all three — is classed as OWN, and the second person is typically absent from
         -- `person`, so fold_share still counts n = 1 on the declarant alone. Rare, and the
         -- only way a family holding can still reach the filer's money.
         s.holder_name,
         stake_holder_is_declarant(s.holder_name, p.name_fold) AS holder_is_declarant,
         -- The person the gates below must vouch for. One column so gate B and gate C can
         -- never end up asking about different people — which is the specific way a family
         -- arm goes wrong: confirm the spouse, then check the declarant for namesakes.
         CASE
           WHEN s.holder_name IS NULL THEN p.name_fold
           ELSE translit_bg_latin(s.holder_name)
         END AS confirm_fold,
         declared_company_norm(s.company_name) AS norm
    FROM declaration_stake s
    JOIN declaration d ON d.declaration_id = s.declaration_id
    JOIN person p ON p.person_id = d.person_id
   WHERE s.company_name IS NOT NULL
     AND length(declared_company_norm(s.company_name)) > 2
),
-- Gate A′: every TRADING company bearing this normalised name is a CANDIDATE, and gate B
-- below is what narrows them. The old gate A demanded the name identify exactly one company
-- outright, which threw away the case the registry itself can settle: two active `АКТИВ ГРУП`
-- ЕООД exist, and only one of them has the declared holder as an officer.
--
-- The uniqueness requirement has not been dropped, only MOVED — see `resolved`. A name that
-- stays ambiguous after the footprint check is still dropped, never resolved to a first match.
candidate AS (
  -- The norm is computed ONCE per registry row. Written as `SELECT … WHERE norm IS NOT NULL`
  -- over a subquery rather than repeating the call in both clauses: it is four chained
  -- regexp_replace's over 986,864 companies, and the planner does not fold the second call.
  SELECT norm, uic FROM (
    SELECT declared_company_norm(name) AS norm, uic
      FROM tr_companies
     WHERE entity_class = 'company') z
   WHERE norm IS NOT NULL
),
-- Gate C: how many active people share this folded name. 1 = unambiguous.
fold_share AS (
  SELECT name_fold, count(*) AS n
    FROM person
   WHERE status = 'active'
   GROUP BY 1
),
-- Gate B′: the registry independently places THE DECLARED HOLDER at this candidate EIK —
-- the declarant when they hold it themselves, the named spouse/child when they do not.
confirmed AS (
  SELECT st.*, c.uic
    FROM stake st
    JOIN candidate c ON c.norm = st.norm
   WHERE EXISTS (SELECT 1 FROM tr_person_roles r
                  WHERE r.uic = c.uic AND r.name_fold = st.confirm_fold)
      OR EXISTS (SELECT 1 FROM tr_officers o
                  WHERE o.uic = c.uic AND o.name_fold = st.confirm_fold)
),
-- The uniqueness gate A used to apply to NAMES, applied instead to what survived the
-- registry check. Two companies both bearing the declared name AND both employing someone
-- of the holder's name is not a resolution, it is a coin flip — dropped, as before.
resolved AS (
  SELECT * FROM confirmed cf
   WHERE (SELECT count(*) FROM confirmed x
           WHERE x.declaration_id = cf.declaration_id AND x.seq = cf.seq) = 1
)
SELECT rs.declaration_id,
       rs.seq,
       rs.person_id,
       rs.uic,
       rs.company_name,
       rs.share_size,
       rs.stake_kind,
       rs.item_type,
       rs.value_eur,
       rs.stake_year,
       -- WHOSE it is. Every money consumer must filter on this: a spouse's company is not
       -- the declarant's holding and its contracts are not their public money.
       rs.holder_name,
       rs.holder_is_declarant
  FROM resolved rs
  JOIN fold_share fs ON fs.name_fold = rs.confirm_fold
 -- Gate C, on the SAME person gate B confirmed. `= 1` and not `<= 1`: n = 0 means the
 -- person layer has no row for that name, which is NOT evidence the name is unique — it is
 -- not a census (Моника Любомирова Станишева is an officer at 14 companies and absent from
 -- it entirely). Reading absence as uniqueness would admit 624 holder rows on no evidence.
 --
 -- The price is the same one 096 already pays and names: this drops the `АКТИВ ГРУП` case
 -- that motivated the family arm, because the holder there is exactly such a person. Recall
 -- loss is cheaper than false attribution.
 WHERE fs.n = 1;

CREATE UNIQUE INDEX declaration_stake_company_pkey
  ON declaration_stake_company (declaration_id, seq, uic);
CREATE INDEX idx_stake_company_person ON declaration_stake_company (person_id);
CREATE INDEX idx_stake_company_uic ON declaration_stake_company (uic);

-- One person's confirmed stakes, each with the public contracts its company holds.
--
-- Two money figures, and the distinction is the whole point of "time-aligned":
--   totalEur         — every contract the company has ever signed, for context.
--   whileDeclaredEur — contracts signed while the person declared holding this stake.
-- A company sold in 2015 winning a contract in 2023 lands in the first and not the second,
-- which is exactly the discrimination a reader needs and a naive join loses.
DROP FUNCTION IF EXISTS person_stake_procurement(text);
CREATE OR REPLACE FUNCTION person_stake_procurement(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH pick AS (
    SELECT person_id FROM person
     WHERE slug = p_slug AND status = 'active' AND is_public_figure
     LIMIT 1
  ),
  -- Collapse repeat filings: a person declaring the same company for 8 years is one holding.
  held AS (
    SELECT sc.uic,
           min(sc.stake_year) AS first_year,
           max(sc.stake_year) AS last_year,
           -- The MOST RECENTLY declared share, not max() — share_size is text, so max() is
           -- a lexicographic comparison that returns "50" over "250" and "50 %" over "100 %".
           --
           -- THE SORT KEY MUST BE A TOTAL ORDER, and (stake_year, declaration_id) is not one:
           -- ONE filing can list the same company on several `seq` rows — a share row and a
           -- role row, a "100%" and a "управител", two spellings of the name. 332 own-arm
           -- groups are tied that way and 168 of them DISAGREE on a field collapsed here, so
           -- with the tie unresolved array_agg returns whichever row the scan reached first —
           -- the matview's physical heap order, which every REFRESH rewrites. Measured on the
           -- rows actually served: 8 of 70 flip stake_kind and 7 flip share_size between the
           -- two possible tiebreaks. That is a board seat rendering as a shareholding, under a
           -- conflict-of-interest heading, non-deterministically, on a named person's profile —
           -- the exact claim declaration_events.data.test.ts was written to defend.
           --
           -- All four aggregates carry the SAME key on purpose: they are four fields of ONE
           -- row, and a key that differed between them would compose a stake that was never
           -- declared (one filing's share size against another's kind).
           --
           -- Where a filing declares BOTH a share and a role in one company, both are true and
           -- the tiebreak picks the SHARE. Stated as a rule rather than left to `seq`, which
           -- happens to agree 76 times out of 77 because the form lists shares first — the
           -- heading is an ownership claim, and the role is the lesser included fact.
           -- `seq` last makes the order total: it is unique within a declaration, and a group
           -- is already per (person, company).
           (array_agg(sc.company_name ORDER BY sc.stake_year DESC, sc.declaration_id DESC,
                      (sc.stake_kind = 'share') DESC, sc.seq))[1]
             AS declared_name,
           (array_agg(sc.share_size ORDER BY sc.stake_year DESC, sc.declaration_id DESC,
                      (sc.stake_kind = 'share') DESC, sc.seq))[1]
             AS share_size,
           -- Same "most recently declared" rule as the share size. A person who
           -- declared a shareholding and later a board seat in one company is
           -- described by the LATEST thing they said, not by an aggregate of
           -- both — and never by max(), for the reason above.
           (array_agg(sc.stake_kind ORDER BY sc.stake_year DESC, sc.declaration_id DESC,
                      (sc.stake_kind = 'share') DESC, sc.seq))[1]
             AS stake_kind,
           (array_agg(sc.item_type ORDER BY sc.stake_year DESC, sc.declaration_id DESC,
                      (sc.stake_kind = 'share') DESC, sc.seq))[1]
             AS item_type
      FROM declaration_stake_company sc
      JOIN pick ON pick.person_id = sc.person_id
     -- THE PERSON'S OWN holdings only. The matview also carries stakes the filing
     -- attributes to a spouse or a child, and this function's whole output is money —
     -- contracts the company won, presented as this person's declared interest. A family
     -- row here would publish somebody else's company as theirs, with its public money.
     -- The family arm is served separately; see the holder_is_declarant column.
     WHERE sc.holder_is_declarant
     GROUP BY sc.uic
  ),
  -- Aggregate contracts per company ONCE, then join.
  --
  -- tag = 'contract' — `contracts` also holds 3,487 'contractAmendment' rows (€5.95bn), and
  -- amount_eur is ALREADY the post-annex current value (reference_procurement_current_value),
  -- so counting an annex adds its increase a second time. Every other consumer in the repo
  -- filters this way (004, 006, 007, 010, 011).
  --
  -- The consortium filter: migration 087 stores a joint (обединение / ДЗЗД) award's full value
  -- on the consortium entity and leaves each member firm a €0 PLACEHOLDER row. Counting those
  -- as the firm's own contracts is how a company with no solo take at all came to render
  -- "4 договора · €0" under a conflict-of-interest heading. 011_company_api.sql excludes them
  -- from its headline for the same reason. Here the `WHERE consortium_role IS DISTINCT FROM
  -- 'member'` predicate drops the placeholder rows, so a company whose entire record is
  -- placeholders (or annexes) produces NO `won` group at all and is dropped by the inner
  -- `JOIN won` in the payload build below — no HAVING is needed.
  --
  -- The YEAR is taken from date_signed where the release carries one, falling back to the
  -- OCDS release date: the editorial claim is specifically "while they held the stake", and
  -- the two fields disagree on the year for 6.4% of the corpus.
  won AS (
    SELECT h.uic,
           count(*) AS contract_count,
           round(COALESCE(sum(c.amount_eur), 0)) AS total_eur,
           count(*) FILTER (WHERE yr BETWEEN h.first_year AND h.last_year)
             AS while_declared_count,
           round(COALESCE(sum(c.amount_eur) FILTER (
             WHERE yr BETWEEN h.first_year AND h.last_year), 0)) AS while_declared_eur
      FROM held h
      JOIN contracts c ON c.contractor_eik = h.uic
      CROSS JOIN LATERAL (
        SELECT nullif(left(COALESCE(nullif(c.date_signed, ''), c.date), 4), '') AS y
      ) d
      CROSS JOIN LATERAL (
        SELECT CASE WHEN d.y ~ '^\d{4}$' THEN d.y::int END AS yr
      ) yy
     WHERE c.tag = 'contract'
       AND c.consortium_role IS DISTINCT FROM 'member'
     -- The WHERE does the excluding: a company whose only rows are annexes or €0 member
     -- placeholders produces no group at all, so the JOIN below drops it. No HAVING needed.
     GROUP BY h.uic, h.first_year, h.last_year
  )
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'eik', h.uic,
      -- The REGISTRY's canonical name is the headline, because the EIK is inferred: showing
      -- only the declarant's own spelling hides what the match actually resolved to (the
      -- reverted "БОК ООД" → БОКАД would have been visible at a glance). The declared string
      -- is kept alongside so the reader can compare the two.
      'companyName', (SELECT name FROM tr_companies WHERE uic = h.uic),
      'declaredName', h.declared_name,
      'shareSize', h.share_size,
      -- The tile renders an ownership claim, so it MUST be able to say when a
      -- row is a directorship instead. Sent as the machine value; the label is
      -- the client's, so it can be translated.
      'stakeKind', h.stake_kind,
      'itemType', h.item_type,
      'firstYear', h.first_year,
      'lastYear', h.last_year,
      'contractCount', w.contract_count,
      'totalEur', w.total_eur,
      'whileDeclaredCount', w.while_declared_count,
      'whileDeclaredEur', w.while_declared_eur
    )
    -- Deterministic: rounded sort keys first, then the eik tiebreak, so the payload is
    -- byte-stable across refreshes (reference_pg_payload_determinism).
    ORDER BY w.while_declared_eur DESC, w.total_eur DESC, h.uic)
    FROM held h
    JOIN won w ON w.uic = h.uic
  ), '[]'::jsonb);
$$;

-- ---------------------------------------------------------------------------
-- WHY A DECLARED STAKE IS NOT LINKED — the remainder, with its reason.
--
-- `person_stake_procurement` above publishes the 15.9% of declared stakes that resolve. The
-- other 84.1% are the ones the profile has always shown under „Декларирани дялове (не в
-- Търговския регистър)" as an undifferentiated list, which conflates four different facts
-- about the register and reads as one failure. Measured over the stake rows of active public
-- figures (2026-08-12):
--
--   linked            2,434  15.9%   resolved to one EIK — link it
--   no such company   6,124  40.1%   nothing in the register bears that name at all
--   one candidate     6,260  41.0%   a company of that name exists, but:
--                                      4,818  the declared holder is not recorded there
--                                      1,442  someone of that name IS, and the name is
--                                             shared — gate C will not name a person
--   several           463     3.0%   more than one trading company bears the name
--
-- The plan (person-page-completeness-v1 T4) called for three buckets and predicted 40% in
-- „няма съвпадение в ТР". The 40.1% is exact; what it did not predict is that the LARGEST
-- group is not that one. Folding those 6,260 into "no match in the register" would state
-- something false about a named company — it exists — so the client keeps three visual
-- buckets (linked / not asserted / absent) and this function supplies the reason per row.
--
-- IT RETURNS THE LINKED ROWS TOO, for one reason: the family arm. A spouse's holding resolves
-- to a company that is by definition NOT in the subject's own registry footprint, so the
-- client's name match against that footprint cannot find it and it falls into this same
-- remainder — fully resolved, and otherwise the only row on the list a reader could not click.
--
-- WHAT THIS MUST NOT DO. The unresolved arm is exactly the population 096's gates exist to
-- keep off the page, so no unresolved row may look like a link. `candidates` carries EIKs
-- only for the `ambiguous` reason, where naming them all is the honest move and picking one
-- is the defect; for `unconfirmed` and `namesake` it is empty, because a single named company
-- plus a person's name beside it IS the assertion the gates refuse to make.
--
-- Keyed on the declarant's RAW declared string, never on a normalised form. The client
-- matches it against its own list with its own normaliser, applied to both sides — so the
-- two normalisers never have to agree, which is the failure mode a shared key would invite.
DROP FUNCTION IF EXISTS person_declared_stake_status(text);
CREATE OR REPLACE FUNCTION person_declared_stake_status(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH pick AS (
    SELECT person_id, name_fold FROM person
     WHERE slug = p_slug AND status = 'active' AND is_public_figure
     LIMIT 1
  ),
  -- One row per declared stake, with the name the gates would confirm on.
  st AS (
    SELECT s.declaration_id, s.seq, s.company_name,
           declared_company_norm(s.company_name) AS norm,
           s.holder_name,
           stake_holder_is_declarant(s.holder_name, pk.name_fold) AS holder_is_declarant,
           CASE WHEN s.holder_name IS NULL THEN pk.name_fold
                ELSE translit_bg_latin(s.holder_name) END AS confirm_fold
      FROM declaration_stake s
      JOIN declaration d ON d.declaration_id = s.declaration_id
      JOIN pick pk ON pk.person_id = d.person_id
     WHERE s.company_name IS NOT NULL
       AND length(declared_company_norm(s.company_name)) > 2
  ),
  -- Collapse repeat filings: a person who declared the same company for eight years has one
  -- unresolved company, not eight.
  --
  -- GROUPED BY (norm, confirm_fold), NEVER BY NAME ALONE. Resolution is a function of both:
  -- the same declared name can be refused for the filer and resolved through their spouse,
  -- which is the entire point of T4a's holder arm. Keyed on the name only, `bool_or(linked)`
  -- reported the refused row as `linked` and handed it the spouse's EIK — 192 stake rows, 91
  -- mixed (person, name) groups, 23 of them refusing the SUBJECT'S OWN claim and then
  -- publishing it as their link. Worked example, mp-2647 / „АЛ И КО АД": the register does not
  -- place him there, it places his wife, and the profile anchored the company to him with the
  -- attribution stripped by any_own. A refusal published as a link is the one outcome every
  -- gate in this file exists to prevent.
  byname AS (
    -- Every column qualified `st.`: the LEFT JOIN below brings a second `company_name` and
    -- `holder_name` into scope, and an unqualified one is an ambiguity error at best and the
    -- matview's own copy at worst.
    SELECT st.norm,
           st.confirm_fold,
           min(st.company_name) AS company_name,
           -- Uniform within the group: holder_is_declarant is itself a function of
           -- confirm_fold, so every row here agrees.
           bool_or(st.holder_is_declarant) AS holder_is_declarant,
           -- The RAW holder string, kept even for the declarant's own rows. It is half the
           -- client's join key, and nulling it for own rows (as the first cut did) is what
           -- let a family row and an own row of the same name collide on one key.
           min(st.holder_name) AS holder_name,
           -- min() is safe only because no (person, declared name, holder) group has resolved
           -- to two EIKs. That is ASSERTED, not implied: two family holders of one declared
           -- name, each confirmed at a different company, would both resolve legitimately.
           -- See "one declared name resolves to at most one EIK per holder" in
           -- stake_procurement.data.test.ts — the per-ROW gate above is a different property.
           min(sc.uic) AS uic,
           bool_or(sc.uic IS NOT NULL) AS linked
      FROM st
      LEFT JOIN declaration_stake_company sc
        ON sc.declaration_id = st.declaration_id AND sc.seq = st.seq
     GROUP BY st.norm, st.confirm_fold
  ),
  cand AS (
    SELECT DISTINCT b.norm, c.uic, c.name
      FROM (SELECT DISTINCT norm FROM byname WHERE NOT linked) b
      JOIN tr_companies c
        ON c.entity_class = 'company'
       AND declared_company_norm(c.name) = b.norm
  )
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      -- The declarant's own string, verbatim — half the client's join key.
      'declaredName', b.company_name,
      -- The other half, and the attribution. The RAW holder the filing names, or null when it
      -- named none. `holderIsDeclarant` says which of those two it is, so a consumer never has
      -- to re-derive the fold comparison to know whose holding a row describes.
      'holderName', b.holder_name,
      'holderIsDeclarant', b.holder_is_declarant,
      'reason', CASE
                  WHEN b.linked THEN 'linked'
                  WHEN n.n = 0 THEN 'absent'
                  WHEN n.n > 1 THEN 'ambiguous'
                  WHEN NOT fp.any_footprint THEN 'unconfirmed'
                  -- Gate C refuses on `n <> 1`, so a footprint that did not resolve was
                  -- blocked for one of TWO reasons and they are not the same claim. `n >= 2`
                  -- means the name is shared and we cannot say which person. `n = 0` means
                  -- the person layer holds nobody by that name — 263 of 740 such names, 35.5%
                  -- of the rows — and calling that "shared by more than one person" states
                  -- something about the world that nothing in this database supports.
                  WHEN ps.n_person > 1 THEN 'namesake'
                  ELSE 'unverified'
                END,
      -- The resolved EIK, for 'linked' only.
      'eik', b.uic,
      'companyName', (SELECT name FROM tr_companies WHERE uic = b.uic),
      -- Named ONLY for 'ambiguous'. See the note above: for a single unconfirmed candidate,
      -- printing its EIK beside a person's name is the claim the gates declined to make.
      'candidates', CASE WHEN NOT b.linked AND n.n > 1 THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('eik', c.uic, 'name', c.name) ORDER BY c.uic)
            FROM cand c WHERE c.norm = b.norm
        ), '[]'::jsonb) ELSE '[]'::jsonb END
    ) ORDER BY b.company_name, b.confirm_fold)
    FROM byname b
    CROSS JOIN LATERAL (SELECT count(*) AS n FROM cand c WHERE c.norm = b.norm) n
    CROSS JOIN LATERAL (
      SELECT EXISTS (
        SELECT 1 FROM cand c
         WHERE c.norm = b.norm
           AND (EXISTS (SELECT 1 FROM tr_person_roles r
                         WHERE r.uic = c.uic AND r.name_fold = b.confirm_fold)
             OR EXISTS (SELECT 1 FROM tr_officers o
                         WHERE o.uic = c.uic AND o.name_fold = b.confirm_fold))
      ) AS any_footprint
    ) fp
    CROSS JOIN LATERAL (
      SELECT count(*) AS n_person FROM person p2
       WHERE p2.name_fold = b.confirm_fold AND p2.status = 'active'
    ) ps
  ), '[]'::jsonb);
$$;

-- No GRANT: 096 issues none, deliberately. EXECUTE on a function is granted to PUBLIC by
-- default, and the matview it reads is covered by the readonly role's blanket grant rather
-- than per-file — adding a bare one here would reintroduce exactly the 42704-on-cold-bootstrap
-- shape the role-guard sweep removed from 48 other files.
