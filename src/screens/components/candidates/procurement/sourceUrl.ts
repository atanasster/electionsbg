// Resolve a contract row to the canonical public URL of its underlying
// procurement procedure. Two cases:
//
//   - OCDS row (2026+ data, OCID like `ocds-e82gsb-<id>`): CAIS ЕОП is the
//     authoritative public registry — the procurement notice, full timeline,
//     decisions, documents. URL pattern: https://app.eop.bg/today/<id>.
//
//   - Legacy row (pre-2026 annual CSV ingest, OCID like `aop-legacy-<year>-<docId>`):
//     CAIS ЕОП doesn't track these — they're from the older РОП system whose
//     per-contract permalinks are no longer reliable. We fall back to the
//     data.egov.bg dataset page (the row's bundleUuid), which is the closest
//     public source we can offer.

import type { ProcurementContract } from "@/data/dataTypes";

export interface ContractSourceLink {
  url: string;
  label: "eop" | "egov";
}

const OCDS_PROCEDURE = /^ocds-e82gsb-(\d+)/;

export const resolveContractSource = (
  c: Pick<ProcurementContract, "ocid" | "sourceUrl" | "bundleUuid">,
): ContractSourceLink => {
  const m = c.ocid?.match(OCDS_PROCEDURE);
  if (m) {
    return { url: `https://app.eop.bg/today/${m[1]}`, label: "eop" };
  }
  // Legacy or unknown — fall back to the dataset link the ingest stored.
  // c.sourceUrl is `https://data.egov.bg/data/view/<bundleUuid>#<releaseId>`;
  // strip the hash for the legacy case since the release id is meaningless
  // on the older datasets.
  return {
    url: c.bundleUuid
      ? `https://data.egov.bg/data/view/${c.bundleUuid}`
      : c.sourceUrl,
    label: "egov",
  };
};
