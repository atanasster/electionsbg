import type { ConnectionsTopPair } from "@/data/dataTypes";

/** RFC-4180 escape: wrap in quotes, double internal quotes. */
const csvField = (raw: unknown): string => {
  const s = raw == null ? "" : String(raw);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

/** Builds a CSV blob from the currently filtered top-pair list. Designed for
 * journalists who want to take the data into Excel/Sheets — columns mirror
 * what's visible on the page (endpoints, parties, parliaments, chain, score)
 * so the exported file is self-explanatory. */
export const exportPairsCsv = (pairs: ConnectionsTopPair[]): Blob => {
  const header = [
    "mp_a",
    "party_a",
    "ns_folders_a",
    "mp_b",
    "party_b",
    "ns_folders_b",
    "path_length",
    "all_current",
    "all_high_confidence",
    "shared_companies",
    "cross_party",
    "score",
    "chain",
  ];
  const rows = pairs.map((p) => [
    p.mpA.label,
    p.mpA.partyGroupShort ?? "",
    p.mpA.nsFolders.join(";"),
    p.mpB.label,
    p.mpB.partyGroupShort ?? "",
    p.mpB.nsFolders.join(";"),
    p.path.length,
    p.path.isAllCurrent ? "yes" : "no",
    p.path.isAllHighConfidence ? "yes" : "no",
    p.sharedCompanyCount,
    p.crossParty ? "yes" : "no",
    p.score,
    p.pathNodes.map((n) => n.label).join(" → "),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map(csvField).join(","))
    .join("\r\n");
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
};

/** Trigger a CSV download from a freshly-built blob. */
export const downloadCsv = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
