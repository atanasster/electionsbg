-- НЗОК hospital-payment COVERAGE — one row per (stream, period) the listing offered,
-- whether or not we published it.
--
-- Tier 0 of docs/plans/nzok-hospital-parser-hardening-v1.md. The corpus was missing
-- 24 of 127 published months and every surface said nothing: the loader caught each
-- refusal, printed one truncated line and exited 0, so a month the site did not have
-- was indistinguishable from a month НЗОК never published. This table is the repo's
-- established answer to that shape — `ted_coverage`, `aop_expert_coverage`,
-- `isun_clean_delivery_coverage` — an omission as a queryable fact rather than
-- stdout.
--
-- ⚠️ A REFUSED month still carries НЗОК's own figures. Every completeness assert
-- fires after the period and the grand-total line are read, so `header_total_eur`
-- states what НЗОК says the month was worth even when we publish no facility rows
-- for it. That is the difference between "we are missing €51.4m of devices" and "we
-- are missing something". Measured: the header parsed correctly in 23 of the 24
-- files the old asserts rejected.
--
-- ⚠️ `status = 'loaded'` is NOT the same as "fully verified", and the four columns
-- after it are why. A month can load with blocks whose printed facility count
-- disagrees with the „№ по ред" ordinals (НЗОК's own bookkeeping — the count means
-- LISTED facilities in 2023 and PAID ones from 2024), or with blocks that print no
-- subtotal at all, whose money is reconciled by nothing but the whole-file 0.5%
-- ratio — the check that let €1,672,123 of wrong money through before this work.
-- A consumer reading only `status` would call those months clean.

CREATE TABLE IF NOT EXISTS nzok_payment_coverage (
  -- 'bmp' | 'drugs' | 'devices' — the three reports НЗОК publishes per month on one
  -- listing page. A hospital's НЗОК income is their sum, so a stream missing a month
  -- understates every facility in it.
  stream                text NOT NULL,
  -- Constrained like `nzok_hospital_payments.stream` (050). Without it a typo
  -- becomes a fourth key in `byStream` below and reads as a report НЗОК publishes.
  CONSTRAINT nzok_payment_coverage_stream
    CHECK (stream IN ('bmp', 'drugs', 'devices')),
  period                date NOT NULL,
  -- 'loaded'   — per-facility rows are in nzok_hospital_payments for this month.
  -- 'refused'  — a completeness assert fired; NO rows were published. `reason` says
  --              which, and the header_* columns still say what НЗОК claimed.
  status                text NOT NULL,
  CONSTRAINT nzok_payment_coverage_status
    CHECK (status IN ('loaded', 'refused')),

  -- ── НЗОК's own claim about the month, from its grand-total line.
  header_facility_count integer,
  header_total_eur      bigint,

  -- ── What we published. Zero on a refusal, and the CHECK is what makes that a
  -- fact rather than a comment: a refused row carrying rows_loaded > 0 would say
  -- the month was both withheld and published.
  --
  -- ⚠️ `bigint` comes back from node-postgres as a STRING on a direct SELECT and as
  -- a NUMBER through the jsonb function below. Read it through the function, or
  -- coerce — the `numeric`-as-string trap CLAUDE.md documents applies here too.
  rows_loaded           integer NOT NULL DEFAULT 0,
  rows_total_eur        bigint  NOT NULL DEFAULT 0,
  CONSTRAINT nzok_payment_coverage_refused_publishes_nothing
    CHECK (status <> 'refused' OR (rows_loaded = 0 AND rows_total_eur = 0)),

  -- ── Why a month is absent. NULL exactly when status = 'loaded'.
  reason                text,
  CONSTRAINT nzok_payment_coverage_reason
    CHECK ((status = 'refused') = (reason IS NOT NULL)),

  -- ── What loaded but could NOT be fully verified. All zero is the clean case.
  -- Blocks whose printed facility count disagrees with the ordinals seen, and the
  -- ordinals that are absent or extra. Descriptive: watch the trend, not the value.
  --
  -- ⚠️ NULLABLE, and NULL on a refused month — 0 means "checked and clean", and
  -- nothing was checked there because the refusal fired first. Storing 0 would
  -- state that a withheld month's blocks all reconcile.
  count_mismatch_blocks integer,
  count_mismatch_ordinals integer,
  -- Blocks НЗОК printed no subtotal for. Their money is NOT block-reconciled.
  unreconciled_blocks   integer,
  unreconciled_eur      bigint,
  CONSTRAINT nzok_payment_coverage_verification_known
    CHECK ((status = 'loaded') = (count_mismatch_blocks IS NOT NULL)),

  -- ── The month repeats its immediate predecessor's year-to-date with every
  -- facility's month column at zero (RC-5). Published as НЗОК filed it — a zero
  -- month is a fact НЗОК put its name to — but a reader comparing the two months
  -- sees no payments at all in the later, so it must never be published unlabelled.
  -- Holds the period it repeats; NULL is the normal case.
  republishes_period    date,

  loaded_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stream, period)
);

COMMENT ON TABLE nzok_payment_coverage IS
  'Per (stream, period): whether НЗОК''s monthly hospital-payment report was published, '
  'what НЗОК itself said it was worth, and what about it could not be verified. '
  'A refused month keeps its header figures so the omission can be sized.';

-- Role-guarded, per the 117/130 shape: `roles_readonly.sql` may not have run on the
-- target, and a bare GRANT then raises 42704 and rolls the whole file back — leaving
-- no table at all rather than a table without an ACL. See CLAUDE.md, db:pg:bootstrap.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON nzok_payment_coverage TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — nzok_payment_coverage ships with no ACL.';
  END IF;
END $$;

-- The month a reader is actually looking at, per stream, and what is behind it.
--
-- ⚠️ Each stream at its OWN latest period, matching `nzok_hospital_payments_latest_rows`
-- (050/065). The three reports publish on their own cadences, so pinning them to one
-- date silently drops a lagging stream's money; taking each at its own latest keeps
-- the totals whole and makes the LAG the thing a surface has to state. Measured
-- before this work: devices lagged bmp by five months and €32,312,935 of devices
-- money — 62.9% of that stream — was simply absent from the page with nothing saying so.
CREATE OR REPLACE FUNCTION nzok_payment_coverage_latest()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  -- ⚠️ Every stream that appears AT ALL, not only those with a loaded month. A
  -- stream whose months were all refused would otherwise vanish from `byStream`,
  -- and a consumer reading it as "the streams we have" would never learn the
  -- stream exists — the same silence this table exists to break. Such a stream
  -- appears with a null `period`.
  WITH streams AS (SELECT DISTINCT stream FROM nzok_payment_coverage),
  latest AS (
    SELECT DISTINCT ON (stream) *
    FROM nzok_payment_coverage
    WHERE status = 'loaded'
    ORDER BY stream, period DESC
  )
  SELECT jsonb_build_object(
    'byStream', COALESCE(
      (SELECT jsonb_object_agg(s.stream, jsonb_build_object(
                'period', to_char(l.period, 'YYYY-MM'),
                'rowsLoaded', l.rows_loaded,
                'totalEur', l.rows_total_eur,
                'republishesPeriod', to_char(l.republishes_period, 'YYYY-MM'),
                'countMismatchBlocks', l.count_mismatch_blocks,
                'unreconciledBlocks', l.unreconciled_blocks,
                'unreconciledEur', l.unreconciled_eur,
                -- When this claim was made. A completeness statement with no date
                -- cannot be told from a stale one.
                'loadedAt', to_char(l.loaded_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')))
       FROM streams s LEFT JOIN latest l ON l.stream = s.stream), '{}'::jsonb),
    -- Months the site does NOT have, with what НЗОК says they were worth. Empty is
    -- the expected state; a non-empty array is a hole a reader is entitled to know
    -- about, not a backlog note.
    'refused', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'stream', stream,
                'period', to_char(period, 'YYYY-MM'),
                'headerTotalEur', header_total_eur,
                'reason', reason)
              ORDER BY stream, period)
       FROM nzok_payment_coverage WHERE status = 'refused'), '[]'::jsonb)
  );
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION nzok_payment_coverage_latest() TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — nzok_payment_coverage_latest() ships with no ACL.';
  END IF;
END $$;
