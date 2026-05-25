// NS (National Assembly) inference helpers. Pre-50th NA, the per-MP roll-call
// file does NOT carry the NS folder (textbox800 column / XLSX column), so we
// derive it from the stenogram metadata instead.
//
// Two paths:
//   1. parseNsFromSubject — extract "ЧЕТИРИДЕСЕТ И ДЕВЕТО НАРОДНО СЪБРАНИЕ"
//      style ordinals from Pl_Sten_sub. Works for ~46th NA onward.
//   2. nsForDate — fall back to a date-range table covering 39th–52nd NA.
//      Some older stenogram subjects only carry the sitting ordinal ("ТРЕТО
//      ЗАСЕДАНИЕ") without the NS marker, so the date map is the authoritative
//      backstop.

const TENS: Record<string, number> = {
  ТРИДЕСЕТ: 30,
  ЧЕТИРИДЕСЕТ: 40,
  ПЕТДЕСЕТ: 50,
  ШЕСТДЕСЕТ: 60,
};

const UNIT_ORDINAL: Record<string, number> = {
  ПЪРВО: 1,
  ВТОРО: 2,
  ТРЕТО: 3,
  ЧЕТВЪРТО: 4,
  ПЕТО: 5,
  ШЕСТО: 6,
  СЕДМО: 7,
  ОСМО: 8,
  ДЕВЕТО: 9,
};

// Match "<TENS>О НАРОДНО" (e.g. "ПЕТДЕСЕТО НАРОДНО") or "<TENS> И <UNIT>
// НАРОДНО" (e.g. "ЧЕТИРИДЕСЕТ И ДЕВЕТО НАРОДНО"). Returns the NS as a string
// or null if no marker is present.
export const parseNsFromSubject = (subject: string): string | null => {
  if (!subject) return null;
  const tensPat = Object.keys(TENS).join("|");
  const unitsPat = Object.keys(UNIT_ORDINAL).join("|");
  const combined = new RegExp(
    `(${tensPat})(?:О\\s+НАРОДНО|\\s+И\\s+(${unitsPat})\\s+НАРОДНО)`,
    "i",
  );
  const m = subject.match(combined);
  if (!m) return null;
  const tens = TENS[m[1].toUpperCase()];
  if (!tens) return null;
  if (!m[2]) return String(tens); // "ПЕТДЕСЕТО НАРОДНО СЪБРАНИЕ"
  const unit = UNIT_ORDINAL[m[2].toUpperCase()];
  if (!unit) return null;
  return String(tens + unit);
};

// Date-range table of NS terms. Each row = [openDate, closeDate, ns] where
// openDate is the date the NS opened (first sitting) and closeDate is the
// date it was dissolved. Sessions during dissolution gaps don't exist (no
// sittings occur), so a date strictly between two windows means our table is
// out of date.
//
// Sources: official BG parliament dissolution decrees + parliament.bg session
// archives. Update when a new NA opens.
const NS_WINDOWS: ReadonlyArray<readonly [string, string, string]> = [
  ["1991-10-21", "1994-10-17", "36"],
  ["1995-01-12", "1997-02-19", "37"],
  ["1997-05-07", "2001-06-19", "38"],
  ["2001-07-05", "2005-06-25", "39"],
  ["2005-07-11", "2009-06-25", "40"],
  ["2009-07-14", "2013-03-15", "41"],
  ["2013-05-21", "2014-08-06", "42"],
  ["2014-10-27", "2017-01-27", "43"],
  ["2017-04-19", "2021-04-14", "44"],
  ["2021-04-15", "2021-05-12", "45"],
  ["2021-05-12", "2021-09-16", "46"],
  ["2021-12-03", "2022-08-02", "47"],
  ["2022-10-19", "2023-02-03", "48"],
  ["2023-04-12", "2024-06-09", "49"],
  ["2024-06-19", "2024-08-08", "50"],
  ["2024-10-27", "2026-04-08", "51"],
  ["2026-04-19", "2099-12-31", "52"],
];

export const nsForDate = (date: string): string | null => {
  if (!date) return null;
  for (const [from, to, ns] of NS_WINDOWS) {
    if (date >= from && date <= to) return ns;
  }
  return null;
};

// Combined inference: try the subject first, fall back to the date table.
export const inferNs = (subject: string, date: string): string => {
  return parseNsFromSubject(subject) ?? nsForDate(date) ?? "";
};
