-- Single-tender detail for /tenders/:unp and the contract→tender lineage tile
-- on /procurement/contract/:id. Returns the FE `Tender` shape (camelCase, lots
-- included — the lots jsonb is stored camelCase by the loader) plus the signed
-- contract(s) the procedure produced, in one call. Replaces the sha256-sharded
-- tenders/by-tender/ and by-ocid/ JSON readers.
--
-- QUARANTINE: estimatedValue* are a FORECAST (прогнозна стойност) — surfaced
-- as such, never summed into awarded totals.
-- Depends on tenders (009) + contracts (001). EXECUTE → app_readonly.

SET check_function_bodies = off;

DROP FUNCTION IF EXISTS tender_detail(text, text);
CREATE OR REPLACE FUNCTION tender_detail(
  p_unp text DEFAULT NULL,
  p_ocid text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH t AS (
  SELECT * FROM tenders
  WHERE (p_unp IS NOT NULL AND p_unp <> '' AND unp = p_unp)
     OR (p_ocid IS NOT NULL AND p_ocid <> '' AND ocid = p_ocid)
  ORDER BY publication_date DESC
  LIMIT 1
)
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM t) THEN jsonb_build_object(
  'tender', NULL, 'awards', '[]'::jsonb
) ELSE (
  SELECT jsonb_build_object(
    'tender', jsonb_strip_nulls(jsonb_build_object(
      'unp', t.unp,
      'ocid', t.ocid,
      'tenderId', t.tender_id,
      'noticeId', t.notice_id,
      'publicationDate', t.publication_date,
      'buyerEik', t.buyer_eik,
      'buyerName', t.buyer_name,
      'buyerType', t.buyer_type,
      'buyerMainActivity', t.buyer_main_activity,
      'subject', t.subject,
      'noticeType', t.notice_type,
      'procedureType', t.procedure_type,
      'awardMethod', t.award_method,
      'legalBasis', t.legal_basis,
      'contractType', t.contract_type,
      'cpv', t.cpv,
      'cpvDesc', t.cpv_desc,
      'estimatedValueNative', t.estimated_value_native,
      'currency', t.currency,
      'estimatedValueEur', t.estimated_value_eur,
      'lotsCount', t.lots_count,
      'lots', COALESCE(t.lots, '[]'::jsonb),
      'submissionDeadline', t.submission_deadline,
      'isCancelled', t.is_cancelled,
      'isFrameworkAgreement', t.is_framework_agreement,
      'isEuFunded', t.is_eu_funded,
      'euProgram', t.eu_program,
      'hasUnsecuredFunding', t.has_unsecured_funding,
      'nuts', t.nuts,
      'linkToOjEu', t.link_to_oj_eu,
      'changeNoticeCount', t.change_notice_count,
      'sourceDay', t.source_day,
      'sourceUrl', t.source_url
    )),
    'awards', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'key', c.key,
        'contractorEik', c.contractor_eik,
        'contractorName', c.contractor_name,
        'amountEur', c.amount_eur,
        'dateSigned', c.date_signed,
        'tag', c.tag,
        'title', c.title
      ) ORDER BY c.tag, c.date_signed NULLS LAST, c.key), '[]'::jsonb)
      FROM contracts c
      WHERE t.ocid IS NOT NULL AND c.ocid = t.ocid
    )
  ) FROM t
) END;
$$;
