// Parser for ЦИК "Числови данни от протокол" HTML pages.
//
// Discovered 2026-06-19: a by-election's per-section AND aggregate-ОИК protocol
// totals are served as clean HTML tables at
//   <cycle>/tur{1,2}/protokoli/<el>/<oik>/<id>.html
// (el = election type: 8=район mayor, 5/6=община mayor, 4=kmetstvo; id = the
// 9-digit СИК code + ".<form>" for a section, or the район/kmetstvo код /
// literal "ik" for the aggregate). The rezultati summary pages publish vote
// tallies only, so this is the sole machine-readable turnout source short of
// OCR-ing the scanned PDFs — and it's exact, so no OCR is needed.
//
// Verified район Средец (2026-06-14): aggregate line 1 == Σ section line 1 ==
// 26 800 registered; line 3 == Σ section line 3 == 3 520 voted → 13.13% turnout.

export type ChisloviData = {
  /** Line 1 — избиратели в списъците при предаването им на СИК. */
  numRegisteredVoters: number;
  /** Line 3 — гласували избиратели според положените подписи. */
  totalActualVoters: number;
  /**
   * Per-candidate valid votes keyed by ballot № (= the bundle's localPartyNum).
   * Combined paper+machine total (last block) — drives the per-section map.
   */
  candidateVotes: { num: number; votes: number }[];
};

const toNum = (s: string): number => parseInt(s.replace(/[^\d]/g, ""), 10) || 0;

/** Flatten an HTML table into rows of trimmed cell strings. */
const parseRows = (html: string): string[][] =>
  [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) =>
    [...m[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)]
      .map((c) =>
        c[0]
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean),
  );

// The leading "1." / "3." numbering is stable across section + aggregate forms
// (paper, machine, combined). Match the label cell, read the last cell as value.
const REGISTERED = /^1\.\s*Брой на избирателите/;
const VOTED = /^3\.\s*Брой на гласувалите/;

const fieldByLabel = (rows: string[][], label: RegExp): number | null => {
  for (const cells of rows) {
    if (cells[0] && label.test(cells[0])) return toNum(cells[cells.length - 1]);
  }
  return null;
};

/**
 * Candidate vote rows look like [№, "Name ПАРТИЯ", действителни]. The page
 * repeats the table per voting method (paper / machine / combined), each block
 * re-listing the same №s; the COMBINED block comes last, so keeping the
 * last-seen value per № yields paper+machine totals (single-method sections
 * just keep their one block). The header row ("№ | Имена… | Действителни")
 * is skipped because cell[0] isn't a bare integer.
 */
const candidateVotesFromRows = (
  rows: string[][],
): { num: number; votes: number }[] => {
  const byNum = new Map<number, number>();
  for (const cells of rows) {
    if (cells.length < 3) continue;
    if (!/^\d+$/.test(cells[0])) continue; // № column
    if (!/[А-Яа-я]/.test(cells[1])) continue; // name/party column
    byNum.set(parseInt(cells[0], 10), toNum(cells[cells.length - 1]));
  }
  return [...byNum.entries()]
    .map(([num, votes]) => ({ num, votes }))
    .sort((a, b) => b.votes - a.votes);
};

/**
 * Parse a "Числови данни от протокол" HTML page into the turnout fields plus
 * per-candidate votes. Returns null when none are present (wrong/empty page).
 */
export const parseChisloviHtml = (html: string): ChisloviData | null => {
  const rows = parseRows(html);
  const numRegisteredVoters = fieldByLabel(rows, REGISTERED);
  const totalActualVoters = fieldByLabel(rows, VOTED);
  const candidateVotes = candidateVotesFromRows(rows);
  if (
    numRegisteredVoters == null &&
    totalActualVoters == null &&
    candidateVotes.length === 0
  )
    return null;
  return {
    numRegisteredVoters: numRegisteredVoters ?? 0,
    totalActualVoters: totalActualVoters ?? 0,
    candidateVotes,
  };
};
