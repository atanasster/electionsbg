-- АДФИ — Агенция за държавна финансова инспекция (plan P7): who has been
-- financially inspected, on what statutory basis, and when.
--
-- „Has this buyer ever been inspected" is a cheap, strong column on
-- /awarder/:eik, and АДФИ is the body procurement complaints get referred to.
--
-- ⚠️ THE SOURCE CARRIES NO ЕИК — the inspected body is free text („Община
-- Неделино - гр. Неделино"). `subject_eik` is therefore a NAME MATCH and is
-- NULL wherever the name could not be resolved unambiguously. An inspection
-- attributed to the wrong municipality is a false accusation against a named
-- public body, so the resolver refuses rather than grades, exactly as the ДКИ
-- register does.
--
-- ⚠️ COVERAGE STARTS 2024-02-09 AND THAT IS NOT A DATA GAP TO BE FILLED
-- SILENTLY. АДФИ publishes earlier inspections only as bare PDF links with no
-- subject column, so „no inspection found" for a buyer means „none since
-- Feb 2024", never „never inspected". `adfi_coverage` holds the floor so a
-- surface can say which.

CREATE TABLE IF NOT EXISTS adfi_inspection (
  report_url   text PRIMARY KEY,
  report_file  text NOT NULL,
  subject      text NOT NULL,
  -- Resolved by name; NULL means „could not be resolved", never „not a buyer".
  subject_eik  text,
  legal_basis  text,
  published_at date,
  loaded_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adfi_inspection_eik  ON adfi_inspection (subject_eik);
CREATE INDEX IF NOT EXISTS idx_adfi_inspection_date ON adfi_inspection (published_at);

CREATE TABLE IF NOT EXISTS adfi_coverage (
  covered_from date PRIMARY KEY,
  note         text NOT NULL,
  loaded_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON adfi_inspection, adfi_coverage TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — adfi_inspection/adfi_coverage ship with no ACL.';
  END IF;
END $$;

-- Inspections of one buyer.
--
-- ⚠️ Returns the COVERAGE FLOOR alongside the rows so a caller cannot render an
-- empty result as „never inspected". That distinction is the whole reason the
-- floor is stored.
CREATE OR REPLACE FUNCTION adfi_for_buyer(p_eik text)
RETURNS TABLE (
  report_file text,
  report_url text,
  subject text,
  legal_basis text,
  published_at date,
  covered_from date
)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT i.report_file, i.report_url, i.subject, i.legal_basis, i.published_at,
         (SELECT min(c.covered_from) FROM adfi_coverage c)
    FROM adfi_inspection i
   WHERE i.subject_eik = p_eik
   ORDER BY i.published_at DESC;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION adfi_for_buyer(text) TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — adfi_for_buyer ships with no ACL.';
  END IF;
END $$;
