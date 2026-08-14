// Stable, human-readable slug ids from Bulgarian text — shared by the
// classification-registry builders (admin units, economic lines, vote items, …).
//
// ⚠ INVISIBLE FORMATTING CHARACTERS ARE STRIPPED, NOT TRANSLATED TO `-`. A soft
// hyphen (U+00AD) is a typographic hint about where a word MAY break; it is not
// part of the name and must never become a slug boundary. Sources published as
// HTML or converted from DTP carry them, and because the slug IS the node
// identity, one такъв character silently mints a SECOND node holding whatever
// years it happened to appear in.
//
// Measured 2026-08-13 across the budget classification registries, two live cases,
// both from the 2019 source document:
//   • „Министерство на регионалното развитие и благо<SHY>устройството" →
//     `admin-…-blago-ustroystvoto` (eik: null, FY2019 only) beside the canonical
//     `admin-…-blagoustroystvoto` (FY2018 + 2020-2026). /governance/sectors then
//     showed „няма данни за 2019" for регионално развитие — the only budget-basis
//     sector missing that year — while the real €264,181,243 sat in the repo.
//   • МОН's „Бюджетна програма „Администра<SHY>ция"" → a programme node holding
//     FY2019 alone, beside `…-administratsiya-6` holding every other year.
//
// Nothing about either is visible in a diff, a row count, or the rendered name.

const TRANSLIT: Record<string, string> = {
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

/** Every Unicode FORMAT character (`\p{Cf}`) plus the two invisible marks outside
 *  that category — soft hyphen, the zero-width family, the word joiner, the bidi
 *  marks and controls, the BOM, the combining grapheme joiner and the variation
 *  selectors. They render as nothing, carry no meaning for an identifier, and are
 *  dropped BEFORE transliteration so they cannot reach the `[^a-z0-9]+` rule below
 *  and split a word in two.
 *
 *  The PROPERTY rather than a hand-written list, because an enumeration has to be
 *  edited the first time a new one appears and nothing about that appearance is
 *  visible in a diff or a row count. U+200E/U+200F in particular travel with the
 *  same HTML-export and DTP-conversion provenance that produced the soft hyphen in
 *  the 2019 budget law.
 *
 *  NBSP (U+00A0) and the non-breaking hyphen (U+2011) are deliberately NOT here:
 *  both are VISIBLE separators and must still fold to `-`. ZWNJ/ZWJ are
 *  semantically load-bearing in Persian and Devanagari — stripping them is right
 *  only because this function is for Bulgarian text. */
const INVISIBLE = /[\p{Cf}\u034F\uFE00-\uFE0F]/gu;

/** Drop every invisible mark from a string — the display-name counterpart of what
 *  `slugify` does to an identifier. Exported as a FUNCTION, not as the regex: it
 *  carries `/g`, so a shared instance handed to `.test()` would alternate true and
 *  false on identical input through `lastIndex`. */
export const stripInvisible = (s: string): string => s.replace(INVISIBLE, "");

// `slugify("Данъчни приходи", "eco")` → "eco-danachni-prihodi". Deterministic,
// so the same source label always maps to the same node id.
export const slugify = (name: string, prefix: string): string => {
  const latin = [...stripInvisible(name).toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("");
  const slug = latin
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug ? `${prefix}-${slug}` : prefix;
};
