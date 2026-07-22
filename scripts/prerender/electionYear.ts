// Derives the " 2026"-style freshness suffix appended to the home + results-hub
// prerender titles from the latest election folder name ("2026_04_19"). Kept pure
// and side-effect-free so it can be unit-tested without importing the heavy,
// file-reading routes module. Returns "" for anything without a leading four-digit
// year (empty/missing elections file, a local-cycle slug like "mi_2023", etc.), so
// a bad input yields a clean title (no dangling year) rather than junk.
export const electionYearSuffix = (
  electionName: string | null | undefined,
): string => {
  const year = (electionName ?? "").slice(0, 4);
  return /^\d{4}$/.test(year) ? ` ${year}` : "";
};
