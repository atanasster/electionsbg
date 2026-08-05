// Normalise a free-text judicial institution name onto a canonical body.
//
// WHY THIS EXISTS. `magistrate.court` is whatever the ИВСС declaration form captured —
// 975 distinct strings for what is really ~330 institutions. `Административен съд -
// Бургас`, `Административен съд Бургас` and `АДМИНИСТРАТИВЕН СЪД БУРГАС` are one court;
// `ОСлО при ОП-Видин`, `ОСлО в Окръжна прокуратура - Видин` and `ОСлО-ОП-Видин` are one
// investigation department. Until they fold onto one code, a magistrate's institution
// cannot be joined, counted, or given a place.
//
// `court_load` is NOT a usable dimension for this on its own: it covers courts only (no
// прокуратури, no следствени отдели) and is itself unnormalised (`АдмС - Благоевград`
// AND `АдмС Благоевград` are both rows). It is used as a SEED for the court half —
// it is the only source that carries a tier and a seat per court — and everything else
// is parsed here.
//
// The parser is deliberately RULE-BASED and total: anything it cannot classify returns
// null rather than a guess, and the loader reports those instead of inventing a body.
// A wrong court on a magistrate's public profile is a misstatement about a named person.
//
// It is also TYPO-TOLERANT, within a closed lexicon — see "Typo tolerance" below. The
// form is typed by hand, so most of what the dictionary could not classify was a single
// slip (`прокуратра`, `Хаскопво`, `Роайонен`), where the institution is not in doubt and
// only its spelling is. Every correction is reported through `onFix`, so a slip the
// parser papered over is visible to the operator rather than silently folded away.

// One definition, shared with the screen and the prerender builder that render
// this vocabulary (src/lib/judicialKind.ts), so a fifth kind cannot exist in the
// loader while the pages still show four.
export type { JudicialKind } from "@/lib/judicialKind";
import type { JudicialKind } from "@/lib/judicialKind";

export type JudicialTier =
  | "районен"
  | "окръжен"
  | "градски"
  | "апелативен"
  | "административен"
  | "върховен"
  | "военен"
  | "специализиран"
  | "национален";

export type JudicialBody = {
  bodyCode: string;
  name: string;
  kind: JudicialKind;
  tier: JudicialTier;
  /** Settlement the body sits in, Bulgarian. Null for national bodies with no seat
   *  distinct from Sofia's, which are still seated in Sofia — see NATIONAL below. */
  place: string | null;
};

/**
 * Settlement vocabulary: normalised name → canonical spelling. Supplying it is what
 * makes the module's "never guess" contract TRUE — without a vocabulary the seat is
 * whatever residue a regex leaves, so `Районен съд - Плевн` silently mints a body for a
 * town that does not exist and splits Плевен's real court in two. It also fixes the
 * casing (`НОВИ ПАЗАР` → `Нови пазар`), which a title-caser cannot do.
 *
 * Callers that only care about the SHAPE of a name (tests asserting which rule fires)
 * may omit it; production callers must not.
 */
export type PlaceVocabulary = ReadonlyMap<string, string>;

/** The key both sides of the vocabulary lookup use. */
export const placeKey = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[^А-ЯЁA-Z0-9]+/g, " ")
    .trim();

/** Build a vocabulary from {name} rows (data/municipalities.json). */
export const placeVocabulary = (names: Iterable<string>): PlaceVocabulary => {
  const m = new Map<string, string>();
  for (const n of names) if (n && !m.has(placeKey(n))) m.set(placeKey(n), n);
  return m;
};

/** Latin slug for a Bulgarian settlement/word, for use inside a body_code. */
const slug = (s: string): string => {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
    р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch",
    ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya",
  }; // prettier-ignore
  return s
    .toLowerCase()
    .split("")
    .map((c) => map[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

// City ADJECTIVE → city name. The register writes both "Районен съд Бургас" and
// "Бургаски районен съд"; only Sofia's adjectival forms are official institution names
// (Софийски районен съд IS the court's name), but the others occur and must fold.
const ADJECTIVE_CITY: Record<string, string> = {
  СОФИЙСКИ: "София",
  СОФИЙСКА: "София",
  // Two spellings that are simply misspelt in the source.
  СОФИЙКИ: "София",
  СОФИСКИ: "София",
  БУРГАСКИ: "Бургас",
  БУРГАСКА: "Бургас",
  ПЛОВДИВСКИ: "Пловдив",
  ПЛОВДИВСКА: "Пловдив",
  ВРАЧАНСКИ: "Враца",
  ВРАЧАНСКА: "Враца",
  ВАРНЕНСКИ: "Варна",
  ВАРНЕНСКА: "Варна",
  ПАЗАРДЖИШКИ: "Пазарджик",
  ПАЗАРДЖИШКА: "Пазарджик",
  САМОКОВСКИ: "Самоков",
  СЛИВЕНСКИ: "Сливен",
  СЛИВЕНСКА: "Сливен",
  СОФИЙСКИЯТ: "София",
  СОФИЙСКАТА: "София",
};

// Fixed national institutions, matched on a normalised form or a bare abbreviation.
// All are seated in Sofia; `place` records that rather than leaving a hole, because the
// seat is a real fact and a NULL would read as "unknown".
const NATIONAL: { match: RegExp; body: Omit<JudicialBody, "place"> }[] = [
  {
    match: /^(ВКС|ВЪРХОВЕН КАСАЦИОНЕН СЪД)$/,
    body: {
      bodyCode: "vks",
      name: "Върховен касационен съд",
      kind: "court",
      tier: "върховен",
    },
  },
  {
    match: /^(ВАС|ВЪРХОВЕН АДМИНИСТРАТИВЕН СЪД)$/,
    body: {
      bodyCode: "vas",
      name: "Върховен административен съд",
      kind: "court",
      tier: "върховен",
    },
  },
  {
    match: /^(ВКП|ВЪРХОВНА КАСАЦИОННА ПРОКУРАТУРА)$/,
    body: {
      bodyCode: "vkp",
      name: "Върховна касационна прокуратура",
      kind: "prosecution",
      tier: "върховен",
    },
  },
  {
    match: /^(ВАП|ВЪРХОВНА АДМИНИСТРАТИВНА ПРОКУРАТУРА)$/,
    body: {
      bodyCode: "vap",
      name: "Върховна административна прокуратура",
      kind: "prosecution",
      tier: "върховен",
    },
  },
  {
    match: /^(НСЛС|НАЦИОНАЛНА СЛЕДСТВЕНА СЛУЖБА)$/,
    body: {
      bodyCode: "nsls",
      name: "Национална следствена служба",
      kind: "investigation",
      tier: "национален",
    },
  },
  {
    match: /^(ПРБ|ПРОКУРАТУРА|ПРОКУРАТУРА РЕПУБЛИКА БЪЛГАРИЯ)$/,
    body: {
      bodyCode: "prb",
      name: "Прокуратура на Република България",
      kind: "prosecution",
      tier: "национален",
    },
  },
  {
    match: /^(ВСС|ВИСШ СЪДЕБЕН СЪВЕТ)$/,
    body: {
      bodyCode: "vss",
      name: "Висш съдебен съвет",
      kind: "council",
      tier: "национален",
    },
  },
  {
    match: /^(ИВСС|ИНСПЕКТОРАТ КЪМ ВИСШИЯ СЪДЕБЕН СЪВЕТ|ИНСПЕКТОРАТ КЪМ ВСС)$/,
    body: {
      bodyCode: "ivss",
      name: "Инспекторат към Висшия съдебен съвет",
      kind: "council",
      tier: "национален",
    },
  },
  // Sofia's own institutions. Their official names are ADJECTIVAL ("Софийски градски
  // съд"), which foldJudicialName rewrites into the seat-suffixed order every other
  // institution uses ("ГРАДСКИ СЪД СОФИЯ") — so these match on that order. They are
  // listed as NATIONAL rather than SEATED because they are checked FIRST: without that,
  // "Софийски районен съд" would fall through to the generic районен-съд rule and mint
  // `rs-sofiya` instead of the real court's own code.
  {
    match: /^(СГС|ГРАДСКИ СЪД СОФИЯ)$/,
    body: {
      bodyCode: "sgs",
      name: "Софийски градски съд",
      kind: "court",
      tier: "градски",
    },
  },
  {
    match: /^(СРС|РАЙОНЕН СЪД СОФИЯ)$/,
    body: {
      bodyCode: "srs",
      name: "Софийски районен съд",
      kind: "court",
      tier: "районен",
    },
  },
  {
    match: /^(СОС|ОКРЪЖЕН СЪД СОФИЯ)$/,
    body: {
      bodyCode: "sos",
      name: "Софийски окръжен съд",
      kind: "court",
      tier: "окръжен",
    },
  },
  {
    match: /^(СГП|ГРАДСКА ПРОКУРАТУРА СОФИЯ|ГРАДСКА ПРОКУРАТУРА)$/,
    body: {
      bodyCode: "sgp",
      name: "Софийска градска прокуратура",
      kind: "prosecution",
      tier: "градски",
    },
  },
  {
    match: /^(СРП|РАЙОННА ПРОКУРАТУРА СОФИЯ)$/,
    body: {
      bodyCode: "srp",
      name: "Софийска районна прокуратура",
      kind: "prosecution",
      tier: "районен",
    },
  },
  {
    match: /^(СОП|ОКРЪЖНА ПРОКУРАТУРА СОФИЯ)$/,
    body: {
      bodyCode: "sop",
      name: "Софийска окръжна прокуратура",
      kind: "prosecution",
      tier: "окръжен",
    },
  },
  {
    match: /^(АССГ|АДМИНИСТРАТИВЕН СЪД СОФИЯ ГРАД)$/,
    body: {
      bodyCode: "as-sofia-grad",
      name: "Административен съд София-град",
      kind: "court",
      tier: "административен",
    },
  },
  {
    match: /^(АССО|АДМИНИСТРАТИВЕН СЪД СОФИЯ ОБЛАСТ)$/,
    body: {
      bodyCode: "as-sofia-oblast",
      name: "Административен съд София-област",
      kind: "court",
      tier: "административен",
    },
  },
  // The Следствен отдел of the Sofia city prosecution — written half a dozen ways
  // ("СО-СГП", "СлО в СГП", "СГП - Следствен отдел", "Следствен отдел при СГП").
  {
    match: /^(СО СГП|СГП СО|СЛО СГП|СГП СЛЕДСТВЕН ОТДЕЛ|СЛЕДСТВЕН ОТДЕЛ СГП)$/,
    body: {
      bodyCode: "so-sgp",
      name: "Следствен отдел при Софийска градска прокуратура",
      kind: "investigation",
      tier: "градски",
    },
  },
];

// Seat-suffixed institutions: `<pattern> <settlement>`. Ordered — the first match wins,
// so longer/more specific prefixes must precede their own prefixes (военно-окръжна
// before окръжна, административен before the bare съд forms).
const SEATED: {
  match: RegExp;
  kind: JudicialKind;
  tier: JudicialTier;
  prefix: string;
  name: (place: string) => string;
}[] = [
  // ---- military (must precede the civilian окръжна/апелативна forms) --------------
  {
    match: /^ВОЕННО ?ОКРЪЖНА ПРОКУРАТУРА\s+(.+)$/,
    kind: "prosecution",
    tier: "военен",
    prefix: "vop",
    name: (p) => `Военно-окръжна прокуратура — ${p}`,
  },
  {
    match: /^ВОП\s+(.+)$/,
    kind: "prosecution",
    tier: "военен",
    prefix: "vop",
    name: (p) => `Военно-окръжна прокуратура — ${p}`,
  },
  {
    match: /^ВОЕНЕН СЪД\s+(.+)$/,
    kind: "court",
    tier: "военен",
    prefix: "vs",
    name: (p) => `Военен съд — ${p}`,
  },
  // ---- courts ---------------------------------------------------------------------
  // The misspellings these patterns used to spell out (АДМИНИСТРИТИВЕН, РЙОНЕН,
  // РАЙНОННА) are corrected by the typo layer before a rule is ever tried, so listing
  // them here again would be unreachable. judicialBodies.test.ts keeps them covered.
  //
  // The ABBREVIATION alternations below (`|АДМС`, `|АПС`, `|ОС`, `|РС`, `|АП`, `|ОП`,
  // `|РП`, and the standalone ВОП rule above) are in the same position and are KEPT
  // anyway: expandInstitutionAbbrev spells every one of them out during the fold, so
  // nothing reaches here abbreviated today. They are the fallback for the day someone
  // reorders the fold — a parser whose failure mode is attributing a court's caseload
  // to the wrong institution is the wrong place to remove a redundant branch. Do not
  // read them as evidence that both spellings still arrive.
  {
    match: /^(?:АДМИНИСТРАТИВЕН СЪД|АДМС)\s+(.+)$/,
    kind: "court",
    tier: "административен",
    prefix: "as",
    name: (p) => `Административен съд — ${p}`,
  },
  {
    match: /^(?:АПЕЛАТИВЕН СЪД|АПС)\s+(.+)$/,
    kind: "court",
    tier: "апелативен",
    prefix: "aps",
    name: (p) => `Апелативен съд — ${p}`,
  },
  {
    match: /^(?:ОКРЪЖЕН СЪД|ОС)\s+(.+)$/,
    kind: "court",
    tier: "окръжен",
    prefix: "os",
    name: (p) => `Окръжен съд — ${p}`,
  },
  {
    match: /^(?:РАЙОНЕН СЪД|РС)\s+(.+)$/,
    kind: "court",
    tier: "районен",
    prefix: "rs",
    name: (p) => `Районен съд — ${p}`,
  },
  // ---- prosecution ----------------------------------------------------------------
  {
    match: /^(?:АПЕЛАТИВНА ПРОКУРАТУРА|АП)\s+(.+)$/,
    kind: "prosecution",
    tier: "апелативен",
    prefix: "ap",
    name: (p) => `Апелативна прокуратура — ${p}`,
  },
  {
    match: /^(?:ОКРЪЖНА ПРОКУРАТУРА|ОП)\s+(.+)$/,
    kind: "prosecution",
    tier: "окръжен",
    prefix: "op",
    name: (p) => `Окръжна прокуратура — ${p}`,
  },
  {
    match: /^(?:РАЙОННА ПРОКУРАТУРА|РП)\s+(.+)$/,
    kind: "prosecution",
    tier: "районен",
    prefix: "rp",
    name: (p) => `Районна прокуратура — ${p}`,
  },
];

// Military appellate bodies have no seat suffix in practice.
const FIXED_MILITARY: { match: RegExp; body: Omit<JudicialBody, "place"> }[] = [
  {
    match: /^ВОЕННО ?АПЕЛАТИВНА ПРОКУРАТУРА(?: СОФИЯ)?$/,
    body: {
      bodyCode: "vap-mil",
      name: "Военно-апелативна прокуратура",
      kind: "prosecution",
      tier: "военен",
    },
  },
  {
    match: /^ВОЕННО ?АПЕЛАТИВЕН СЪД(?: СОФИЯ)?$/,
    body: {
      bodyCode: "vaps-mil",
      name: "Военно-апелативен съд",
      kind: "court",
      tier: "военен",
    },
  },
];

// ── Typo tolerance ───────────────────────────────────────────────────────────────────
// "Looks close" is not a rule, so the correction is BOUNDED and CLOSED: a token is
// rewritten only when it is within a small edit distance of exactly ONE entry of a fixed
// lexicon — the institution words below, or the settlement vocabulary. Two candidates at
// the same distance is an ambiguity, and an ambiguity keeps the old answer: no body,
// reported. That is what stops the tolerance from becoming the guessing this module
// exists to refuse.

/** Optimal string alignment distance: Levenshtein plus ADJACENT TRANSPOSITION, which is
 *  what a keyboard slip actually looks like — `КЮСТНЕДИЛ` is ONE transposition from
 *  `КЮСТЕНДИЛ` but two substitutions without it. Gives up as soon as no alignment can
 *  come in at or under `max`, so scanning the whole settlement vocabulary stays cheap.
 *  Exported for the radius invariant in judicialBodies.test.ts — it and placeSlips are
 *  the two parameters the whole safety argument rests on, so the test asserts on them
 *  directly rather than inferring them from an example. */
export const editDistance = (a: string, b: string, max: number): number => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let two: number[] = [];
  let one = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(cur[j - 1] + 1, one[j] + 1, one[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, two[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    two = one;
    one = cur;
  }
  return one[b.length];
};

/**
 * The one lexicon entry within `max` edits of `token` — or null when nothing is close
 * enough, or when two entries are equally close. A tie is the whole point: `БРЕЖОВО` is
 * one slip from both Брегово and Брезово, and picking either would put a magistrate in
 * a court 200km from the one they sit in.
 *
 * The scan is over the WHOLE lexicon, and that is load-bearing rather than lazy. Filtering
 * candidates by the token's own first letter reads as the conservative choice and is the
 * exact opposite: it hides the town a first-letter slip actually came from, so `ВЕЛОВО`
 * stops tying against Белово and quietly becomes Ветово — a real court 150km away, logged
 * through onFix as an ordinary-looking correction. Measured over every single-character
 * substitution of all 292 vocabulary names, that filter produced all 40 of the
 * wrong-town answers AND cost 8,043 correct recoveries; without it, 0 and 0. Widening the
 * candidate pool can only turn a match into a tie or into a strictly closer match — it can
 * never turn a refusal into a loose guess.
 */
const uniqueNearest = (
  token: string,
  lexicon: Iterable<string>,
  max: number,
): string | null => {
  if (max <= 0) return null;
  let best: string | null = null;
  let bestD = max + 1;
  let tied = false;
  for (const w of lexicon) {
    const d = editDistance(token, w, max);
    if (d > max) continue;
    if (d < bestD) {
      best = w;
      bestD = d;
      tied = false;
    } else if (d === bestD) tied = true;
  }
  return tied ? null : best;
};

/** Slips allowed in a SETTLEMENT name. Tight, because the vocabulary is 292 names and
 *  some are genuinely one edit apart (Брегово/Брезово, Кирково/Мирково): the radius is
 *  what decides how often the tie above fires instead of a match. Every misspelling in
 *  the register today is a single slip; the wider radius for long names is headroom for
 *  the next harvest, and no two settlement names of 10+ characters are within 2 of each
 *  other. judicialBodies.test.ts asserts that pair set over the whole vocabulary rather
 *  than leaving it here as a claim — data/municipalities.json is a moving input. */
export const placeSlips = (len: number): number =>
  len >= 10 ? 2 : len >= 5 ? 1 : 0;

/** Slips allowed in an institution word — looser, because the lexicon is 33 words rather
 *  than 292 names and they are far apart. */
const wordSlips = (len: number): number => (len >= 8 ? 2 : len >= 4 ? 1 : 0);

/**
 * Every word that appears in a Bulgarian judicial institution's name, and nothing else.
 * The list being CLOSED is what makes the correction safe: a token more than a slip from
 * all of them is left exactly as typed, which is how settlement names pass through
 * untouched. judicialBodies.test.ts asserts no settlement name is within wordSlips() of
 * any entry here — that invariant, not a case list, is what keeps a seat from being
 * "corrected" into an institution word.
 *
 * The city adjectives (СОФИЙСКИ/СОФИЙСКА and friends) are deliberately NOT here: their
 * masculine and feminine forms are one edit apart, so every slip on one ties against the
 * other and corrects to neither. ADJECTIVE_CITY carries the misspellings that occur.
 */
export const INSTITUTION_WORDS = [
  "АДМИНИСТРАТИВЕН",
  "АДМИНИСТРАТИВНА",
  "АПЕЛАТИВЕН",
  "АПЕЛАТИВНА",
  "ВИСШ",
  "ВОЕНЕН",
  "ВОЕННА",
  "ВОЕННО",
  "ВЪРХОВЕН",
  "ВЪРХОВНА",
  "ГРАДСКА",
  "ГРАДСКИ",
  "ИНСПЕКТОРАТ",
  "КАСАЦИОНЕН",
  "КАСАЦИОННА",
  "НАЦИОНАЛЕН",
  "НАЦИОНАЛНА",
  "ОКРЪЖЕН",
  "ОКРЪЖНА",
  "ОТДЕЛ",
  "ПРОКУРАТУРА",
  "ПРОКУРОР",
  "РАЙОНЕН",
  "РАЙОННА",
  "СЛЕДОВАТЕЛ",
  "СЛЕДСТВЕН",
  "СЛЕДСТВЕНА",
  "СЛУЖБА",
  "СПЕЦИАЛИЗИРАН",
  "СЪВЕТ",
  "СЪД",
  "СЪДЕБЕН",
  "СЪДИЯ",
] as const;

/** The declarant's own ROLE, which the form invites into the institution field
 *  ("съдия в СРС", "Прокурор в РП - Варна"). Dropped only when something else remains:
 *  a bare "Прокурор" names no institution and must stay unresolved. */
const ROLE_WORDS = new Set(["СЪДИЯ", "СЪДИЯТА", "ПРОКУРОР", "СЛЕДОВАТЕЛ"]);

/** Composite office abbreviations the register uses without expanding them. ВТОП is the
 *  Великотърновска окръжна прокуратура — a documented abbreviation, expanded here rather
 *  than pattern-matched so the ОСлО attached to it resolves through the ordinary rules.
 *  NOT a place to put anything colliding with an existing rule: ВОП is военно-окръжна. */
const COMPOSITE_ABBREV: Record<string, string> = {
  ВТОП: "ОП ВЕЛИКО ТЪРНОВО",
};

/** One spelling slip the parser corrected, reported so the operator can audit it. */
export type NameFix = { from: string; to: string };

/**
 * Fold a raw institution string to a comparison key: uppercase, dashes and punctuation
 * to spaces, whitespace collapsed. Also rewrites the city ADJECTIVE forms
 * ("Софийски районен съд" → "СОФИЯ РАЙОНЕН СЪД") so the adjectival and seat-suffixed
 * spellings of one institution land on the same key.
 *
 * The output is the alias key (`judicial_body_alias.alias_norm`), so it must be
 * REPRODUCIBLE from a raw string alone: everything it does is vocabulary-independent
 * except the glued-abbreviation split, which is why resolve_persons.ts can fold without
 * one. Settlement spellings are NOT corrected here — that happens in restorePlace, after
 * the seat has been identified.
 */
export const foldJudicialName = (
  raw: string,
  vocab?: PlaceVocabulary,
  onFix?: (fix: NameFix) => void,
): string => {
  let s = raw
    .toUpperCase()
    .replace(/[»«"'`]/g, " ")
    .replace(/[-–—/,.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Territorial sub-offices ("РП Стара Загора - ТО Казанлък") fold to their parent: a
  // ТО is not a separate institution, it is a desk of the районна прокуратура.
  s = s.replace(/\s+(?:ТО|ТЕРИТОРИАЛНО ОТДЕЛЕНИЕ)\s+.+$/, "");
  // Glued abbreviations ("РПКюстендил") — split a known prefix off the seat.
  // A settlement qualifier ("гр. Бургас", "Районен съд град Русе") carries nothing, and
  // leaving it in makes a duplicate body for every court that has one. Done token-wise
  // rather than by regex: JS \b does not apply to Cyrillic, and the ГРАД in "София град"
  // is MEANINGFUL — it is what distinguishes АССГ from АССО.
  s = s
    .split(" ")
    .filter(
      (tok, i, all) =>
        !((tok === "ГР" || tok === "ГРАД") && all[i - 1] !== "СОФИЯ" && i > 0),
    )
    .join(" ");
  // Connectors carry no meaning here and appear in every combination
  // ("ОСлО при ОП-Видин", "ОСлО в Окръжна прокуратура - Бургас", "ОСлО към ОП Пловдив",
  // "Окръжен следствен отдел във ВТОП").
  s = s.replace(/\s+(?:ПРИ|КЪМ|НА|В|ВЪВ)\s+/g, " ");
  // A spaced-out abbreviation — "Следствен отдел при О П София", "ОКРЪЖЕН СЪ Д- МОНТАНА".
  // A stray single letter can only belong to the stub before it, and only when that stub
  // is itself too short to be a word. Runs AFTER the connectors, so the standalone "в" is
  // already gone and cannot be glued onto anything.
  s = s
    .split(" ")
    .reduce<string[]>((acc, tok) => {
      const prev = acc[acc.length - 1];
      if (acc.length && tok.length === 1 && prev.length <= 2)
        acc[acc.length - 1] = prev + tok;
      else acc.push(tok);
      return acc;
    }, [])
    .join(" ");
  // Glued abbreviations ("РПКюстендил"). A bare `(?=[А-Я]{3})` lookahead cannot tell a
  // run-together seat from the continuation of a spelled-out word, and split every
  // АПЕЛАТИВЕН into АП + ЕЛАТИВЕН — minting fabricated prosecution offices for all 45
  // appellate spellings. So the split only happens when the remainder is a settlement
  // the vocabulary knows, and never at all without one.
  if (vocab)
    s = s.replace(
      /^(ОСЛО|ОСО|СЛО|РП|ОП|РС|ОС|ВОП)([А-Я]{3,})/,
      (whole, abbr: string, tail: string) =>
        vocab.has(placeKey(tail)) ? `${abbr} ${tail}` : whole,
    );
  s = s
    .split(" ")
    .map((tok) => COMPOSITE_ABBREV[tok] ?? tok)
    .join(" ");
  // Correct the hand-typed slips in the institution words themselves ("прокуратра",
  // "Роайонен", "съдз"). Settlement tokens survive this untouched — see INSTITUTION_WORDS.
  s = s
    .split(" ")
    .map((tok) => {
      const hit = uniqueNearest(tok, INSTITUTION_WORDS, wordSlips(tok.length));
      if (!hit || hit === tok) return tok;
      onFix?.({ from: tok, to: hit });
      return hit;
    })
    .join(" ");
  // The declarant's own role and the country they serve are not the institution.
  const tokens = s.split(" ").filter(Boolean);
  while (tokens.length > 1 && ROLE_WORDS.has(tokens[0])) tokens.shift();
  if (tokens.length > 1 && tokens[tokens.length - 1] === "РБ") tokens.pop();
  s = tokens.join(" ");
  const [head, ...rest] = s.split(" ");
  // Rewrite the adjectival form into the seat-suffixed order every other institution
  // uses: "Бургаски районен съд" → "РАЙОНЕН СЪД БУРГАС". Sofia's institutions land on
  // "GRADSKI SAD SOFIA"-shaped keys, which is what the NATIONAL patterns match.
  if (ADJECTIVE_CITY[head] && rest.length)
    s = [...rest, ADJECTIVE_CITY[head].toUpperCase()].join(" ");
  s = expandInstitutionAbbrev(s);
  return s.replace(/\s+/g, " ").trim();
};

/** Institution-type abbreviations, spelled out. `АС` and `ВС` are deliberately
 *  ABSENT: they collide across families (`АС` is Апелативен съд in court_load
 *  and Административен съд in the ИВСС register, `ВС` is Военен съд), and the
 *  string cannot settle it — resolveJudicialBody's `tier` hint does. */
const INSTITUTION_ABBREV: Record<string, string> = {
  АДМС: "АДМИНИСТРАТИВЕН СЪД",
  АПС: "АПЕЛАТИВЕН СЪД",
  РС: "РАЙОНЕН СЪД",
  ОС: "ОКРЪЖЕН СЪД",
  АП: "АПЕЛАТИВНА ПРОКУРАТУРА",
  ОП: "ОКРЪЖНА ПРОКУРАТУРА",
  РП: "РАЙОННА ПРОКУРАТУРА",
  ВОП: "ВОЕННО ОКРЪЖНА ПРОКУРАТУРА",
};

/**
 * Spell out a LEADING institution-type abbreviation, so `РС София` and
 * `Районен съд София` are one key rather than two.
 *
 * WHY THIS IS IN THE FOLD AND NOT IN THE RULES. Every SEATED rule already
 * accepts both spellings (`/^(?:РАЙОНЕН СЪД|РС)\s+(.+)$/`), so for an ordinary
 * court either form resolves the same way and this changes nothing. It matters
 * for the institutions that have a CURATED entry in NATIONAL, which is checked
 * first precisely so `Софийски районен съд` cannot fall through to the generic
 * районен-съд rule and mint `rs-sofiya`. That defence only ever covered the
 * spelled-out spelling — and court_load, the ВСС's own workload series, writes
 * the abbreviated one (`РС-София`, `ОС - София`, `АдмС - София-град`). So the
 * abbreviated form sailed past the national rule into the seated one and minted
 * exactly the codes the national rule exists to prevent: five bodies
 * (`rs-sofiya`, `os-sofiya`, `op-sofiya`, `as-sofiya-grad`, `as-sofiya-oblast`)
 * that are the SAME institutions as `srs`, `sos`, `sop`, `as-sofia-grad` and
 * `as-sofia-oblast`, splitting each court's magistrates onto one page and its
 * workload onto another. `/court/as-sofia-grad` then stated that the ВСС
 * publishes no workload for it while publishing eight years of it next door.
 *
 * Folding here rather than widening the five national regexes closes the class
 * for these eight: a national entry added later is matched by both spellings
 * automatically. `АС` and `ВС` are NOT in the list and cannot be — they collide
 * across registers — so they reach a body through resolveJudicialBody's
 * tier-hinted branch instead, which re-tests NATIONAL itself for the same
 * reason. Between them the two paths cover every abbreviation the SEATED rules
 * accept.
 *
 * LEADING TOKEN ONLY, which is what keeps the investigation family intact —
 * `ОСлО при ОП-Видин` folds to `ОСЛО ОП ВИДИН`, whose head is `ОСЛО`, so its
 * parent-office abbreviation is untouched and resolveInvestigation still sees
 * the shape it expects.
 */
const expandInstitutionAbbrev = (s: string): string => {
  const [head, ...rest] = s.split(" ");
  const full = INSTITUTION_ABBREV[head];
  // Only with a seat after it: a bare `ОС` is not an окръжен съд, it is an
  // unresolvable stub, and inventing a body from it is the guessing this module
  // refuses to do.
  return full && rest.length ? [full, ...rest].join(" ") : s;
};

// The investigation family (следствени отдели) is the messiest: the department, its
// parent prosecution office, and the seat appear in any order and any combination —
// "ОСлО при ОП-Видин", "Окръжен следствен отдел Видин", "ОСлО-Сливен към ОП-Сливен",
// "Следствен отдел ОП Враца", "Окръжна следствена служба София". A regex per spelling
// does not converge, so this is handled structurally: identify the department head,
// drop the parent-office tokens, and take whatever seat remains.
// One literal, referenced by both the head-form and the suffix-form branch below.
const SO_SGP: JudicialBody = {
  bodyCode: "so-sgp",
  name: "Следствен отдел при Софийска градска прокуратура",
  kind: "investigation",
  tier: "градски",
  place: "София",
};

// Not anchored to the head: the register also writes the department as a TRAILING
// qualifier on its parent office ("Окръжна прокуратура Враца - ОСлО"), which read as a
// plain окръжна прокуратура and put an investigator in the prosecution office.
const INVESTIGATION_HEAD =
  /(?:^|\s)(ОКРЪЖЕН СЛЕДСТВЕН ОТДЕЛ|ОКРЪЖНА СЛЕДСТВЕНА СЛУЖБА|СЛЕДСТВЕНА СЛУЖБА|СЛЕДСТВЕН ОТДЕЛ|ОСЛО|ОСО|СЛО)(?=\s|$)/;

const resolveInvestigation = (
  folded: string,
  vocab?: PlaceVocabulary,
  onFix?: (fix: NameFix) => void,
): JudicialBody | null => {
  // The department is usually the head token, but the Sofia city office also writes it
  // as a SUFFIX ("Софийска градска прокуратура - СО").
  // The department token can land anywhere once the adjectival "Софийска" has been
  // rewritten to a trailing seat ("ГРАДСКА ПРОКУРАТУРА СО СОФИЯ"), so require the two
  // tokens to CO-OCCUR rather than anchoring the department to the end. Safe because a
  // bare "СО" only counts alongside an explicit Sofia city-prosecution token.
  if (
    /(?:^|\s)(?:СО|СЛО|СЛЕДСТВЕН ОТДЕЛ)(?=\s|$)/.test(folded) &&
    /(?:^|\s)(?:ГРАДСКА ПРОКУРАТУРА|СГП)(?=\s|$)/.test(folded)
  )
    return SO_SGP;
  if (!INVESTIGATION_HEAD.test(folded)) return null;
  let rest = folded.replace(INVESTIGATION_HEAD, " ").trim();
  // A department of the Sofia CITY prosecution is its own body, not an окръжен one.
  if (/(?:^|\s)(?:СГП|ГРАДСКА ПРОКУРАТУРА)(?=\s|$)/.test(rest)) return SO_SGP;
  // The Sofia OKRAG prosecution's department is seated in Sofia.
  if (/(?:^|\s)СОП(?=\s|$)/.test(rest))
    return {
      bodyCode: "oslo-sofiya",
      name: "Окръжен следствен отдел при Окръжна прокуратура — София",
      kind: "investigation",
      tier: "окръжен",
      place: "София",
    };
  // Drop the parent-office tokens; the seat is whatever is left. A seat repeated on both
  // sides ("ОСлО-Сливен към ОП-Сливен") collapses to one because the tokens are deduped.
  rest = rest
    .replace(/(?:^|\s)(?:ОКРЪЖНА ПРОКУРАТУРА|ОП|ПРОКУРАТУРА)(?=\s|$)/g, " ")
    .trim();
  const seat = [...new Set(rest.split(/\s+/).filter(Boolean))].join(" ");
  if (!seat) return null;
  const place = restorePlace(seat, vocab, onFix);
  if (!place) return null;
  return {
    bodyCode: `oslo-${slug(place)}`,
    name: `Окръжен следствен отдел при Окръжна прокуратура — ${place}`,
    kind: "investigation",
    tier: "окръжен",
    place,
  };
};

/**
 * Resolve a folded seat to its canonical settlement spelling, or null when it is not a
 * settlement at all. WITH a vocabulary this is exact — it both validates ("Плевн" is not
 * a town, so no body is minted) and fixes casing that a title-caser gets wrong ("Нови
 * пазар", "Червен бряг"). WITHOUT one it falls back to title-casing, which is why
 * production callers must always pass a vocabulary.
 */
const restorePlace = (
  p: string,
  vocab?: PlaceVocabulary,
  onFix?: (fix: NameFix) => void,
): string | null => {
  if (vocab) {
    const key = placeKey(p);
    const hit = vocab.get(key);
    if (hit) return hit;
    // Sofia's two administrative-court seats are qualifiers on the capital, not
    // settlements of their own, so they are never in a municipality vocabulary.
    if (/^СОФИЯ (ГРАД|ОБЛАСТ)$/.test(key))
      return key === "СОФИЯ ГРАД" ? "София-град" : "София-област";
    // A misspelling one slip from exactly ONE settlement IS that settlement: "Хаскопво"
    // is Хасково, and refusing it strands a real magistrate at a real court. Anything
    // further out, or close to two towns at once, still mints nothing.
    const near = uniqueNearest(key, vocab.keys(), placeSlips(key.length));
    if (!near) return null;
    const canonical = vocab.get(near) ?? null;
    if (canonical) onFix?.({ from: key, to: near });
    return canonical;
  }
  return titleCasePlace(p);
};

/** Title-case a settlement name that survived the uppercase fold. */
const titleCasePlace = (p: string): string => {
  // Only the forms the generic title-caser gets WRONG. "СТАРА ЗАГОРА" and friends it
  // already produces correctly, and in production the vocabulary supplies the canonical
  // spelling long before this fallback path is reached.
  const fixed: Record<string, string> = {
    "СОФИЯ ГРАД": "София-град",
    "СОФИЯ ОБЛАСТ": "София-област",
  };
  if (fixed[p]) return fixed[p];
  return p
    .split(" ")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
};

/**
 * Resolve one raw institution string to its canonical body, or null when the string
 * matches no rule. Null is a REPORTED outcome, never a guess — the loader logs the
 * unresolved strings so the dictionary can be extended deliberately.
 */
export type ResolveOptions = {
  /** Settlement vocabulary. Omit only in shape-only tests — see PlaceVocabulary. */
  vocab?: PlaceVocabulary;
  /** court_load's own tier for this row, which disambiguates the abbreviations that
   *  collide across families: `АС` is Апелативен съд there but Административен съд in
   *  the ИВСС register, and `ВС` is Военен съд. Never guessed from the string. */
  tier?: JudicialTier;
  /** Called for every spelling slip corrected on the way to the answer. The loader
   *  prints them: a correction the operator cannot see is indistinguishable from the
   *  guessing this module refuses to do. */
  onFix?: (fix: NameFix) => void;
};

/** Generic words a national institution is written WITH, none of which narrow it —
 *  "Прокуратура - СРП" is the Софийска районна прокуратура, not a fourth thing.
 *  "РБ" is here as well as in the fold, and neither is redundant: the fold only strips it
 *  TRAILING ("ВКС на РБ"), so a leading one ("РБ - ВКС") reaches this list and resolves
 *  only because of this entry. */
const FILLER = new Set([
  "ПРОКУРАТУРА",
  "СЪД",
  "СЛУЖБА",
  "ОТДЕЛ",
  "РЕПУБЛИКА",
  "БЪЛГАРИЯ",
  "РБ",
]);

export function resolveJudicialBody(
  raw: string,
  opts: ResolveOptions = {},
): JudicialBody | null {
  const { vocab, tier: tierHint, onFix } = opts;
  const folded = foldJudicialName(raw, vocab, onFix);
  if (!folded) return null;

  // National bodies sometimes carry their seat ("ВКП - София"); it adds nothing, since
  // every one of them sits in Sofia.
  const national = folded.replace(/ СОФИЯ$/, "").trim() || folded;
  for (const { match, body } of NATIONAL)
    if (match.test(folded) || match.test(national))
      return { ...body, place: "София" };

  for (const { match, body } of FIXED_MILITARY)
    if (match.test(folded)) return { ...body, place: "София" };

  // The specialised criminal courts, which appear only in court_load and only as
  // abbreviations. Closed in 2022 but still in the historical caseload series.
  if (folded === "СНС")
    return {
      bodyCode: "sns",
      name: "Специализиран наказателен съд",
      kind: "court",
      tier: "специализиран",
      place: "София",
    };
  if (folded === "АСНС")
    return {
      bodyCode: "asns",
      name: "Апелативен специализиран наказателен съд",
      kind: "court",
      tier: "специализиран",
      place: "София",
    };

  // court_load writes `АС - Бургас` for an APPELLATE court while the ИВСС register uses
  // `АС` for an ADMINISTRATIVE one, and `ВС` for a военен съд. The string cannot settle
  // it; the caller's tier can, and court_load is the only caller that has one.
  const hinted = /^(АС|ВС)\s+(.+)$/.exec(folded);
  if (hinted && tierHint) {
    const place = restorePlace(hinted[2].trim(), vocab, onFix);
    const spec =
      hinted[1] === "ВС"
        ? { tier: "военен" as const, prefix: "vs", label: "Военен съд" }
        : tierHint === "апелативен"
          ? { tier: tierHint, prefix: "aps", label: "Апелативен съд" }
          : { tier: tierHint, prefix: "as", label: "Административен съд" };
    if (place) {
      // Re-test NATIONAL on the spelled-out form before minting a seated code.
      // This branch is the one path that reaches a body WITHOUT consulting the
      // curated list, so without this it re-creates the defect the fold just
      // closed: `АС - София` would bypass a curated `Софийски апелативен съд`
      // entry and mint `aps-sofiya` alongside it, splitting the court's
      // magistrates from its ВСС workload exactly as the five Sofia twins did.
      // Nothing matches today — there is no curated appellate/military Sofia
      // entry — so this is a guard on the next one, not a live redirect.
      const spelled = foldJudicialName(`${spec.label} ${place}`, vocab);
      for (const { match, body } of NATIONAL)
        if (match.test(spelled)) return { ...body, place: "София" };
      return {
        bodyCode: `${spec.prefix}-${slug(place)}`,
        name: `${spec.label} — ${place}`,
        kind: "court",
        tier: spec.tier,
        place,
      };
    }
  }

  // Before the prosecution rules: "ОСлО при ОП-Видин" contains "ОП" and would otherwise
  // be read as an окръжна прокуратура.
  const inv = resolveInvestigation(folded, vocab, onFix);
  if (inv) return inv;

  for (const rule of SEATED) {
    const m = rule.match.exec(folded);
    if (!m) continue;
    const place = restorePlace(m[1].trim(), vocab, onFix);
    if (!place) continue;
    return {
      bodyCode: `${rule.prefix}-${slug(place)}`,
      name: rule.name(place),
      kind: rule.kind,
      tier: rule.tier,
      place,
    };
  }

  // A national institution written as its abbreviation plus a generic word the form
  // invited in ("Прокуратура - СРП"). Drop the filler and re-test the national table,
  // so the abbreviation speaks for itself. LAST of all, so this can never shadow a rule
  // that reads the whole string — a bare "Прокуратура" strips to nothing and stays null.
  const stripped = folded
    .split(" ")
    .filter((t) => !FILLER.has(t))
    .join(" ");
  if (stripped && stripped !== folded)
    for (const { match, body } of NATIONAL)
      if (match.test(stripped)) return { ...body, place: "София" };

  return null;
}
