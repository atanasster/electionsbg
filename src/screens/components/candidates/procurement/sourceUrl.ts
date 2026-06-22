// Resolve a contract row to the canonical public URL of its underlying
// procurement procedure. Three cases:
//
//   - OCDS row (data.egov.bg OCDS export, OCID like `ocds-e82gsb-<id>`): CAIS
//     ЕОП is the authoritative public registry — the procurement notice, full
//     timeline, decisions, documents. The `<id>` IS the portal's numeric
//     procedure id, so URL pattern: https://app.eop.bg/today/<id>.
//
//   - ЦАИС ЕОП flat open-data row (OCID like `eop-<УНП>` or `eop-T<contractNo>`):
//     ingested from the daily flat-договори open-data files on storage.eop.bg.
//     The public portal has no per-contract permalink reachable from a УНП or
//     a contract number (only its internal numeric procedure id works in
//     /today/<id>, which we don't carry), so the authoritative source we can
//     link is the live daily open-data file the row came from (c.sourceUrl).
//
//   - Legacy row (pre-2026 annual CSV ingest, OCID like `aop-legacy-<year>-<docId>`):
//     CAIS ЕОП doesn't track these — they're from the older РОП system whose
//     per-contract permalinks are no longer reliable. We fall back to the
//     data.egov.bg dataset page (the row's bundleUuid), which is the closest
//     public source we can offer.

import type { ProcurementContract } from "@/data/dataTypes";

export interface ContractSourceLink {
  url: string;
  label: "eop" | "eop-data" | "egov";
}

const OCDS_PROCEDURE = /^ocds-e82gsb-(\d+)/;

export const resolveContractSource = (
  c: Pick<ProcurementContract, "ocid" | "sourceUrl" | "bundleUuid">,
): ContractSourceLink => {
  const m = c.ocid?.match(OCDS_PROCEDURE);
  if (m) {
    return { url: `https://app.eop.bg/today/${m[1]}`, label: "eop" };
  }
  // ЦАИС ЕОП flat open-data feed — not legacy. The daily open-data file we
  // ingested from is live and authoritative; the bundleUuid here is a
  // synthetic `eop-flat:<date>` marker, NOT a data.egov.bg dataset id, so the
  // egov fallback below would build a dead link for these rows.
  if (c.ocid?.startsWith("eop-")) {
    return { url: c.sourceUrl, label: "eop-data" };
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
