// The ЦАИС ЕОП dossier for one procedure — everything the register publishes
// beyond the notice header that `tenders` already carries.
// Backed by /api/db/tender-dossier (migration 146); see
// docs/plans/tender-dossier-ingest-v1.md §5 (A7).
//
// `null` means one of two things and the UI must not conflate them with a third:
// the procedure has not been crawled yet (the capture is built up over a ~26 h
// crawl), or migration 146 has not reached this database. Neither is "the register
// published nothing" — so a null dossier renders NOTHING rather than an empty
// state that would read as a claim about the procurement.

import { useQuery } from "@tanstack/react-query";

/** One published file. The BYTES are not ours — `documentId` is the handle the
 *  redirect route signs on demand (see `tenderDocumentHref`). */
export type TenderDossierDocument = {
  document_id: number;
  /** Where the register published it. */
  source: "attachment" | "announcement" | "export";
  name: string;
  ext: string | null;
  size_bytes: number | null;
  /**
   * Filename-derived classification — `spec`, `documentation`, … or null.
   *
   * ⚠️ DERIVED, NOT A FACT. The register carries no document-type field, so a
   * missing `spec` means "no file is named like one", NEVER "no technical
   * specification was published". Do not render it as the latter.
   */
  kind: string | null;
  created_at: string | null;
};

export type TenderDossierNotice = {
  publication_id: number;
  form_type: string | null;
  notice_no: string | null;
  /** eForms era. ~100% from 2024; 6–36% before, which is why the fields below are
   *  legitimately null for older procedures. */
  is_eforms: boolean;
  bt_count: number;
  buyer_legal_category: string | null;
  buyer_activity: string | null;
  /** null = the notice did not expose criteria. NEVER render as "none". */
  award_criteria: string[] | null;
  selection_criteria: string[] | null;
  /** A BARE NUMBER with no unit — the register prints Ден/Месец in a row the parse
   *  cannot reach. Never label it as days or months. */
  duration_value: string | null;
  offer_deadline_date: string | null;
  offer_deadline_time: string | null;
};

export type TenderDossierAnnouncement = {
  announcement_id: number;
  /** Протокол № 1 / Доклад / Решение за определяне на изпълнител … */
  title: string | null;
  created_at: string | null;
};

export type TenderDossierContract = {
  contract_id: number;
  subject: string | null;
  value_native: number | null;
  current_value_native: number | null;
  start_date: string | null;
  end_date: string | null;
  suppliers: { name: string | null; eik: string | null }[];
};

export type TenderDossierBuyer = {
  organization_id: number;
  eik: string | null;
  name: string | null;
  city: string | null;
  postcode: string | null;
  street: string | null;
};

export type TenderDossier = {
  unp: string;
  tender_id: number;
  organization_id: number | null;
  /** The long "Кратко описание" — mean ~1.6k chars against tenders.subject's 138. */
  description_text: string | null;
  offer_phase_start: string | null;
  offer_phase_end: string | null;
  opening_of_offers: string | null;
  /** The register's own page for this procedure — where every document lives. */
  source_url: string | null;
  documents: TenderDossierDocument[];
  notices: TenderDossierNotice[];
  announcements: TenderDossierAnnouncement[];
  contracts: TenderDossierContract[];
  buyer: TenderDossierBuyer | null;
};

const fetchDossier = async (unp: string): Promise<TenderDossier | null> => {
  const res = await fetch(
    `/api/db/tender-dossier?unp=${encodeURIComponent(unp)}`,
  );
  // ⚠️ THROW, don't return null. `null` already means "no dossier for this
  // procedure"; mapping a transport failure onto it adds a THIRD meaning, and with
  // staleTime: Infinity a single 429 or cold-start 500 would hide a populated panel
  // for the rest of the session with no retry and nothing visible. The sibling
  // useTenderNormalcy throws here for the same reason.
  if (!res.ok) throw new Error(`tender-dossier ${res.status}`);
  return (await res.json()) as TenderDossier | null;
};

export const useTenderDossier = (unp: string | null | undefined) =>
  useQuery({
    queryKey: ["procurement", "tender-dossier", unp] as const,
    queryFn: () => fetchDossier(unp as string),
    enabled: !!unp,
    staleTime: Infinity,
  });

/**
 * Link to one document.
 *
 * Goes through our redirect route rather than straight to storage.eop.bg, because
 * the register's URLs are signed and expire in 30 minutes — there is no stable URL
 * to put in an href. The route validates the id against `tender_document` before
 * signing, so this cannot be used to launder an arbitrary register document
 * through our domain.
 */
export const tenderDocumentHref = (documentId: number): string =>
  `/api/db/tender-document?id=${documentId}`;
