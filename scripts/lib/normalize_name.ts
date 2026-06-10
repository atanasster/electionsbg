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
//        - If the surrounding name has ANY lowercase context (i.e. it is NOT
//          a wholesale-shouted name), this all-upper token is an embedded
//          acronym / initialism / Latin brand / Roman numeral — KEEP UPPER.
//          This is the key signal: in "по чл.166 от ЗУТ", "ремонт … ЦГЧ, …",
//          "монитор HP" the all-caps tokens are acronyms, not words that need
//          de-shouting. Only when the ENTIRE name is upper ("ОБЩИНА ВИДИН")
//          do we fall through to:
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

// Settlement-name patterns where the second word should always be
// title-cased even if the source typed it lowercase. The ИСУН register
// has many "Община кресна" / "Община пловдив" entries with inconsistent
// casing of the settlement name; this regex rewrites them to "Община
// Кресна" / "Община Пловдив" so the same city reads the same wherever it
// appears.
const SETTLEMENT_PREFIX_RE =
  /^(Община|Град|Област|гр\.|с\.) ([а-я])([\p{L}'’-]*)/u;

const fixSettlementCasing = (s: string): string =>
  s.replace(
    SETTLEMENT_PREFIX_RE,
    (_m, prefix, first, rest) => `${prefix} ${first.toUpperCase()}${rest}`,
  );

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

// A "de-shoutable" word is a 4+ letter, Cyrillic-only, all-upper token that
// is NOT a known acronym or Roman numeral. In isolation inside an otherwise
// lowercase name such a token is an embedded acronym we keep upper (ГПЧЕ,
// ЦНСТПЛУИ, ПУДОС). But TWO OR MORE in a row are a SHOUTED PHRASE, not a
// string of acronyms ("БЮДЖЕТНО САЛДО (дефицит)", "ОСНОВЕН РЕМОНТ на …",
// "СТРОИТЕЛНА КОМПАНИЯ ЕООД (в ликвидация)") — those runs get de-shouted.
// Latin all-upper tokens are deliberately excluded: consecutive Latin caps
// are brands/models ("ACER VERITION", "RED HAT") and stay upper.
const CYRILLIC_ONLY_RE = /^[Ѐ-ӿ]+$/;
const isDeshoutableWord = (core: string): boolean =>
  core.length >= 4 &&
  isAllUpperLetters(core) &&
  CYRILLIC_ONLY_RE.test(core) &&
  !ACRONYMS.has(core) &&
  !ROMAN_NUMERAL_RE.test(core);

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

const buildWord = (raw: string, embeddedAcronymMode: boolean): Word => {
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
  // 3b. Short all-upper tokens (2-3 letters) are almost always acronyms —
  // brand initials like "ВМ Петролеум" / "СК Билдинг" / "АИВ Груп" that
  // aren't worth maintaining in the explicit acronym list. Treat as
  // acronym (keep upper, NOT title-cased). This also catches "СК", "АД"
  // (already in the list) — idempotent. The function-word check above
  // already protected single-letter prepositions ("В", "С") and the
  // short ones ("на", "и", "от", "до", …) from getting captured here.
  if (
    upperCore.length >= 2 &&
    upperCore.length <= 3 &&
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
  // 3c. Embedded-acronym signal. If the name as a whole carries any
  // lowercase letter, then it is NOT a wholesale-shouted name and this
  // remaining all-upper token is (provisionally) an acronym / initialism /
  // Latin brand / Roman numeral that the source deliberately left capital —
  // keep it upper. This is what saves mid-string and 4+-letter acronyms the
  // explicit list can't enumerate: "ЦГЧ", "ЗУТ", "ПМС", "ГПЧЕ",
  // "ЦНСТПЛУИ", "ІV", "HP", "LED", "ACER". A later pass in normaliseOrgName
  // re-shouts down RUNS of 2+ consecutive Cyrillic caps words (a shouted
  // phrase, not a string of acronyms). Only fall through to title-casing
  // here when the ENTIRE name is upper (no lowercase context at all), e.g.
  // "ОБЩИНА ВИДИН" → "Община Видин", "ВМ ПЕТРОЛЕУМ ООД" → "ВМ Петролеум ООД".
  // Gated on embeddedAcronymMode (opt-in): org-name callers skip this so a
  // shouted brand word ("ФЬОНИКС") falls through to title-casing below.
  if (embeddedAcronymMode) {
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
export const normaliseOrgName = (
  name: string,
  opts?: { preserveEmbeddedAcronyms?: boolean },
): string => {
  if (!name) return name;
  const tokens = name.split(/(\s+)/);
  // Whole-name context: does ANY token already carry a lowercase letter?
  const hasLowercaseContext = tokens.some((t) => /\p{Ll}/u.test(t));
  // Embedded-acronym mode (opt-in, OFF by default). When ON, an *isolated*
  // all-upper token inside a mixed-case name is assumed to be an embedded
  // acronym and KEPT upper (only RUNS of 2+ get de-shouted) — correct for
  // free-text descriptions like "ремонт на ЦГЧ … в ГПЧЕ". When OFF — the
  // org-name callers (procurement / funds / financing / declarations) — such
  // a token is a shouted brand word and gets de-shouted ("ФЬОНИКС Фарма" →
  // "Фьоникс Фарма"; "(ОДМВР) - ВЕЛИКО ТЪРНОВО" → "(ОДМВР) - Велико
  // търново"), while paren-acronyms (buildWord step 3) and 2-3-letter brand
  // initials (step 3b) stay upper. Curated 4+-letter acronyms (ГПЧЕ, ЦНСТ*)
  // are restored afterward by repairTitleCasedAcronym. Both modes are locked
  // by scripts/lib/__test_normalize_name.ts.
  const embeddedAcronymMode =
    (opts?.preserveEmbeddedAcronyms ?? false) && hasLowercaseContext;
  const words: Word[] = tokens.map((t) => buildWord(t, embeddedAcronymMode));

  // De-shout pass (embedded-acronym mode only). buildWord left every isolated
  // all-upper token capital on the assumption it is an acronym. Re-scan the
  // content words for RUNS of 2+ consecutive de-shoutable words (4+ letter
  // Cyrillic caps, not a known acronym) — a run is a shouted phrase, so
  // title-case each word in it. A SINGLE isolated de-shoutable word stays
  // upper (it is an embedded acronym like ГПЧЕ / ЦНСТПЛУИ). "БЮДЖЕТНО САЛДО
  // (дефицит)" → both title-cased; "по чл.166 от ЗУТ" → ЗУТ untouched.
  if (embeddedAcronymMode) {
    const content = words.filter((w) => !w.isWhitespace && w.core.length > 0);
    let i = 0;
    while (i < content.length) {
      if (!isDeshoutableWord(content[i].core)) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < content.length && isDeshoutableWord(content[j].core)) j += 1;
      if (j - i >= 2) {
        for (let k = i; k < j; k++) {
          const w = content[k];
          w.core = titleCase(w.core);
          w.out = w.prefix + w.core + w.suffix;
          w.titleCased = true;
        }
      }
      i = j;
    }
  }

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

  // Last pass: settlement-name pattern — "Община пловдив" → "Община
  // Пловдив". The mixed-case input wouldn't otherwise trigger any branch.
  return fixSettlementCasing(words.map((w) => w.out).join(""));
};

/**
 * Repair the "title-cased first-letter-acronym" pattern that earlier
 * normalisation passes (before the 2-3-letter acronym heuristic landed)
 * left in the data: "Вм петролеум ООД" → "ВМ Петролеум ООД". Only kicks
 * in when the first content word is exactly 2-3 Cyrillic/Latin letters
 * with the FIRST letter uppercase and the REST lowercase (the signature
 * of a previously-titled all-caps token). The next word, if present and
 * all-lowercase, is upper-cased on its first letter.
 *
 * Idempotent on already-correct names: "ВМ Петролеум ООД" stays as-is
 * because the first word doesn't match `[А-Я][а-я]+`. Safe to apply
 * across the whole on-disk corpus.
 */
// Separator matched between the acronym prefix and the following word —
// accepts plain whitespace OR a dash with optional surrounding spaces
// ("Гбс - пловдив" → "ГБС - Пловдив").
const REPAIR_PREFIX_RE = /^([\p{Lu}][\p{Ll}]{1,2})(\s+|\s*-\s*)([\p{Ll}])/u;

export const repairTitleCasedAcronym = (name: string): string => {
  if (!name) return name;
  const m = REPAIR_PREFIX_RE.exec(name);
  if (!m) return name;
  const [, prefix, sep, nextFirst] = m;
  // Skip Bulgarian function-word starts ("На", "За", "По", "Че", "Със",
  // "Без" etc) — those are mid-sentence words that genuinely belong in
  // title case at the start of a name.
  if (LOWERCASE_FUNCTION_WORDS.has(prefix.toLowerCase())) return name;
  // Defensive — regex wouldn't have matched, but guard against changes.
  if (prefix.toUpperCase() === prefix) return name;
  const upper = prefix.toUpperCase();
  const nextUpper = nextFirst.toUpperCase();
  return name.replace(REPAIR_PREFIX_RE, `${upper}${sep}${nextUpper}`);
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

// Bulgarian institutional / technical acronyms that an upstream OCR or
// extraction step (Gemini Vision, some CMS XLSX exports) routinely
// title-cases because it doesn't recognise them — "ГПЧЕ" → "Гпче",
// "МБАЛ" → "Мбал". Unlike the all-caps inputs `normaliseOrgName` handles,
// these arrive ALREADY title-cased (so the normaliser leaves them alone),
// which is why a dedicated restore pass exists. The set is curated to 3+
// letter tokens that never collide with a real Bulgarian word; the ЦНСТ* /
// СБАЛ* families have variable suffixes (ЦНСТДБУ, ЦНСТПЛУИ, СБАЛОЗ) so they
// are prefix-matched.
const RESTORE_ACRONYMS = new Set<string>([
  // 3+ letter institutional / technical acronyms (no real Bulgarian word
  // collides with any of these as a whole token, in any case).
  "ГПЧЕ",
  "МБАЛ",
  "УМБАЛ",
  "ДКЦ",
  "ЦСМП",
  "ПСОВ",
  "ПСПВ",
  "ОВК",
  "КПС",
  "СОУ",
  "ПГИ",
  "ПГТ",
  "ПГСС",
  "ПМГ",
  "ППМГ",
  "ОДЗ",
  "ЦДГ",
  "ЦПЛР",
  "ЦОП",
  "ЦСРИ",
  "ЦПЗ",
  "УПИ",
  "ПУП",
  "РУП",
  "ПУР",
  "ПВЦ",
  "СМР",
  "ЦГЧ",
  "ППР",
  "СОПФ",
  "ПУДОС",
  "ПУДООС",
  // СБАЛ* hospital family — listed explicitly (NOT prefix-matched) because
  // the prefix "СБАЛ" would also swallow the real word "сбалансиран".
  "СБАЛ",
  "СБАЛО",
  "СБАЛОЗ",
  "СБАЛАГ",
  "СБАЛК",
  "СБАЛББ",
  // Vetted 2-letter acronyms that appear title/lower-cased in OCR output and
  // are never standalone Bulgarian words (тп/ип/ор).
  "ТП",
  "ИП",
  "ОР",
]);
// Only ЦНСТ* is prefix-matched — no Bulgarian word begins "цнст", so the
// variable-suffix ЦНСТДБУ / ЦНСТПЛУИ etc. are safe to catch by prefix.
const RESTORE_ACRONYM_PREFIXES = ["ЦНСТ"];

/**
 * Restore ALL-CAPS casing to Bulgarian institutional acronyms an OCR /
 * extraction step left mis-cased — "Цнстплуи" / "цнстплуи" → "ЦНСТПЛУИ",
 * "Гпче" → "ГПЧЕ", "сопф" → "СОПФ". Matches a curated set (and the ЦНСТ*
 * family) case-INSENSITIVELY as a whole token, so it fixes title-cased,
 * lower-cased, and mixed-case manglings alike. Non-acronym words and
 * already-ALL-CAPS tokens pass through unchanged, so it is idempotent and
 * safe to apply across the whole on-disk corpus.
 */
export const restoreAcronyms = (text: string): string => {
  if (!text) return text;
  return text.replace(/[\p{L}]+/gu, (tok) => {
    const up = tok.toUpperCase();
    if (up === tok) return tok; // already all-caps → nothing to restore
    if (RESTORE_ACRONYMS.has(up)) return up;
    if (RESTORE_ACRONYM_PREFIXES.some((p) => up.startsWith(p))) return up;
    return tok;
  });
};
