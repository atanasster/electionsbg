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

export type JudicialKind =
  | "court"
  | "prosecution"
  | "investigation"
  | "council";

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
  {
    match: /^(?:АДМИНИСТРАТИВЕН СЪД|АДМС|АДМИНИСТРИТИВЕН СЪД)\s+(.+)$/,
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
    match: /^(?:РАЙОНЕН СЪД|РЙОНЕН СЪД|РС)\s+(.+)$/,
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
    match: /^(?:РАЙОННА ПРОКУРАТУРА|РАЙНОННА ПРОКУРАТУРА|РП)\s+(.+)$/,
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

/**
 * Fold a raw institution string to a comparison key: uppercase, dashes and punctuation
 * to spaces, whitespace collapsed. Also rewrites the city ADJECTIVE forms
 * ("Софийски районен съд" → "СОФИЯ РАЙОНЕН СЪД") so the adjectival and seat-suffixed
 * spellings of one institution land on the same key.
 */
export const foldJudicialName = (
  raw: string,
  vocab?: PlaceVocabulary,
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
  // ("ОСлО при ОП-Видин", "ОСлО в Окръжна прокуратура - Бургас", "ОСлО към ОП Пловдив").
  s = s.replace(/\s+(?:ПРИ|КЪМ|НА|В)\s+/g, " ");
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
  const [head, ...rest] = s.split(" ");
  // Rewrite the adjectival form into the seat-suffixed order every other institution
  // uses: "Бургаски районен съд" → "РАЙОНЕН СЪД БУРГАС". Sofia's institutions land on
  // "GRADSKI SAD SOFIA"-shaped keys, which is what the NATIONAL patterns match.
  if (ADJECTIVE_CITY[head] && rest.length)
    s = [...rest, ADJECTIVE_CITY[head].toUpperCase()].join(" ");
  return s.replace(/\s+/g, " ").trim();
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

const INVESTIGATION_HEAD =
  /^(ОКРЪЖЕН СЛЕДСТВЕН ОТДЕЛ|ОКРЪЖНА СЛЕДСТВЕНА СЛУЖБА|СЛЕДСТВЕНА СЛУЖБА|СЛЕДСТВЕН ОТДЕЛ|ОСЛО|ОСО|СЛО)(?=\s|$)/;

const resolveInvestigation = (
  folded: string,
  vocab?: PlaceVocabulary,
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
  let rest = folded.replace(INVESTIGATION_HEAD, "").trim();
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
  const place = restorePlace(seat, vocab);
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
const restorePlace = (p: string, vocab?: PlaceVocabulary): string | null => {
  if (vocab) {
    const hit = vocab.get(placeKey(p));
    if (hit) return hit;
    // Sofia's two administrative-court seats are qualifiers on the capital, not
    // settlements of their own, so they are never in a municipality vocabulary.
    if (/^СОФИЯ (ГРАД|ОБЛАСТ)$/.test(placeKey(p)))
      return placeKey(p) === "СОФИЯ ГРАД" ? "София-град" : "София-област";
    return null;
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
};

export function resolveJudicialBody(
  raw: string,
  opts: ResolveOptions = {},
): JudicialBody | null {
  const { vocab, tier: tierHint } = opts;
  const folded = foldJudicialName(raw, vocab);
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
    const place = restorePlace(hinted[2].trim(), vocab);
    const spec =
      hinted[1] === "ВС"
        ? { tier: "военен" as const, prefix: "vs", label: "Военен съд" }
        : tierHint === "апелативен"
          ? { tier: tierHint, prefix: "aps", label: "Апелативен съд" }
          : { tier: tierHint, prefix: "as", label: "Административен съд" };
    if (place)
      return {
        bodyCode: `${spec.prefix}-${slug(place)}`,
        name: `${spec.label} — ${place}`,
        kind: "court",
        tier: spec.tier,
        place,
      };
  }

  // Before the prosecution rules: "ОСлО при ОП-Видин" contains "ОП" and would otherwise
  // be read as an окръжна прокуратура.
  const inv = resolveInvestigation(folded, vocab);
  if (inv) return inv;

  for (const rule of SEATED) {
    const m = rule.match.exec(folded);
    if (!m) continue;
    const place = restorePlace(m[1].trim(), vocab);
    if (!place) continue;
    return {
      bodyCode: `${rule.prefix}-${slug(place)}`,
      name: rule.name(place),
      kind: rule.kind,
      tier: rule.tier,
      place,
    };
  }
  return null;
}
