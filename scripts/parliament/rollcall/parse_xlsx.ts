// Parser for parliament.bg's "Поименно гласуване" XLSX files. Used for
// pre-47th NA sessions where the CSV variant isn't published, and as a
// fallback for the occasional newer session that's missing the CSV.
//
// XLSX layout ("DeputiesRegAndVote" sheet):
//   Row 0: ["Регистрации и гласувания от:", "<dd-mm-yyyy>"]
//   Row 1: ["", null, null, null, 1, 2, 3, 4, 5, null, 6, 7, ...]
//       — first 4 cells empty, then item numbers; null cells between groups
//         of 5 are visual separators copied from the Excel template, not
//         missing data.
//   Row 2+: ["<MP NAME>", null, <mp_id>, "<PARTY>", <vote_1>, <vote_2>, ...]
//
// We read the header row to learn which column corresponds to which item
// number (ignoring null cells), then walk the data rows producing the same
// RawCsvRow records the CSV parser produces.

import * as XLSX from "xlsx";
import type { RawCsvRow } from "./parse";

// Modern layout (46th NA onward, plus most 44th-NA in-person days):
//   col 0 = NAME, col 1 = blank, col 2 = mp_id, col 3 = PARTY, col 4+ = votes
// COVID-era "+online" layout (Oct 2020 – Apr 2021, 44th NA):
//   col 0 = NAME, col 1 = PARTY, col 2+ = votes  (no mp_id column)
// Layout is auto-detected from the header row: count leading non-numeric
// cells before the first item number.
const MODERN_LAYOUT = {
  name: 0,
  mpId: 2,
  party: 3,
  firstVote: 4,
} as const;
const ONLINE_LAYOUT = {
  name: 0,
  mpId: -1, // no id column; caller resolves by name
  party: 1,
  firstVote: 2,
} as const;

// Generic XLSX reader: returns the first sheet's rows as a 2D array.
// Re-used for both per-MP files (parseXlsx) and the groups XLSX (titles
// extractor). null/empty cells preserved so callers can distinguish "blank
// cell" from "missing column".
export const readXlsxRows = (
  buffer: ArrayBuffer | Buffer,
  sheetNamePreference?: string,
): unknown[][] => {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName =
    (sheetNamePreference && wb.SheetNames.includes(sheetNamePreference)
      ? sheetNamePreference
      : wb.SheetNames[0]) ?? "";
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];
};

// Parser returns null when the workbook doesn't carry per-MP votes (e.g. a
// session where parliament.bg accidentally uploaded the registrations/groups
// file under the "Поименно гласуване" label). Callers should treat null as
// "skip this session" rather than a hard error.
export const parseXlsx = (
  buffer: ArrayBuffer | Buffer,
  ns: string,
): RawCsvRow[] | null => {
  const wb = XLSX.read(buffer, { type: "buffer" });
  // The per-MP file always names its sheet "DeputiesRegAndVote". The groups
  // file uses "RegisteredAndVotedByParGroup" — detecting the sheet name early
  // lets us skip misuploaded sessions without trying to parse them.
  const sheetName = wb.SheetNames.find((n) => n === "DeputiesRegAndVote");
  if (!sheetName) return null;
  const sheet = wb.Sheets[sheetName];
  // header:1 gives us 2D array of cell values, null for empty cells.
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  if (rows.length < 3) return [];

  // Auto-detect layout: scan header row for the first column that holds a
  // numeric item number. Modern layout starts at col 4; COVID-era +online
  // starts at col 2.
  const header = rows[1];
  let firstVoteCol = -1;
  for (let c = 0; c < header.length; c++) {
    const cell = header[c];
    if (cell === null || cell === undefined || cell === "") continue;
    const item = typeof cell === "number" ? cell : parseInt(String(cell), 10);
    if (Number.isFinite(item) && item > 0) {
      firstVoteCol = c;
      break;
    }
  }
  if (firstVoteCol < 0) return null;
  const layout =
    firstVoteCol === ONLINE_LAYOUT.firstVote
      ? ONLINE_LAYOUT
      : firstVoteCol === MODERN_LAYOUT.firstVote
        ? MODERN_LAYOUT
        : null;
  if (!layout) {
    throw new Error(
      `XLSX layout unrecognized: first vote column is ${firstVoteCol}`,
    );
  }

  const colToItem = new Map<number, number>();
  for (let c = layout.firstVote; c < header.length; c++) {
    const cell = header[c];
    if (cell === null || cell === undefined || cell === "") continue;
    const item = typeof cell === "number" ? cell : parseInt(String(cell), 10);
    if (Number.isFinite(item)) colToItem.set(c, item);
  }
  if (colToItem.size === 0) return null;

  const out: RawCsvRow[] = [];
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const name = row[layout.name];
    if (name === null || name === undefined || String(name).trim() === "") {
      continue;
    }
    const mpName = String(name).trim();
    let mpId = 0;
    if (layout.mpId >= 0) {
      const mpIdRaw = row[layout.mpId];
      const parsed =
        typeof mpIdRaw === "number"
          ? mpIdRaw
          : parseInt(String(mpIdRaw ?? ""), 10);
      if (!Number.isFinite(parsed)) continue;
      mpId = parsed;
    }
    const partyShort = String(row[layout.party] ?? "").trim();
    for (const [col, item] of colToItem) {
      const cell = row[col];
      // Vote codes are single-character strings in BG-Cyrillic/ASCII. Empty
      // cells map to "absent" in the CSV path; preserve the same convention.
      const voteCode = cell === null || cell === undefined ? "" : String(cell);
      out.push({
        mpName,
        mpId,
        partyShort,
        nsFolder: ns,
        item,
        voteCode,
      });
    }
  }
  return out;
};
