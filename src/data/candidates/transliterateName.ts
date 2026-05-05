// Streamlined-System transliteration of Bulgarian personal names to Latin
// (the 2009 Bulgarian Transliteration Law). Used as a fallback for any
// candidate that does not have a parliament.bg EN profile or curated override.
//
// Output is title-cased per word so the result reads naturally as a display
// name ("Stefan Radoslavov Tsonchev"), not as a URL slug. URL slugs continue
// to come from candidateSlug.ts and are deliberately *not* derived from this
// module — slug stability matters for inbound links.
//
// End-rule: "-ия" at the end of a word becomes "-ia" (София → Sofia,
// Тодоров → Todorov, Илия → Ilia). Mid-word "-ия-" stays "iya".

const CYR_TO_LATIN: Record<string, string> = {
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

const transliterateWord = (word: string): string => {
  const lower = word.toLowerCase();
  // -ия end-rule (single Latin "ia" instead of "iya"), per 2009 law §2 (4) — applies
  // when the trailing "ия" closes the word, e.g. София → Sofia, Илия → Ilia.
  let body = lower;
  let suffix = "";
  if (body.endsWith("ия")) {
    body = body.slice(0, -2);
    suffix = "ia";
  }
  let out = "";
  for (const ch of body) out += CYR_TO_LATIN[ch] ?? ch;
  out += suffix;
  // Title-case: first letter uppercase, rest lowercase. Handles ASCII-only
  // (after transliteration) and gracefully passes through any chars that
  // weren't in the table (e.g. raw Latin letters in mixed-script names).
  if (!out) return out;
  return out[0].toUpperCase() + out.slice(1);
};

// Split on whitespace and hyphens but preserve them in the output so
// double-barrelled names ("Анна-Мария Иванова") round-trip.
export const transliterateName = (name: string): string => {
  if (!name) return "";
  return name
    .trim()
    .split(/(\s+|-)/)
    .map((tok) => (/^[\s-]+$/.test(tok) ? tok : transliterateWord(tok)))
    .join("")
    .replace(/\s+/g, " ");
};
