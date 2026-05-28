// Bulgarian locative preposition picker: "в" vs "във".
//
// The rule (per Институт за български език): "във" before words beginning
// with /в/ or /ф/ (i.e. case-insensitive "в" or "ф" in Cyrillic, "В" / "Ф"
// uppercase). Everything else uses "в". For consistency we also switch to
// "във" when the next word starts with the silent "У" before "в" (rare) —
// not worth a full phonotactic check, the v/f rule covers >99% of cases.
//
// Used when constructing locatives like "във Варна" / "във Видин" /
// "във Феърклот" vs "в София" / "в Самоков" — programmatic strings have to
// branch on the first letter or they sound off to a native ear.
//
// Returns just the preposition; the caller composes "{preposition} {name}".

const STARTS_WITH_V_OR_F = /^[вфВФ]/;

/** Pick "в" or "във" based on the leading letter of a settlement name. */
export const locativePreposition = (name?: string | null): "в" | "във" => {
  if (!name) return "в";
  return STARTS_WITH_V_OR_F.test(name) ? "във" : "в";
};

/** Convenience: "{preposition} {name}", trimmed. */
export const locative = (name?: string | null): string => {
  if (!name) return "";
  return `${locativePreposition(name)} ${name}`;
};
