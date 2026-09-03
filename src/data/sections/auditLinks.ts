// External citizen-audit links for an individual polling section.
//
// Two independent sources, both keyed by election:
//  - Count video — evideo.bg publishes the official video recording of the
//    ballot count, so citizens can verify the СИК protocol against footage.
//  - Protocol scan — results.cik.bg serves the scanned СИК protocol PDF
//    directly under /pdf/. We link the file directly rather than the search
//    SPA's #/s/ hash route, which 404s on a cold deep-link (it only resolves
//    once the in-app search index has loaded). `scanId` is an opaque
//    per-election identifier in CIK's results database (constant across all
//    sections of one election); the path is grouped by the 2-digit electoral
//    region; the `.0` suffix selects the original protocol (corrections `.1`+).
//
// Elections absent from the map predate these sources — the chip is omitted.
//
// ⚠ THE LOCAL CYCLES ARE NOT ONE OF THOSE, AND „predate the sources" WOULD BE THE WRONG
// REASON TO GIVE. Checked against the live portal 2026-09-04: results.cik.bg/mi2023 runs the
// same SPA and builds the same kind of scan URL —
//
//     ./../pdf/<contest>/<ik_id>/<9-digit sik>.<suffix>
//
// — so the scans exist. What is missing here is the DATA to address one. Three things differ
// from a parliamentary cycle, and each defeats a code-only builder:
//
//   1. `<contest>` is not one id per election. A local cycle runs three contests (кмет на
//      община, общински съвет, кмет на кметство) and each has its own.
//   2. `<ik_id>` is the OIK (e.g. "0530", "1726"), NOT the 2-digit electoral region this
//      module slices out of the station code.
//   3. `<suffix>` is a LOOKUP, not the constant `.0`. The portal reads it from `HAS_PDF`, a
//      222 KB availability table at `/mi2023/tur1/pdf/data.js` shaped
//      `HAS_PDF[contest][ik_id] = [section numbers]`. (Its sibling `HAS_KP` — corrected
//      protocols — is `[]` for this cycle.)
//
// So a local chip would have to be built from that table, which means crawling and committing
// it. Guessing instead would publish „Сканиран протокол" pointing at a 404 for every section
// the table does not list — a chip asserting the state showed us a protocol it did not, which
// is the one failure `auditLinks.test.ts` exists to prevent. Until the table is ingested the
// honest answer is no chip, and this comment is the reason rather than "the cycle is too old".

type AuditConfig = {
  portal: string;
  scanId?: number;
};

const AUDIT: Record<string, AuditConfig> = {
  "2026_04_19": { portal: "pe202604", scanId: 64 },
  "2024_10_27": { portal: "pe202410" },
};

export const countVideoUrl = (
  electionDate: string,
  sectionCode: string,
): string | undefined => {
  const cfg = AUDIT[electionDate];
  if (!cfg || !/^\d{9}$/.test(sectionCode)) return undefined;
  return `https://evideo.bg/${cfg.portal}/${sectionCode.slice(0, 2)}.html#${sectionCode}`;
};

export const protocolScanUrl = (
  electionDate: string,
  sectionCode: string,
): string | undefined => {
  const cfg = AUDIT[electionDate];
  if (!cfg || cfg.scanId === undefined || !/^\d{9}$/.test(sectionCode))
    return undefined;
  return `https://results.cik.bg/${cfg.portal}/pdf/${cfg.scanId}/${sectionCode.slice(0, 2)}/${sectionCode}.0.pdf`;
};
