// Shared entity-name normaliser. Multiple ingest scripts (funds, procurement,
// declarations, financing, budget) read Bulgarian organisation names from
// upstream feeds that mix sentence case and wholesale ALL CAPS for the same
// entity. This util canonicalises the all-caps subset to sentence case so
// downstream display and name-matched joins (debarred lists, ministry
// rollups) stop fragmenting across casing variants.
//
// Imported by:
//   - scripts/funds/parse.ts + projects_parse.ts (ИСУН XLSX rows)
//   - scripts/procurement/normalize.ts (АОП OCDS parties)
//   - scripts/declarations/build_company_index.ts (companies-index displayName)
//   - scripts/financing/scrape_*.ts (party names from bulnao.government.bg)
//   - scripts/budget/law_html.ts (definite-article stripping wrapper)
//
// Strategy:
//   1. Tokenise on whitespace.
//   2. For each word:
//      - If it has any lowercase letter, keep it AS-IS (someone already
//        typed it properly — preserves proper nouns like "Плевен" and
//        camelCase brands like "КонтурГлобал").
//      - Else (the whole word is uppercase):
//        - If its letter core matches a known acronym / legal form → KEEP UPPER
//        - If it's a single-letter Bulgarian function word ("и") → lowercase
//        - If it sits inside `(…)` and is 3-9 letters → KEEP UPPER (paren-acronym)
//        - Otherwise → title-case it (first letter upper, rest lower)
//   3. After the word pass, do a sentence-case sweep:
//      - Lowercase the first letter of every word that *we just title-cased*
//        and is not the very first content word (or the word after a quote /
//        paren / sentence-end punctuation).
//
// Pure ASCII operations would not work — Bulgarian uses Cyrillic, which JS
// `.toLowerCase()` / `.toUpperCase()` handle correctly.

// Known acronyms and legal forms that must stay UPPERCASE. Keep this list
// terse — overly broad matching would lowercase common words. Add to it
// when ingest output shows a token that should have stayed capital.
const ACRONYMS = new Set<string>([
  // Legal forms
  "АД",
  "ЕАД",
  "ООД",
  "ЕООД",
  "СД",
  "КД",
  "ЕТ",
  "ДП",
  "ДЗЗД",
  "СНЦ",
  "ЕС",
  // State institutions / agencies
  "АОП",
  "АПИ",
  "БАБХ",
  "БАН",
  "БДЖ",
  "БНБ",
  "БНР",
  "БНТ",
  "БТА",
  "ДАНС",
  "ДКЦ",
  "ИА",
  "ИАЛ",
  "ИАОС",
  "ИО",
  "ИСУН",
  "КЗП",
  "КЗК",
  "КФН",
  "МВнР",
  "МВР",
  "МОН",
  "МО",
  "МРРБ",
  "МТСП",
  "МФ",
  "МЕ",
  "МЗ",
  "МЗГ",
  "МЗХ",
  "МОСВ",
  "НАП",
  "НЗОК",
  "НИС",
  "НОИ",
  "НСИ",
  "НСО",
  "ПУДООС",
  "ВиК",
  // Education
  "ОУ",
  "СУ",
  "СОУ",
  "ПУ",
  "ПГ",
  "ППМГ",
  "СПГ",
  "СПТУ",
  "ПГТ",
  "ПГИ",
  "ПГСС",
  "НПГ",
  "ППГ",
  "УНСС",
  "ВТУ",
  "ТУ",
  // Health
  "МБАЛ",
  "СБАЛ",
  "УМБАЛ",
  "СБАЛАГ",
  "СБАЛО",
  "СБАЛОЗ",
  "ЦСМП",
  "ЦКВЗ",
  "РЗОК",
  "РЗИ",
  "МЦ",
  "ДМСГД",
  // Local government / education
  "ОДЗ",
  "ДГ",
  "ЦДГ",
  "ДЯ",
  // Other common
  "ДЗОФ",
  "СА",
  "УО",
  "МЗ",
  "ОП",
  "ЦПЛР",
  "ЦОП",
  "ЦСРИ",
  "ЦНСТ",
  "ЦПЗ",
  "ОЗД",
]);

// Bulgarian prepositions / conjunctions / pronouns that stay lowercase
// even when the rest of the name is being title-cased.
const LOWERCASE_FUNCTION_WORDS = new Set<string>([
  "на",
  "и",
  "в",
  "във",
  "за",
  "по",
  "от",
  "до",
  "с",
  "със",
  "при",
  "под",
  "над",
  "около",
  "между",
  "през",
  "пред",
  "след",
  "без",
  "или",
  "че",
  "като",
]);

// Roman numerals (I-XX) used in school names: "ОУ III", "ПГ XI" — keep upper.
const ROMAN_NUMERAL_RE =
  /^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)$/;

// Bulgarian / Slavic surname + given-name suffixes. Used by the sentence-
// case sweep to override "lowercase middle-of-sentence" when the word
// inside a quote looks like a personal name. Without this, school names
// like "Средно училище \"Иван Вазов\"" come out as "иван вазов" — the
// second word is mid-sentence by default, but for surnames like Вазов /
// Делчев / Левски we want to keep the capital.
const SURNAME_SUFFIX_RE = /(?:ов|ев|ин|ски|ска|ова|ева|ина|ий|ийски|вски)$/i;

// Definite-article suffix on Bulgarian nouns — the budget law emits
// "Министерството на ...", "Агенцията за ...", "Комисията за ...",
// "Предприятието за ..." (the -то/-та form) while every other ingest
// source uses the bare-noun form. Strip the trailing definite-article
// suffix that immediately follows the first word's natural ending.
// Negative lookahead for `[а-я]` is used instead of `\b` because JS `\b`
// is ASCII-only and won't fire between Cyrillic letters.
const DEFINITE_ARTICLE_PATTERNS: RegExp[] = [
  // neuter -ство → -ството (Министерство → Министерството)
  /(?<=^[А-Я][а-я]+ство)то(?![а-я])/u,
  // feminine -ия → -ията (Комисия → Комисията, Агенция → Агенцията,
  // Дирекция → Дирекцията)
  /(?<=^[А-Я][а-я]+ия)та(?![а-я])/u,
  // neuter -ие → -ието (Предприятие → Предприятието,
  // Управление → Управлението)
  /(?<=^[А-Я][а-я]+ие)то(?![а-я])/u,
];

const ACRONYM_IN_PAREN_MIN = 3;
const ACRONYM_IN_PAREN_MAX = 9;

// Tokenise a word into (leading-punct, letter/digit core, trailing-punct).
// Returns null when the input has no letter/digit core (pure punctuation).
const tokenise = (
  raw: string,
): { prefix: string; core: string; suffix: string } | null => {
  const m = raw.match(
    /^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}'’]*)([^\p{L}\p{N}]*)$/u,
  );
  if (!m) return null;
  return { prefix: m[1], core: m[2], suffix: m[3] };
};

const isAllUpperLetters = (s: string): boolean => {
  // True iff every letter in s is uppercase AND s contains at least one
  // letter. Digits and punctuation don't affect the verdict.
  let sawLetter = false;
  for (const ch of s) {
    const lower = ch.toLowerCase();
    const upper = ch.toUpperCase();
    if (lower === upper) continue; // not a letter
    sawLetter = true;
    if (ch !== upper) return false;
  }
  return sawLetter;
};

const titleCase = (s: string): string => {
  if (s.length === 0) return s;
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
};

interface Word {
  raw: string; // original token including punctuation
  isWhitespace: boolean;
  // The following are only set for non-whitespace tokens:
  prefix: string;
  core: string;
  suffix: string;
  out: string; // resolved output before sentence-case sweep
  // True if this word was title-cased (i.e. derived from an all-uppercase
  // input that wasn't a recognised acronym). Used by the sentence-case
  // sweep to decide what to lowercase as "middle of sentence".
  titleCased: boolean;
}

const buildWord = (raw: string): Word => {
  if (/^\s+$/.test(raw)) {
    return {
      raw,
      isWhitespace: true,
      prefix: "",
      core: "",
      suffix: "",
      out: raw,
      titleCased: false,
    };
  }
  const tok = tokenise(raw);
  if (!tok) {
    return {
      raw,
      isWhitespace: false,
      prefix: raw,
      core: "",
      suffix: "",
      out: raw,
      titleCased: false,
    };
  }
  const { prefix, core, suffix } = tok;
  // If the original word has any lowercase letter, leave it alone.
  if (!isAllUpperLetters(raw)) {
    return {
      raw,
      isWhitespace: false,
      prefix,
      core,
      suffix,
      out: raw,
      titleCased: false,
    };
  }
  // All-upper path.
  const upperCore = core; // already upper
  // 1. Known acronym / legal form (case-insensitive match on the canonical
  //    upper form).
  if (ACRONYMS.has(upperCore) || ROMAN_NUMERAL_RE.test(upperCore)) {
    return {
      raw,
      isWhitespace: false,
      prefix,
      core: upperCore,
      suffix,
      out: prefix + upperCore + suffix,
      titleCased: false,
    };
  }
  // 2. All-upper Bulgarian function word ("И", "В", "С" etc) → lowercase.
  if (LOWERCASE_FUNCTION_WORDS.has(upperCore.toLowerCase())) {
    const lowered = upperCore.toLowerCase();
    return {
      raw,
      isWhitespace: false,
      prefix,
      core: lowered,
      suffix,
      out: prefix + lowered + suffix,
      titleCased: false,
    };
  }
  // 3. Inside parentheses: 3-9 letter token is almost certainly an acronym.
  if (
    prefix === "(" &&
    suffix.startsWith(")") &&
    upperCore.length >= ACRONYM_IN_PAREN_MIN &&
    upperCore.length <= ACRONYM_IN_PAREN_MAX &&
    /^[\p{L}]+$/u.test(upperCore)
  ) {
    return {
      raw,
      isWhitespace: false,
      prefix,
      core: upperCore,
      suffix,
      out: prefix + upperCore + suffix,
      titleCased: false,
    };
  }
  // 4. Default: title-case (first upper, rest lower).
  const titled = titleCase(upperCore);
  return {
    raw,
    isWhitespace: false,
    prefix,
    core: titled,
    suffix,
    out: prefix + titled + suffix,
    titleCased: true,
  };
};

// Sentence boundary marker: characters that introduce a new sentence start.
const SENTENCE_BOUNDARY_RE = /^[".„«([]/;
const ENDS_WITH_SENTENCE_BOUNDARY_RE = /[.!?,:;]$/;

const lowerFirst = (s: string): string => {
  if (s.length === 0) return s;
  return s[0].toLowerCase() + s.slice(1);
};

/**
 * Convert mostly-uppercase Cyrillic/Latin organisation names to sentence
 * case while preserving known acronyms, legal forms, and proper nouns that
 * were already correctly cased in the source.
 *
 * Names that are already mixed-case (i.e. someone already wrote them
 * sensibly) are returned essentially unchanged — only individual all-upper
 * acronyms inside a mixed-case string are preserved as upper.
 */
export const normaliseOrgName = (name: string): string => {
  if (!name) return name;
  const tokens = name.split(/(\s+)/);
  const words: Word[] = tokens.map(buildWord);

  // Sentence-case sweep — lowercase the first letter of title-cased words
  // that aren't at a "sentence start" position. A sentence start is:
  //   - the first TITLE-CASED word in the run (leading legal-form acronyms
  //     like "ДП" / "ЕТ" don't count as content for this purpose — the
  //     real name begins after them)
  //   - a word whose prefix is an opening quote / paren / bracket
  //   - the word immediately after a content word ending in . ! ? : ;
  //   - a word whose lowercase core ends in a personal-name surname suffix
  //     (-ов / -ев / -ски / -ий ...) — preserves "Иван Вазов", "Гоце Делчев"
  let sawTitleCased = false;
  let prevEndedSentence = false;
  for (const w of words) {
    if (w.isWhitespace) continue;

    const isSentenceStart =
      (w.titleCased && !sawTitleCased) ||
      prevEndedSentence ||
      SENTENCE_BOUNDARY_RE.test(w.prefix) ||
      (w.titleCased && SURNAME_SUFFIX_RE.test(w.core.toLowerCase()));

    if (w.titleCased && !isSentenceStart) {
      // Lowercase the first letter of the (already title-cased) core.
      w.out = w.prefix + lowerFirst(w.core) + w.suffix;
    }

    if (w.titleCased) sawTitleCased = true;
    prevEndedSentence = ENDS_WITH_SENTENCE_BOUNDARY_RE.test(w.suffix);
  }

  return words.map((w) => w.out).join("");
};

/**
 * Drop the definite-article suffix on the first word of a ministry-style
 * name ("Министерството на финансите" → "Министерство на финансите"). Used
 * by the budget law parser, which alone emits the definite-article form.
 * Idempotent on already-canonical names.
 */
export const stripDefiniteArticle = (name: string): string => {
  let out = name;
  for (const re of DEFINITE_ARTICLE_PATTERNS) out = out.replace(re, "");
  return out;
};

/**
 * Convert a section / heading label to sentence case. Less aggressive than
 * `normaliseOrgName` — preserves a leading Roman-numeral or Arabic-numeral
 * marker ("I.", "1.") so budget section headers like
 * "I. ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ" become "I. Приходи, помощи и дарения".
 */
export const sentenceCaseLabel = (label: string): string => {
  if (!label) return label;
  // Pull off an optional leading section marker ("I.", "1.2", "А.") and
  // pass the rest through the org normaliser.
  const m = label.match(/^([IVXLCDM]+\.|\d+(?:\.\d+)*\.?|[А-Я]\.)\s+(.+)$/u);
  if (!m) return normaliseOrgName(label);
  return `${m[1]} ${normaliseOrgName(m[2])}`;
};
