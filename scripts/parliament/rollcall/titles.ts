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

const TITLE_LINE_RE =
  /Номер\s*\(\s*(\d+)\s*\)\s+ГЛАСУВАНЕ[^]*?по\s+тема\s+(.+?)$/u;

const stripBom = (s: string): string =>
  s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;

const cleanTitle = (s: string): string =>
  s
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!?-]+$/u, "")
    .trim();

// Pull item titles out of the groups-CSV text. Returns `{}` if the CSV doesn't
// look like the expected shape — the caller falls back to outcome-derived
// labels on the frontend.
export const extractItemTitles = (csvText: string): Record<string, string> => {
  if (!csvText) return {};
  const text = stripBom(csvText).replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines.length < 2) return {};
  // The textbox3 column is column 0 (no quoting in observed files); we read
  // up to the first comma — but item titles never contain commas in practice
  // (parliament.bg uses dashes for sub-clauses). Fall back to splitting on the
  // first occurrence and trusting the line shape.
  const titles: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const firstField = lines[i].split(",")[0] ?? "";
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
