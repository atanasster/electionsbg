// Dev-only deep links to SIGMA (sigma.midt.bg), the government procurement
// mirror, for manually spot-checking our figures against theirs during data QA.
//
// These are NEVER rendered in production — every call site gates on
// `import.meta.env.DEV`. SIGMA is a competing platform whose annex-value and
// consortium accounting frequently disagree with ours (see the procurement↔SIGMA
// parity audits: annex ÷1.95583 double-conversion, consortia booked under union
// "…и др." entities), so these links are strictly an internal comparison aid, not
// a user-facing "verify us" affordance.
const SIGMA_BASE = "https://sigma.midt.bg";

/** Buyer/institution page. Keyed by EIK — same identifier we use for /awarder/:eik. */
export const sigmaAuthorityUrl = (eik: string): string =>
  `${SIGMA_BASE}/authorities/${encodeURIComponent(eik)}`;

/** Bidder/company page. Keyed by EIK — same identifier we use for /company/:eik. */
export const sigmaCompanyUrl = (eik: string): string =>
  `${SIGMA_BASE}/companies/${encodeURIComponent(eik)}`;

/**
 * The SIGMA contract id = our `cais_id`: the standard УНП when present, else the
 * ЦАИС T-id recovered from the ocid. Mirrors the cais_id derivation proven in the
 * parity audit (`sigma.unp === contracts.cais_id`):
 *   - unp                    → the УНП as-is (e.g. "00044-2024-0047")
 *   - ocid "eop-T78923"      → "T78923"
 *   - ocid "ocds-e82gsb-566491" → "T566491"
 *   - legacy АОП rows        → null (SIGMA has no page for them)
 */
export const sigmaContractId = (
  unp: string | null | undefined,
  ocid: string | null | undefined,
): string | null => {
  if (unp) return unp;
  if (!ocid) return null;
  const eopT = /^eop-(T\d+)$/.exec(ocid);
  if (eopT) return eopT[1];
  const ocds = /^ocds-e82gsb-(\d+)$/.exec(ocid);
  if (ocds) return `T${ocds[1]}`;
  return null;
};

/** Contract page for an id from {@link sigmaContractId}. */
export const sigmaContractUrl = (id: string): string =>
  `${SIGMA_BASE}/contracts/${encodeURIComponent(id)}`;
