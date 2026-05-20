// External citizen-audit links for an individual polling section.
//
// Two independent sources, both keyed by election:
//  - Count video — evideo.bg publishes the official video recording of the
//    ballot count, so citizens can verify the СИК protocol against footage.
//  - Protocol scan — the results.cik.bg search portal serves the scanned СИК
//    protocol PDF. `scanId` is an opaque per-election identifier in CIK's
//    results database (constant across all sections of one election); the
//    `.0` suffix selects the original protocol (corrections would be `.1`+).
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
  return `https://results.cik.bg/${cfg.portal}/search/index.html#/s/${cfg.scanId}/${sectionCode}.0.pdf`;
};
