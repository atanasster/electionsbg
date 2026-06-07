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
export const translitKey = (s: string): string =>
  s
    .toLowerCase()
    .split("")
    .map((ch) => CYR2LAT[ch] ?? ch)
    .join("")
    .replace(/[\s.\-_]+/g, " ")
    .trim();
