// Bulgarian → Latin romanization (the official Streamlined Romanization, Наредба
// за транслитерацията). Shared so party- and name-matching compare in ONE
// romanized space: an English-spelled query ("gerb", "Asen Vasilev") hits the
// Cyrillic-only data, and a Cyrillic query romanizes too and still matches.

const CYR2LAT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sht",
  ъ: "a",
  ь: "y",
  ю: "yu",
  я: "ya",
};

// Lowercase, romanize each Cyrillic letter (Latin passes through unchanged),
// collapse separators to single spaces — the common key both scripts compare in.
//
// NFC FIRST, and it is not cosmetic: a decomposed `й` (NFD) is `и` + a combining
// breve, which maps to "i" + the breve and splits the token, so the same word in
// NFD and NFC form would produce different tokens and match nothing alike.
export const translitKey = (s: string): string =>
  s
    .normalize("NFC")
    .toLowerCase()
    .split("")
    .map((ch) => CYR2LAT[ch] ?? ch)
    .join("")
    .replace(/[\s.\-_]+/g, " ")
    .trim();

// Is one romanized string a stem prefix of the other, and long enough to be
// evidence? Shared so the pipeline has ONE prefix rule: `domainScope` uses it to
// widen a token against the derived vocabulary, and `typoMatch` to land a
// corrected word on an inflected example token. A 5-character floor is what keeps
// a short stem from attaching unrelated words.
export const MIN_STEM = 5;
export const stemPrefix = (a: string, b: string, min = MIN_STEM): boolean => {
  const [prefix, longer] = a.length <= b.length ? [a, b] : [b, a];
  return prefix.length >= min && longer.startsWith(prefix);
};
