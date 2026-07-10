// Shared CSV parsing for the offline ingests. Both the МОН ДЗИ school-index
// build (scripts/schools/build_index.ts) and the municipality-grain indicators
// ingest (scripts/indicators/sources/mon_dzi.ts) previously hand-rolled the same
// walker — and both dropped an RFC-4180 escaped `""` (a literal quote inside a
// quoted field) instead of collapsing it to one `"`. This single copy handles
// that correctly. МОН files use CRLF and embed newlines inside quoted headers,
// so the row walker respects quote boundaries.

/** Split one logical CSV line into cells, honouring quoted fields and the
 *  `""` → `"` escape. */
export const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote inside a quoted field → one literal ".
        buf += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      cells.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  cells.push(buf);
  return cells;
};

/** Parse a whole CSV document into rows of cells. Strips a leading UTF-8 BOM
 *  (U+FEFF, via Unicode escape to keep eslint no-irregular-whitespace happy) and
 *  treats newlines inside quoted fields as part of the field (a `""` pair
 *  toggles the quote state twice, so it correctly stays "inside"). */
export const parseCsvRows = (text: string): string[][] => {
  const t = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '"') inQuotes = !inQuotes;
    if (c === "\n" && !inQuotes) {
      rows.push(parseCsvLine(cur));
      cur = "";
    } else if (c === "\r" && !inQuotes) {
      // skip carriage returns outside quotes (CRLF → LF)
    } else {
      cur += c;
    }
  }
  if (cur.length > 0) rows.push(parseCsvLine(cur));
  return rows;
};

/** Drop a leading BOM char from a single cell. */
export const stripBom = (s: string): string =>
  s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;

/** Normalise a header/data row — strip BOM and collapse internal whitespace. */
export const normRow = (row: string[]): string[] =>
  row.map((h) => stripBom(h).replace(/\s+/g, " ").trim());
