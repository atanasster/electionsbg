// Per-item vote titles.
//
// parliament.bg's stenogram JSON body is just a 370-byte boilerplate notice — it
// does NOT contain bill titles. The actual titles live in a sibling file
// shipped with every plenary day: "Гласуване по парламентарни групи" (gv*.csv).
//
// That CSV has one row per (item, group) with a `textbox3` cell shaped like:
//
//   Номер (7) ГЛАСУВАНЕ проведено на 08-05-2026 10:53 по тема Решение за
//   избиране на министър-председател на Република България
//
// We extract `по тема <title>` and key it by the item number in parens. Item
// (1) is always REGISTRATION (not a vote) and is skipped naturally because we
// only match the "по тема" form.
//
// textbox3 is column 0. Longer titles (multi-clause committee mandates, etc.)
// contain commas, so parliament.bg quotes the field with embedded quotes
// doubled (""). We parse the first field quote-aware rather than splitting on
// the first comma — splitting truncated those titles mid-sentence.

const TITLE_LINE_RE =
  /Номер\s*\(\s*(\d+)\s*\)\s+ГЛАСУВАНЕ[^]*?по\s+тема\s+(.+?)$/u;

const stripBom = (s: string): string =>
  s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;

const cleanTitle = (s: string): string =>
  s
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!?-]+$/u, "")
    .trim();

// Read the first CSV field of a line. A quoted field runs to its matching
// closing quote (doubled "" → literal "); an unquoted field runs to the first
// comma. parliament.bg only quotes textbox3 when it contains a comma.
const firstCsvField = (line: string): string => {
  if (line[0] !== '"') return line.split(",")[0] ?? "";
  let out = "";
  for (let i = 1; i < line.length; i++) {
    if (line[i] === '"') {
      if (line[i + 1] === '"') {
        out += '"';
        i++;
        continue;
      }
      break;
    }
    out += line[i];
  }
  return out;
};

// Pull item titles out of the groups-CSV text. Returns `{}` if the CSV doesn't
// look like the expected shape — the caller falls back to outcome-derived
// labels on the frontend.
export const extractItemTitles = (csvText: string): Record<string, string> => {
  if (!csvText) return {};
  const text = stripBom(csvText).replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines.length < 2) return {};
  const titles: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const firstField = firstCsvField(lines[i]);
    const m = TITLE_LINE_RE.exec(firstField);
    if (!m) continue;
    const itemKey = m[1];
    if (titles[itemKey]) continue;
    const title = cleanTitle(m[2] ?? "");
    if (title.length < 4) continue;
    titles[itemKey] = title;
  }
  return titles;
};

// Older sessions (pre-47th NA) ship the groups file as XLSX only. The header
// text we want is column 0 of each "Номер (N) ГЛАСУВАНЕ ... по тема <title>"
// row — same regex, different source.
export const extractItemTitlesFromXlsxRows = (
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): Record<string, string> => {
  const titles: Record<string, string> = {};
  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const cell = row[0];
    if (cell === null || cell === undefined) continue;
    const text = String(cell);
    const m = TITLE_LINE_RE.exec(text);
    if (!m) continue;
    const itemKey = m[1];
    if (titles[itemKey]) continue;
    const title = cleanTitle(m[2] ?? "");
    if (title.length < 4) continue;
    titles[itemKey] = title;
  }
  return titles;
};
