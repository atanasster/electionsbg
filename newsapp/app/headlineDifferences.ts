const WORD = /\p{L}[\p{L}\p{M}\p{N}'’-]*/gu;
const STOP_WORDS = new Set([
  "беше",
  "били",
  "българия",
  "като",
  "които",
  "може",
  "няма",
  "след",
  "това",
  "този",
  "the",
  "that",
  "this",
  "with",
  "from",
  "have",
  "will",
]);

export const headlineWordParts = new RegExp(`(${WORD.source})`, "gu");

export const normalizeHeadlineWord = (word: string): string =>
  word.normalize("NFKC").toLocaleLowerCase("bg-BG");

export const distinctiveHeadlineTerms = (
  headlines: Array<string | null>,
): Array<Set<string>> => {
  if (headlines.length < 2) return headlines.map(() => new Set<string>());
  const tokenSets = headlines.map(
    (headline) =>
      new Set(
        (headline?.match(WORD) ?? [])
          .map(normalizeHeadlineWord)
          .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
      ),
  );
  const frequency = new Map<string, number>();
  for (const tokens of tokenSets) {
    for (const token of tokens) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }
  return tokenSets.map(
    (tokens) =>
      new Set(
        [...tokens].filter((token) => frequency.get(token) === 1).slice(0, 6),
      ),
  );
};
