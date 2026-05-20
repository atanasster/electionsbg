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
