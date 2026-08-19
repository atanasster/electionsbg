// THE ONE DEFINITION of whether a declared money row is held in Bulgaria or abroad.
//
// Read by the parser (which applies it), by backfill_asset_held_abroad.ts (which stamps the
// committed shards) and by declaration_held_abroad.data.test.ts (which gates it). Nothing else
// may restate the rule — the repo has twice paid for a rule copied by hand into a second place
// (the six-way `magistrate_current` duplication, and `councilNameKey`'s TS/SQL split that cost
// 4,899 votes their attribution). There is deliberately NO SQL twin: the classification is
// applied at PARSE time and STORED, so a serving surface reads a column instead of re-deriving
// a rule — the same shape as `value_basis`, and the opposite of `is_declared_holding`, which
// must be re-derived per query because it is a function of `table_num` alone.
//
// ── WHICH TABLES CARRY IT ──────────────────────────────────────────────────────────────────
// Two, not three. Measured over all 67,841 cached filings, the „В страната" / „В чужбина"
// header pair occurs ONLY on:
//
//   2018 form (v2)   Table 5 „Банкови влогове"   cells 7 / 8      60,112 filings
//                    Table 8 „Вложения в … фондове"  cells 7 / 8  60,112 filings
//   pre-2018 (v1)    Table 7 „Банкови влогове"   cells 6 / 7       1,542 filings
//
// ⚠️ TABLE 4 („Налични парични средства") HAS NEITHER, and its Cell Num=7 is „Произход на
// средствата". Reading cells 7/8 off table 4 does not yield a blank — it yields the funds
// origin, so every cash row in the corpus would be published as held in a country called
// „заплата". The v1 offsets need no special case here: `columnResolver` already shifts every
// column after the ЕГН cell, and EGN_COLUMN.bank = 6 maps new-form 7→6 and 8→7 exactly.
//
// ── WHY THE ANSWER IS TRI-STATE AND NOT A BOOLEAN ─────────────────────────────────────────
// The two cells are NOT a flag plus a country. They are a positional yes/no PAIR that the
// register does not validate, so what they actually hold is free text — 5,691 distinct
// spellings in „В страната" and 597 in „В чужбина" across 82,665 money rows. The dominant
// filling is a tick in one column and a denial in the other („да" / „не", 18.3% of rows), and
// 28.8% of rows carry content in BOTH. So:
//
//   • a boolean cannot represent „the declarant said nothing" (346 rows leave both blank), and
//     defaulting those to `false` publishes „held in Bulgaria" as a fact about a named person;
//   • the columns contradict each other on a real minority — „в страната" and „България" both
//     appear INSIDE the „В чужбина" column (47 rows going the other way), so position alone is
//     not decisive and content has to be able to override it;
//   • ~93 rows SPLIT one amount across the two columns (151,744 domestic + 967 abroad = the
//     152,711 in the amount cell). Neither scope is true of the whole row, and this rule
//     deliberately calls that `unknown` rather than picking the larger side — the raw cells are
//     stored, so the split stays recoverable, and `unknown` is COUNTED rather than guessed.
//
// The country is a SEPARATE question from the scope and is answered far less often: „да" in
// the „В чужбина" column (1,576 rows) says abroad and names nowhere. A surface must therefore
// never derive „not abroad" from a null country.

/** Where the declarant says the money sits.
 *
 *  'unknown' is a first-class answer, not a failure: it covers both blanks and the rows where
 *  the two cells assert opposite things. Nothing may read it as 'domestic'. */
export type HeldScope = "domestic" | "abroad" | "unknown";

export type HeldPlace = {
  scope: HeldScope;
  /** Canonical Bulgarian country name, or null. Null on EVERY domestic row (the scope already
   *  says Bulgaria) and on most abroad rows too, since a bare „да" names nowhere. */
  country: string | null;
};

/** What one cell asserts, and how specifically it says it.
 *
 *  The TIER is what settles a disagreement between the two columns, and it has to exist
 *  because the commonest contradiction in the corpus is not two equal claims. „РБългария" in
 *  „В страната" beside a bare „х" in „В чужбина" (28 rows, and ~100 of that shape) is one
 *  declarant naming their country and then STRIKING OUT the column that does not apply — „х"
 *  is a tick to some filers and a strike-through to others, and nothing in the cell says
 *  which. Reading the two as equal claims throws away a filing that actually answered.
 *
 *    'place'   named a country, or echoed „В страната" / „В чужбина"     — most specific
 *    'content' a denial, a bank, a fund, an IBAN, an amount              — column-positional
 *    'tick'    „да", „х", „x", „v", „+"                                  — least specific
 *
 *  Only a tie WITHIN the top tier present is unresolvable. */
type Tier = "place" | "content" | "tick";
type Assertion = { scope: "domestic" | "abroad"; tier: Tier } | null;

const TIER_RANK: Record<Tier, number> = { place: 3, content: 2, tick: 1 };

const NBSP = /[\u00A0\u202F]/g;

/** Lower-cased, whitespace-collapsed, stripped of the punctuation declarants decorate a tick
 *  with. Kept separate from the country scan, which needs the spacing to stay meaningful. */
const norm = (raw: string | null | undefined): string =>
  (raw ?? "")
    .replace(NBSP, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^["'„“([]+|["'”“)\].,;:]+$/g, "")
    .trim();

/** A tick. „х" is Cyrillic ha and „x" Latin ex — declarants use both, and which one they hit
 *  depends on the keyboard layout, never on meaning. */
const AFFIRM = new Set([
  "да",
  "д",
  "yes",
  "y",
  "х",
  "x",
  "v",
  "✓",
  "✔",
  "+",
  "*",
  "да да",
]);

/** An explicit denial for the column it sits in. „0" is here because 1,821 rows write a zero
 *  into „В чужбина" meaning „none of it" — but a NON-zero number is not a denial, it is the
 *  amount, and is handled as content further down. */
const NEGATE = new Set([
  "не",
  "нe",
  "не.",
  "ne",
  "no",
  "n",
  "няма",
  "нямам",
  "нема",
  "нищо",
  "неприложимо",
  "не приложимо",
  "н.п",
  "н.п.",
  "нп",
  "n/a",
  "na",
  "-",
  "--",
  "0",
  "0.00",
  "0,00",
  "0.0",
  "0,0",
]);

/** The declarant echoed the „В страната" header (or named Bulgaria) instead of ticking. Read as
 *  a DOMESTIC assertion wherever it appears — including inside the „В чужбина" column, which is
 *  the one place position would get it backwards. */
const ECHO_DOMESTIC = new Set([
  "в страната",
  "встраната",
  "страната",
  "в българия",
  "българия",
  "блъгария",
  "бьлгария",
  "р българия",
  "р.българия",
  "р. българия",
  "рбългария",
  "република българия",
  "република българия",
  "рб",
  "бг",
  "bg",
  "bulgaria",
  "в страната бг",
]);

/** The declarant echoed the „В чужбина" header. Read as an ABROAD assertion wherever it
 *  appears — 17 rows put it in the „В страната" column. */
const ECHO_ABROAD = new Set([
  "в чужбина",
  "чужбина",
  "вчужбина",
  "в чужнина",
  "чужди",
  "abroad",
]);

/** Spreadsheet residue the register published verbatim — „-'Стр. 7'!M1512", „-B47х",
 *  „-NothingT8х", a run of dashes. Left as `none`: it is a broken export, not an answer, and
 *  reading it as content would publish an abroad assertion nobody made. */
const JUNK =
  /^-{3,}|^-\s*(?:'[^']*'!)|^-[a-zа-я]{0,8}\d|!\$?[a-z]+\$?\d+|^…+$|^\.+$/i;

/** Countries whose Bulgarian name is long enough to match anywhere inside a cell, so
 *  „VONTOBEL Швейцария", „банка BCR, Румъния" and „AmundiFundsChinaEquity Люксембург" all
 *  resolve. Keyed longest-first at match time so „Босна и Херцеговина" cannot be eaten by a
 *  shorter entry. Value = the canonical name stored in `held_country`. */
const COUNTRY_SUBSTRINGS: Array<[RegExp, string]> = [
  [/босна и херцеговина/, "Босна и Херцеговина"],
  [
    /съединени американски щати|(?<![а-я])сащ(?![а-я])|\busa\b|united states/,
    "САЩ",
  ],
  [
    /обединеното кралство|великобритания|united kingdom/,
    "Обединеното кралство",
  ],
  [/република корея|южна корея|(?<![а-я])корея/, "Република Корея"],
  [/северна македония|рсмакедония|(?<![а-я])рс македония/, "Северна Македония"],
  [/чешка република|чехия|(?<![а-я])чешка/, "Чехия"],
  [/нидерландия|холандия|netherlands/, "Нидерландия"],
  [/лихтенщайн/, "Лихтенщайн"],
  [/швейцария|switzerland/, "Швейцария"],
  [/люксембург|luxemb/, "Люксембург"],
  [/германия|гермавия|germany|deutschland/, "Германия"],
  [/белгия|belgium|belgique/, "Белгия"],
  [/австрия|austria/, "Австрия"],
  [/ирландия|ireland/, "Ирландия"],
  [/испания|spain/, "Испания"],
  [/италия|italy/, "Италия"],
  [/франция|france/, "Франция"],
  [/гърция|greece/, "Гърция"],
  [/румъния|romania/, "Румъния"],
  [/албания|albania/, "Албания"],
  [/турция|turkey|türkiye/, "Турция"],
  [/русия|russia/, "Русия"],
  [/украйна|ukraine/, "Украйна"],
  [/полша|poland/, "Полша"],
  [/словакия|slovakia/, "Словакия"],
  [/словения|slovenia/, "Словения"],
  [/хърватия|croatia/, "Хърватия"],
  [/унгария|hungary/, "Унгария"],
  [/латвия|latvia/, "Латвия"],
  [/литва|lithuania/, "Литва"],
  [/естония|estonia/, "Естония"],
  [/финландия|finland/, "Финландия"],
  [/швеция|sweden/, "Швеция"],
  [/норвегия|norway/, "Норвегия"],
  [/дания|denmark/, "Дания"],
  [/исландия|iceland/, "Исландия"],
  [/португалия|portugal/, "Португалия"],
  [/(?<![а-я])малта(?![а-я])/, "Малта"],
  [/грузия/, "Грузия"],
  [/армения|armenia/, "Армения"],
  [/индонезия|indonesia/, "Индонезия"],
  [/монголия|mongolia/, "Монголия"],
  [/йордания|jordan/, "Йордания"],
  [/кувейт|kuwait/, "Кувейт"],
  [/нигерия|nigeria/, "Нигерия"],
  [/канада|canada/, "Канада"],
  [/бразилия|brazil/, "Бразилия"],
  [/япония|japan/, "Япония"],
  [/(?<![а-я])китай/, "Китай"],
  [/(?<![а-я])индия(?![а-я])/, "Индия"],
  [/египет|egypt/, "Египет"],
  [/сърбия|serbia/, "Сърбия"],
  [/черна гора|montenegro/, "Черна гора"],
  [/молдова|moldova/, "Молдова"],
  [/казахстан|kazakhstan/, "Казахстан"],
  [/виетнам|vietnam/, "Виетнам"],
  [/австралия|australia/, "Австралия"],
  [/южна африка|south africa/, "Южна Африка"],
  [/аржентина|argentina/, "Аржентина"],
  [/мексико|mexico/, "Мексико"],
];

/** Short or ambiguous forms that must match the WHOLE cell. „оае" and „кипър" are safe as
 *  substrings, but keeping every abbreviation here rather than in the list above is what stops
 *  a three-letter code matching inside a fund name. */
const COUNTRY_EXACT: Record<string, string> = {
  оае: "ОАЕ",
  "о.а.е": "ОАЕ",
  "обединени арабски емирства": "ОАЕ",
  кипър: "Кипър",
  cyprus: "Кипър",
  рсм: "Северна Македония",
};

/** The country a cell names, or null. Case- and position-insensitive: the same scan runs over
 *  both columns, because a country in the „В страната" column is still a country. */
export const countryOf = (raw: string | null | undefined): string | null => {
  const n = norm(raw);
  if (!n) return null;
  const exact = COUNTRY_EXACT[n];
  if (exact) return exact;
  for (const [re, name] of COUNTRY_SUBSTRINGS) if (re.test(n)) return name;
  // „кипър" appears inside „кипър / + 500 /" and similar, so the exact map gets a substring
  // pass too — after the unambiguous list, so a longer country name always wins.
  for (const [key, name] of Object.entries(COUNTRY_EXACT))
    if (key.length >= 4 && n.includes(key)) return name;
  return null;
};

/** What a single cell asserts. `side` is the column it was read from, and it decides only the
 *  cases that carry no place of their own — a tick, a bank name, an IBAN, an amount. Explicit
 *  content (a country, or an echo of either header) overrides the column it happens to sit in,
 *  which is the only way to read the 47 rows that put „в страната" or „България" inside the
 *  „В чужбина" column.
 *
 *  ⚠️ A DENIAL ASSERTS THE OTHER COLUMN. The pair is exhaustive by construction — a bank
 *  account is either in the country or outside it — so „В чужбина: не" is a positive statement
 *  that the money is domestic, and it is the only statement 81 rows make. Reading a denial as
 *  merely „this column is empty" throws those away as unknown. It is filed as 'content' rather
 *  than 'place' because it names nowhere: an explicit country in the other column still wins. */
const assertionOf = (
  raw: string | null | undefined,
  side: "domestic" | "abroad",
): Assertion => {
  const other = side === "domestic" ? "abroad" : "domestic";
  const n = norm(raw);
  if (!n) return null;
  // „не (канадски долари)" is a denial with a note, not a currency named in the abroad column.
  // Strip one trailing parenthetical before the denial test, never before the country scan —
  // „(Револют) Литва" and „кипър / + 500 /" carry the place INSIDE the brackets.
  const bare = norm(n.replace(/\s*[([][^)\]]*[)\]]?\s*$/, ""));
  if (NEGATE.has(n) || NEGATE.has(bare))
    return { scope: other, tier: "content" };
  if (ECHO_DOMESTIC.has(n)) return { scope: "domestic", tier: "place" };
  if (ECHO_ABROAD.has(n)) return { scope: "abroad", tier: "place" };
  if (JUNK.test(n)) return null;
  if (countryOf(n)) return { scope: "abroad", tier: "place" };
  if (/българия|в страната/.test(n))
    return { scope: "domestic", tier: "place" };
  if (/чужбина/.test(n)) return { scope: "abroad", tier: "place" };
  if (AFFIRM.has(n)) return { scope: side, tier: "tick" };
  // A bare number is the amount written into a column. Zero was caught by NEGATE above, so
  // anything left is a positive sum and asserts its own column. When BOTH columns carry one
  // the row is a split, and the tie below resolves it to `unknown`.
  if (/^\d[\d\s.,]*$/.test(n)) return { scope: side, tier: "content" };
  // Two characters or fewer and not a recognised tick is a slip of the keyboard („ни", „те",
  // „нв", „ке"), not an answer.
  if (n.length <= 2) return null;
  // Everything else is real content in a meaning-bearing column: a bank („ОББ", „Revolut"),
  // a fund („Amundi Funds"), an IBAN, a product name. The column is the answer.
  return { scope: side, tier: "content" };
};

/** THE rule. `inCountry` is the „В страната" cell, `abroad` the „В чужбина" one, both raw. */
export const classifyHeldPlace = (
  inCountry: string | null | undefined,
  abroad: string | null | undefined,
): HeldPlace => {
  const said = [
    assertionOf(inCountry, "domestic"),
    assertionOf(abroad, "abroad"),
  ].filter((a): a is NonNullable<Assertion> => a != null);

  let scope: HeldScope = "unknown";
  if (said.length > 0) {
    const top = Math.max(...said.map((a) => TIER_RANK[a.tier]));
    const winners = said.filter((a) => TIER_RANK[a.tier] === top);
    // Unanimous at the most specific tier anyone reached. A tie there is a genuine
    // contradiction — two ticks, or an amount split across both columns — and stays unknown
    // rather than being resolved by picking a side.
    if (winners.every((w) => w.scope === winners[0].scope))
      scope = winners[0].scope;
  }
  // The country is reported whenever the row resolved as abroad and either cell names one.
  // Both cells are scanned because „Белгия" turns up in the „В страната" column too.
  const country =
    scope === "abroad" ? (countryOf(abroad) ?? countryOf(inCountry)) : null;
  return { scope, country };
};
