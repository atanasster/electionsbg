-- The ЦАИС ЕОП per-procedure DOSSIER — docs/plans/tender-dossier-ingest-v1.md §5 (A6).
--
-- What `tenders` already holds is the notice HEADER: subject, buyer, estimated value,
-- deadline. This is everything else the register publishes about the same procedure —
-- the long description, the contact officer, the attachment MANIFEST, the parsed
-- обявление, the award-stage trail, contract lineage, and the buyer's address.
--
-- ⚠️ NUMBER 146, not the 132 the plan names. 132 was assumed free when the plan was
-- written and is long taken; the plan itself flagged "verify at branch time".
--
-- ⚠️ EVERY MONEY COLUMN IS double precision, NEVER numeric. node-postgres serialises
-- a PG `numeric` as a STRING, so a numeric column renders BLANK in the UI while the
-- value is present in the payload — invisible to every row count and to any assertion
-- made through SQL. Same rule as 120's net_worth_eur / public_money_eur.
--
-- ⚠️ NOTHING HERE STORES DOCUMENT BYTES. `tender_document` is a manifest plus the
-- coordinates needed to re-mint a signed URL on demand; `tender_document_text` holds
-- extracted text only. The 3.65 TB blob tier was dropped (plan §12) — 25 GB of free
-- disk against it — in favour of linking out to app.eop.bg.

-- ---------------------------------------------------------------------------
-- One row per procedure.
CREATE TABLE IF NOT EXISTS tender_dossier (
  unp               text PRIMARY KEY,
  tender_id         integer NOT NULL,
  organization_id   integer,            -- joins tender_buyer_profile
  description_text  text,               -- "Кратко описание": mean 1,633 chars vs
                                        -- tenders.subject's 138. The reason A5 exists.
  contact_name      text,
  contact_email     text,
  contact_phone     text,
  offer_phase_start timestamptz,
  offer_phase_end   timestamptz,        -- past this the dossier is IMMUTABLE; before
                                        -- it, documents can still be replaced.
  opening_of_offers timestamptz,
  tender_guid       text,
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  source_url        text
);
CREATE INDEX IF NOT EXISTS idx_tender_dossier_tender_id ON tender_dossier(tender_id);
CREATE INDEX IF NOT EXISTS idx_tender_dossier_org ON tender_dossier(organization_id);

-- ---------------------------------------------------------------------------
-- The attachment manifest. One row per published file, WITHOUT the file.
CREATE TABLE IF NOT EXISTS tender_document (
  document_id  bigint PRIMARY KEY,
  unp          text NOT NULL,
  tender_id    integer,
  -- Where the register published it: the tender's own attachments, an award-stage
  -- announcement, or an export pack. Announcement documents live in a DIFFERENT
  -- blob container from the tender's own (containers are per-uploader), which is
  -- why the container is stored per row rather than per tender.
  source       text NOT NULL CHECK (source IN ('attachment','announcement','export')),
  name         text NOT NULL,
  ext          text,
  mime         text,
  size_bytes   bigint,
  md5          text,
  container    text,
  cloud_name   text,
  -- Filename-derived classification. NULLABLE AND DERIVED: the register carries no
  -- document-type field, and the spec pattern hits ~68-71% of tenders. `spec IS NULL`
  -- means "not named like one", NEVER "no specification was published" — see
  -- eop_doc_kind.ts. A9's risk signal is phrased against this whole manifest, not
  -- against the classifier.
  kind         text,
  is_previous_version boolean,
  previous_version_id bigint,
  created_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_tender_document_unp ON tender_document(unp);
CREATE INDEX IF NOT EXISTS idx_tender_document_kind ON tender_document(unp, kind);
CREATE INDEX IF NOT EXISTS idx_tender_document_md5 ON tender_document(md5) WHERE md5 IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The parsed обявление / решение. One row per publication, several per procedure.
CREATE TABLE IF NOT EXISTS tender_notice (
  publication_id bigint PRIMARY KEY,
  unp            text NOT NULL,
  tender_id      integer,
  form_type      text,
  notice_no      text,
  -- TRUE when the notice carries eForms BT codes at all. ~100% from 2024, 6-36%
  -- before that (plan §1.2), so this column IS the era discriminator — and the
  -- reason the fields below may legitimately be NULL for a whole era.
  is_eforms      boolean NOT NULL DEFAULT false,
  bt_count       integer NOT NULL DEFAULT 0,
  -- Structured fields, all nullable BY DESIGN. On a legacy notice almost every one
  -- is NULL, and that is the honest answer; a default here would read as "awarded on
  -- price alone" or "no award criteria" for three years of procedures.
  buyer_legal_category text,
  buyer_activity       text,
  award_criteria       text[],   -- BT-539-Lot, one per criterion per lot
  selection_criteria   text[],   -- BT-809-Lot
  -- BARE NUMBER, no unit — the register prints Ден/Месец in a sibling row the parse
  -- cannot reach. Never render as days or months, and never compare two procedures
  -- on it: 60 may be days on one and months on the next.
  duration_value  text,
  offer_deadline_date text,      -- BT-131(d)-Lot
  offer_deadline_time text,      -- BT-131(t)-Lot
  -- Full visible text, for the B3 search index.
  text            text,
  -- Every label/code/value triple, so a field we did not model is still recoverable
  -- without a re-crawl.
  pairs           jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_tender_notice_unp ON tender_notice(unp);

-- ---------------------------------------------------------------------------
-- The award-stage trail: протоколи, доклади, решения. Titles and dates only —
-- the PDFs are linked, not stored (plan §12; ~50% of them are scans anyway).
CREATE TABLE IF NOT EXISTS tender_announcement (
  announcement_id bigint PRIMARY KEY,
  unp             text NOT NULL,
  tender_id       integer,
  title           text,
  body_text       text,
  created_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_tender_announcement_unp ON tender_announcement(unp, created_at);

-- ---------------------------------------------------------------------------
-- Contract lineage straight from the register. An INDEPENDENT source for the
-- post-annex current value that `procurement_annexes` (114) also models — A8
-- reconciles them rather than shipping two disagreeing figures.
CREATE TABLE IF NOT EXISTS tender_contract_item (
  contract_id     bigint PRIMARY KEY,
  unp             text NOT NULL,
  tender_id       integer,
  subject         text,
  value_native    double precision,
  current_value_native double precision,
  currency_code   integer,
  start_date      timestamptz,
  end_date        timestamptz,
  current_start_date timestamptz,
  current_end_date   timestamptz,
  suppliers       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{name, eik}]
  annexes         jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_tender_contract_item_unp ON tender_contract_item(unp);

-- ---------------------------------------------------------------------------
-- Buyer profile. Carries the ADDRESS the flat ЦАИС feed omits, which is why those
-- awarders never resolve to an EKATTE and vanish from the by-settlement map.
CREATE TABLE IF NOT EXISTS tender_buyer_profile (
  organization_id  integer PRIMARY KEY,
  eik              text,
  name             text,
  city             text,
  postcode         text,
  street           text,
  nuts_id          integer,
  batch_number     text,
  -- The register's own count of what it has published for this buyer.
  -- ⚠️ NOT a completeness canary: measured against our corpus it disagreed with the
  -- id-space walk by 6x (plan §10.4). Stored for provenance, not for arithmetic.
  total_published_tenders integer,
  related_orgs     jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_tender_buyer_profile_eik ON tender_buyer_profile(eik);

-- ---------------------------------------------------------------------------
-- Tier B: extracted document text. Keyed on the register's MD5, because the same
-- bytes are republished under new documentIds.
CREATE TABLE IF NOT EXISTS tender_document_text (
  md5          text PRIMARY KEY,
  document_id  bigint NOT NULL,
  name         text,
  ext          text,
  size_bytes   bigint,
  -- 0 means the extractor RAN and found no text layer (8.5% of real specs are
  -- scans). It never means "not attempted" — a failure is absent from this table.
  chars        integer NOT NULL,
  pages        integer,
  extractor    text,
  extractor_version text,
  text         text
);
CREATE INDEX IF NOT EXISTS idx_tender_document_text_doc ON tender_document_text(document_id);
