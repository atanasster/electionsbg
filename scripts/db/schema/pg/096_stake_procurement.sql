-- 096_stake_procurement.sql — declared company stakes that hold public contracts (audit T3.8).
--
-- "An official declared owning company X; company X holds public contracts" is the most
-- legible conflict-of-interest signal in the corpus. It is also the easiest one to get
-- catastrophically wrong, because THE DECLARATION FORM CARRIES NO EIK.
--
-- Tables 10/11 record a company NAME and a registered office, nothing more —
-- declaration_stake.uic is 100% NULL across all 7,824 stake rows and always will be; the
-- column exists for a source that turned out not to supply it. So every link from a
-- declared stake to a contractor has to be RESOLVED, and a wrong resolution publishes
-- "this official's company won public money" against a named person who owns no such thing.
--
-- Hence three deliberately narrow gates. A row is published only when ALL hold:
--
--   A. NAME UNIQUENESS — the normalised declared name matches exactly one TRADING company
--      in the Търговски регистър (entity_class='company': the register also holds ~31k NGOs,
--      читалища, cooperatives and foreign branches, and a declared ООД resolving against an
--      association is a false match that also inflates the ambiguity denominator).
--      Ambiguous names are DROPPED, never resolved to a first match.
--
--   B. INDEPENDENT CONFIRMATION — the TR itself records the declarant at that exact EIK, as
--      an owner (tr_person_roles) or an officer (tr_officers), matched on name_fold. The link
--      then rests on two independent sources that agree (the person said so on their
--      declaration, and the state registry says so of its own accord), not on a string
--      similarity.
--
--   C. IDENTITY UNAMBIGUITY — the declarant's folded name is NOT shared by two or more active
--      `person` records. This gate exists because B is a name_fold match and name_fold carries
--      no birth date and no EGN: when seven distinct people fold to "Георги Иванов Славов",
--      the registry row at that EIK may belong to any of them, and gate B confirms nothing.
--      Publishing under those conditions attributes a company — and its public money — to
--      whichever namesake we happen to hold a declaration for. It costs real recall (14 of
--      39 otherwise-servable person/company pairs, 36%) and that is the correct price:
--      recall loss is cheaper than false attribution. See person.namesake_risk (082), which
--      the site already maintains for exactly this "name match — identity not verified" case.
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
DROP FUNCTION IF EXISTS declared_company_norm(text);
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

-- The resolution layer: one row per (stake row → confirmed EIK).
CREATE MATERIALIZED VIEW declaration_stake_company AS
WITH stake AS (
  SELECT s.declaration_id,
         s.seq,
         s.company_name,
         s.share_size,
         s.value_eur,
         d.person_id,
         -- The period the filing covers. declaration_year = fiscal_year + 1 for an annual
         -- but = fiscal_year for Entry/Vacate/Other, so COALESCE is the only reading that
         -- puts every filing's stake on the year it was actually held.
         COALESCE(d.fiscal_year, d.declaration_year) AS stake_year,
         p.name_fold,
         declared_company_norm(s.company_name) AS norm
    FROM declaration_stake s
    JOIN declaration d ON d.declaration_id = s.declaration_id
    JOIN person p ON p.person_id = d.person_id
   WHERE s.company_name IS NOT NULL
     AND length(declared_company_norm(s.company_name)) > 2
),
-- Gate A: exactly one TRADING company bears this normalised name. HAVING count(*) = 1 is
-- what drops the ambiguous names rather than picking one.
unique_name AS (
  SELECT declared_company_norm(name) AS norm, min(uic) AS uic
    FROM tr_companies
   WHERE entity_class = 'company'
     AND declared_company_norm(name) IS NOT NULL
   GROUP BY 1
  HAVING count(*) = 1
),
-- Gate C: how many active people share this folded name. 1 = unambiguous.
fold_share AS (
  SELECT name_fold, count(*) AS n
    FROM person
   WHERE status = 'active'
   GROUP BY 1
)
SELECT st.declaration_id,
       st.seq,
       st.person_id,
       un.uic,
       st.company_name,
       st.share_size,
       st.value_eur,
       st.stake_year
  FROM stake st
  JOIN unique_name un ON un.norm = st.norm
  JOIN fold_share fs ON fs.name_fold = st.name_fold
 -- Gate C: no namesake ambiguity, so gate B's name match identifies one person.
 WHERE fs.n = 1
 -- Gate B: the registry independently places this person at this EIK.
   AND (EXISTS (SELECT 1 FROM tr_person_roles r
                 WHERE r.uic = un.uic AND r.name_fold = st.name_fold)
     OR EXISTS (SELECT 1 FROM tr_officers o
                 WHERE o.uic = un.uic AND o.name_fold = st.name_fold));

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
           (array_agg(sc.company_name ORDER BY sc.stake_year DESC, sc.declaration_id DESC))[1]
             AS declared_name,
           (array_agg(sc.share_size ORDER BY sc.stake_year DESC, sc.declaration_id DESC))[1]
             AS share_size
      FROM declaration_stake_company sc
      JOIN pick ON pick.person_id = sc.person_id
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
  -- from its headline for the same reason; the HAVING is what stops a pure-placeholder company
  -- from the same 011_company_api.sql headline for the same reason; a company whose entire
  -- record is placeholders therefore never surfaces here.
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
