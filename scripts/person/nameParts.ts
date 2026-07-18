// Parse a Bulgarian personal name into structured parts. This is the risky,
// Bulgarian-specific SPLIT logic behind plan §2a (the 2-part vs 3-part matching
// problem) — the single biggest correctness risk in the person resolver.
//
// Deliberately does NOT fold/transliterate. Folding is done by the ONE normalizer
// `translit_bg_latin()` in SQL (000_search_fns.sql) after load, so the TS side can
// never drift from it. This module only decides which token is given / patronymic /
// family and how many parts the source carried.
//
// Bulgarian names are `given [patronymic] family`. Sources disagree on whether the
// middle (patronymic) is present: TR is mostly 3-part, ЕРИК donors are 2-part, CIK
// ballots are mixed. The blocking key downstream is (given, family) — never the
// patronymic — so a 2-part name still blocks against the matching 3-part person.
//
// Order contract: this parser assumes GIVEN-FIRST (`given [patronymic] family`), the
// order every source in this repo uses (CIK ballots, parliament.bg Name1/2/3, TR).
// Surname-first registers ("ПЕТРОВ Иван") must be re-ordered BEFORE calling parseName,
// or given/family will be swapped silently.

export type NameParts = {
  /** Cleaned, whitespace-collapsed source name — becomes person.display_name. */
  displayName: string;
  /** First token. */
  given: string;
  /** Middle token when the source gave 3+ parts, else null (a 2-part source name). */
  patronymic: string | null;
  /** Last token(s) — multi-word for 4+ token names. */
  family: string;
  /** 2 or 3 — how many logical parts the name carried (4+ collapses the family to one). */
  nameParts: 2 | 3;
  /**
   * True when the family boundary was GUESSED rather than certain — currently any 4+
   * token name (plan §2a rule 1: "4+ → override"). The resolver must NOT trust an
   * ambiguous split for a high-confidence merge; route it to review / an override.
   */
  ambiguous: boolean;
};

/**
 * Parse a raw name into `{ given, patronymic?, family, nameParts, displayName }`.
 *
 * Returns `null` for input that cannot be a person name (empty, or a single token) so
 * the caller can skip-and-log rather than persist a malformed row — `person.family_fold`
 * is NOT NULL and a lone token cannot be split into a blocking key.
 *
 * @param raw - a source name string (Cyrillic or Latin, any casing, any spacing)
 * @returns the structured parts, or `null` when the name has fewer than two tokens
 * @example
 *   parseName("Бойко Методиев Борисов")
 *   // { given: "Бойко", patronymic: "Методиев", family: "Борисов", nameParts: 3, ... }
 *   parseName("Георги Бакалов")
 *   // { given: "Георги", patronymic: null, family: "Бакалов", nameParts: 2, ... }
 */
export function parseName(raw: string): NameParts | null {
  if (raw == null) return null;
  // Collapse all internal/edge whitespace to single spaces; keep source casing.
  const displayName = raw.replace(/\s+/g, " ").trim();
  if (displayName === "") return null;

  const tokens = displayName.split(" ");
  if (tokens.length < 2) return null; // a lone token cannot form a (given, family) key

  if (tokens.length === 2) {
    return {
      displayName,
      given: tokens[0],
      patronymic: null,
      family: tokens[1],
      nameParts: 2,
      ambiguous: false,
    };
  }

  // 3+ tokens: first is given, second is patronymic, the rest is the (possibly
  // multi-word) family. Compound family names ("Стоянова Иванова", "фон Ф.") land here.
  // For 4+ tokens the family boundary is a GUESS — flag it so the resolver routes it
  // to review/override instead of a high-confidence merge (plan §2a rule 1).
  return {
    displayName,
    given: tokens[0],
    patronymic: tokens[1],
    family: tokens.slice(2).join(" "),
    nameParts: 3,
    ambiguous: tokens.length >= 4,
  };
}
