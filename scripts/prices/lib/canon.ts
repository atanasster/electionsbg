// Canonical product identity, derived from the chain's free-text SKU name.
//
// There is NO barcode in the КЗП feed: "Код на продукта" is a chain-internal
// code that collides across chains (code '000006' is Rodopea cheese at one
// chain, chilled Gradus chicken at another). Croatia's cijene.dev can join on
// mandated EANs; we cannot. Identity must come from the name.
//
// Every rule below exists because running the naive version against the full
// 2026-07-08 corpus (1,400,705 rows / 95,324 distinct names) broke on it. See
// docs/plans/consumption-pg-v1-implementation.md §3.0 for the audit.

export interface Canon {
  canonKey: string;
  brand: string | null;
  netQty: number | null; // normalized to g | ml | pc
  netUnit: "g" | "ml" | "pc" | null;
  unitPriced: boolean; // loose per-kg good; size legitimately absent
  attrs: Record<string, string>; // { fat: "3", abv: "40", class: "II", count: "6" }
  title: string;
  tokens: string[];
  confidence: number; // 0..100
}

// ── rule 4: Unicode normalization + homoglyph folding ─────────────────────
// The corpus spells the produce quality class with BOTH Latin "II" (U+0049) and
// Cyrillic "ІІ" (U+0406). Without folding, `МОРКОВИ ІІ` and `МОРКОВИ II` are
// different products. Fold toward Cyrillic: the corpus is overwhelmingly
// Cyrillic, and folding the other way mangles genuine Latin brands (KLC,
// SWEET+, ADVANCE WHITE) whose letters are all lookalikes.
const HOMOGLYPHS: Record<string, string> = {
  A: "А",
  B: "В",
  E: "Е",
  K: "К",
  M: "М",
  H: "Н",
  O: "О",
  P: "Р",
  C: "С",
  T: "Т",
  X: "Х",
  I: "І",
  Y: "У",
};
const foldHomoglyphs = (s: string): string =>
  s.replace(/[ABEKMHOPCTXIY]/g, (ch) => HOMOGLYPHS[ch] ?? ch);

// ── rule 6: leading junk ──────────────────────────────────────────────────
// Real names in the feed: "= ЧАЙ БИОПРОГРАМА ШИПКА", "*Чай Биопрограма Мащерка",
// "НЕ KLC.краве.бяло.сирене.1кг". They merged correctly by luck; strip them.
const LEADING_JUNK = /^[=*+\-–—.,\s]+/;
const LEADING_NE = /^НЕ\s+/i;

// ── rule 1: Cyrillic-safe unit matching ───────────────────────────────────
// `\b` is ASCII-word-based, so /Л\b/u never matches "1Л" and /Г\b/u never
// matches "500Г" — the bug that understated size coverage at 64% of names.
// Use a negative lookahead on any letter instead. Fixing it lifts coverage to
// 79.9% of names / 77.8% of rows.
// Size is parsed on the PRE-fold uppercased string (see canonicalize), so both
// scripts' units appear natively: Cyrillic КГ/ГР/Г/МЛ/Л and Latin KG/GR/G/MG/ML/L.
// Longer alternatives precede their prefixes (ГР before Г, GR before G, MG/ML
// before L) so the match is greedy-correct.
//
// rule 8: a decimal separator may carry stray whitespace. The feed contains
// "Минерална Вода Банкя 1. 5 Л." and "Вино Enira Мерло 0. 75 Л." — without this
// the leading "1" is dropped, the regex resumes at "5 Л" and a 1.5 L bottle is
// published as 5 L, i.e. at a third of its true €/L. That put four bottled
// waters at the top of the "най-добра стойност" €/L board.
//
// The two separators are NOT symmetric, and treating them alike is the trap:
//
//   · DOT is unconditionally safe. All 6 dot-spaced names in the corpus
//     ("1. 5 Л.", "0. 75 Л.") are genuine decimals — nothing writes an
//     enumeration with a dot and a space.
//   · COMMA is overwhelmingly a LIST separator: "СПАГЕТИ DE CECCO №11, 500 Г",
//     "Мляно кафе L'OR Classique, Интензитет 6, 250 гр", "ШАМПОАН … 2 В 1,
//     250 МЛ". 59 of the 60 comma-spaced names in the corpus are this shape,
//     and reading them as decimals turns 500 g into 9500 g and 250 ml into
//     1250 ml — the same defect this rule exists to fix, pointed the other way.
//     The single genuine one is "Вино Contour … 0, 75 Л.", and a ZERO integer
//     part is what makes it unambiguous: "0," is a fraction, nobody enumerates
//     item 0. So the spaced-comma arm is restricted to it.
//
// The `(?<![\d.,])` guard on that arm stops the alternation latching onto the
// trailing zero of a larger numeral — without it "Интензитет 10, 250 гр" would
// match "0, 250" and yield 0.25.
const NUM = String.raw`(?:(?<![\d.,])0\s*,\s*\d+|\d+(?:\s*\.\s*\d+|,\d+)?)`;
const UNITS = String.raw`КГ|ГР|Г|МЛ|Л|БР|KG|GR|MG|G|ML|L`;

const UNIT_RE = new RegExp(String.raw`(${NUM})\s*(${UNITS})(?![\p{L}])`, "giu");

// rule 7: multipacks — "6х1.5Л" must not compare against a single 1.5Л bottle.
// The multiplier may be Latin `x` or Cyrillic `х` (the `i` flag covers case).
const MULTIPACK_RE = new RegExp(
  String.raw`(\d+)\s*[хx*]\s*(${NUM})\s*(${UNITS})(?![\p{L}])`,
  "iu",
);

// rule 2: percentages are identity, not noise. Stripping them collapsed every
// fat percentage of Vereya milk into one 59-chain group.
const PCT_RE = /(\d+(?:[.,]\d+)?)\s*%/g;

// rule 5: quality class is an attribute, not a stopword. `II` is 2 chars, so a
// naive `len >= 3` filter drops it — merging БАНАНИ with БАНАНИ II, which are
// different goods at different prices.
const CLASS_RE = /(?:^|\s)(І{1,3}|ІV)(?=\s|$)/;

const STOP = new Set([
  "ЗА",
  "И",
  "С",
  "В",
  "НА",
  "ОТ",
  "КУТИЯ",
  "ВАКУУМ",
  "ПАКЕТ",
  "ОПАК",
  "БУТИЛКА",
]);

const UNIT_NORM: Record<string, [Canon["netUnit"], number]> = {
  КГ: ["g", 1000],
  KG: ["g", 1000],
  ГР: ["g", 1],
  GR: ["g", 1],
  Г: ["g", 1],
  G: ["g", 1],
  MG: ["g", 0.001],
  МЛ: ["ml", 1],
  ML: ["ml", 1],
  Л: ["ml", 1000],
  L: ["ml", 1000],
  БР: ["pc", 1],
};

// The matched numeral may now contain whitespace around its decimal separator
// (rule 8), so strip it BEFORE parsing: parseFloat("1. 5") is 1 and
// parseFloat("0. 75") is 0 — the silent half of the mis-sizing bug.
const num = (s: string): number =>
  parseFloat(s.replace(/\s+/g, "").replace(",", "."));
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

// ── rule 9: a decimal separator lost ENTIRELY, on a large unit ─────────────
// Wine arrives as "ВИНО A GOOD YEAR КЮВЕ 075Л" — 0.75 L written with no point.
// Read literally that is 75 L, so a €5.62 bottle posts €0.075/L and takes the
// whole top of the "най-добра стойност" €/L board: measured 2026-08-18, nine of
// its first ten entries were 075Л wines. The kg basis never showed this because
// HOUSEHOLD_PACK_MAX_G already drops anything over 3 kg; the L basis has no
// such ceiling, which is precisely why these surfaced there.
//
// The leading zero is the signal and the UNIT decides what it means. There are
// exactly 18 unspaced leading-zero numerals in the corpus, and they split
// cleanly:
//
//   · "075Л" ×16 — a LARGE unit (Л|L|КГ|KG). 75 litres is not a retail bottle,
//     so the zero is a stranded integer part and the value is 0.75.
//   · "0375МЛ", "0700МЛ" ×2 — a SMALL unit. 375 ml and 700 ml are ordinary
//     sizes, the zero is mere padding, and these are already correct.
//
// Deliberately NOT extended to the SPACED form ("Сайкъл Вионие 0 75л", 5 rows).
// It looks like the same defect but is not separable from a preceding token:
// "БРАШНО БИО ALCE NERO ПШЕНИЧНО ТИП 0 1 КГ" is flour of TYPE 0 in a 1 kg bag,
// and "МЛЯКО NAN 1 ОПТИПРО HM-0 400 ГР" is product code HM-0. A spaced rule
// fixes 5 rows and breaks 2 that are right today, so those 5 stay wrong.
const LOST_SEPARATOR_RE = /^0\d+$/;

/** Quantity in the unit's base measure, applying rule 9 for large units. */
const qtyOf = (rawNum: string, mult: number): number => {
  const compact = rawNum.replace(/\s+/g, "");
  if (mult >= 1000 && LOST_SEPARATOR_RE.test(compact))
    return r3(parseFloat(`0.${compact.slice(1)}`) * mult);
  return r3(num(rawNum) * mult);
};

interface Size {
  qty: number;
  unit: NonNullable<Canon["netUnit"]>;
  count?: number;
}

const parseSize = (folded: string): Size | null => {
  const mp = folded.match(MULTIPACK_RE);
  if (mp) {
    const spec = UNIT_NORM[mp[3].toUpperCase()];
    if (spec?.[0]) {
      const [unit, mult] = spec;
      return {
        qty: r3(Number(mp[1]) * qtyOf(mp[2], mult)),
        unit: unit as NonNullable<Canon["netUnit"]>,
        count: Number(mp[1]),
      };
    }
  }
  UNIT_RE.lastIndex = 0;
  const m = UNIT_RE.exec(folded);
  if (!m) return null;
  const spec = UNIT_NORM[m[2].toUpperCase()];
  if (!spec?.[0]) return null;
  const [unit, mult] = spec;
  return {
    qty: qtyOf(m[1], mult),
    unit: unit as NonNullable<Canon["netUnit"]>,
  };
};

/** rule 3: word-order invariance. Sorted tokens make the key permutation-proof. */
const tokenize = (folded: string): string[] =>
  folded
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(
      (t) =>
        t.length >= 3 &&
        !/^\d+$/.test(t) && // kills stray internal codes: "ПЮРЕ ПЛАЗМОН 2755 …"
        !STOP.has(t),
    );

/**
 * `attrs` keys MUST be sorted before entering the key. jsonb/object insertion
 * order would otherwise fork two identical attribute sets into different
 * canon_keys and silently fail the merge.
 */
const attrsKey = (attrs: Record<string, string>): string =>
  Object.keys(attrs)
    .sort()
    .map((k) => `${k}=${attrs[k]}`)
    .join(",");

export const canonicalize = (
  rawName: string,
  pid: number,
  unitPriced = false,
): Canon => {
  const cleaned = rawName
    .normalize("NFKC")
    .replace(LEADING_JUNK, "")
    .replace(LEADING_NE, "")
    .trim();
  const upper = cleaned.toUpperCase();
  const folded = foldHomoglyphs(upper);

  const attrs: Record<string, string> = {};

  const pcts = [...folded.matchAll(PCT_RE)]
    .map((m) => String(num(m[1])))
    .sort((a, b) => Number(a) - Number(b));
  if (pcts.length) attrs.pct = pcts.join("/");

  const cls = folded.match(CLASS_RE);
  if (cls) attrs.class = cls[1];

  // Parse size on the PRE-fold string: homoglyph folding rewrites Latin K→К and
  // M→М, so a Latin "1KG" would fold to the mixed-script "1КG" and match neither
  // КГ nor KG (FINDING-009). `upper` has both scripts' units intact.
  const size = parseSize(upper);
  if (size?.count) attrs.count = String(size.count);

  const tokens = tokenize(folded).sort();
  // A unit-priced good is sold per kilogram, so a size in the name is a
  // restatement of the unit, not a pack. "БАНАНИ", "БАНАНИ 1 КГ" and "БАНАНИ КГ"
  // are one product; letting the parsed size into the key splits them (measured:
  // 53 chains vs 3). Collapse the size dimension for these.
  const sizeKey = unitPriced ? "kg" : size ? `${size.qty}${size.unit}` : "?";
  const canonKey = `${pid}|${sizeKey}|${tokens.join("_")}|${attrsKey(attrs)}`;

  // Brand heuristics are deliberately weak; brand only feeds `confidence` and
  // display, never identity. A wrong brand guess must not fork or merge a key.
  const brand = null;

  const confidence =
    (size || unitPriced ? 40 : 0) +
    (brand ? 25 : 0) +
    (tokens.length >= 3 ? 20 : 0) +
    15;

  return {
    canonKey,
    brand,
    netQty: size ? size.qty : null,
    netUnit: size ? size.unit : null,
    unitPriced,
    attrs,
    title: cleaned,
    tokens,
    confidence: Math.min(100, confidence),
  };
};

/**
 * THE merge rule (design §4.3). A group may span more than one chain iff it has
 * a parsed net quantity, or its КЗП product is unit-priced (loose produce, sold
 * per kilogram, which has no pack size and never will).
 *
 * Without the unit_priced exemption this rule demotes 2,811 multi-chain groups
 * — БАНАНИ, МОРКОВИ, loose meat and cheese — to per-chain singletons, i.e. it
 * destroys comparability for exactly the staples the tool exists to cover.
 */
export const mayMergeAcrossChains = (c: Canon): boolean =>
  c.netQty != null || c.unitPriced;
