// Bulgarian month name → month number (1–12). Shared by the activity parser,
// writer and watch source, which all resolve a "… за <месец> <year> г." caption
// or a "Данни за <Месец> <Year>" sheet name. One copy so the three cannot drift.
export const BG_MONTHS: Record<string, number> = {
  януари: 1,
  февруари: 2,
  март: 3,
  април: 4,
  май: 5,
  юни: 6,
  юли: 7,
  август: 8,
  септември: 9,
  октомври: 10,
  ноември: 11,
  декември: 12,
};
