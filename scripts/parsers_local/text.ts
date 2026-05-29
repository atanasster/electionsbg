// Shared text helpers for the local-elections ingest tree.
//
// CIK renders mayor/kmetstvo/район candidate names in ALL CAPS on the
// per-município HTML page (the council candidate list is already proper
// case). Display layers want proper case, so we normalise at ingest time.
// The helper is idempotent — a string that is already proper case round-
// trips unchanged — so applying it defensively to every name field is
// safe even when only a subset arrives in ALL CAPS.

// True iff every letter in s is uppercase AND s has at least one letter.
const isAllUpperLetters = (s: string): boolean => {
  let saw = false;
  for (const ch of s) {
    const lower = ch.toLowerCase();
    const upper = ch.toUpperCase();
    if (lower === upper) continue;
    saw = true;
    if (ch !== upper) return false;
  }
  return saw;
};

// Title-case a person name. Skips strings that already mix case (already
// proper). Capitalises the first letter of each whitespace/hyphen/quote-
// separated token.
export const titleCasePersonName = (raw: string): string => {
  const s = raw.trim();
  if (!s) return s;
  if (!isAllUpperLetters(s)) return s;
  return s
    .toLowerCase()
    .replace(
      /(^|[\s\-’'])(\p{L})/gu,
      (_m, sep: string, ch: string) => sep + ch.toUpperCase(),
    );
};
