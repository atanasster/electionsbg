// Bulgarian → English topic bridge, for the Interreg arm of the fit resolver ONLY.
//
// WHY THIS EXISTS. keep.eu publishes Interreg titles in English: measured over the corpus, only
// 272 of 1,954 operations (14%) carry a Bulgarian title at all, and 271 of the placed ones. So a
// Bulgarian reader typing „туризъм" matches nothing in that arm — and the arm's entire purpose is
// that a border-municipality reader is not told „нищо подобно не е финансирано наблизо" when their
// neighbours hold Interreg grants (funds-module-v2 §2.3, §4.4). An arm that is 86% unreachable in
// the site's primary language does not do that job.
//
// WHAT IT IS NOT. Not a translator, and not applied to the ИСУН arm — that corpus is Bulgarian and
// bridging it would only add noise. Not machine translation of the TITLES either: we display them
// in English with an EN marker, because a mistranslated operation name is unfindable in the
// register a reader would have to go to (§2.3(c)). This bridges the QUERY, in one direction, and
// the route reports which English term it used so the reader can see why an English row appeared.
//
// SCOPE, deliberately narrow. The topics below are the intersection of two real lists: the demand
// measured in the source group (funds-module-v2 Appendix A — tourism, energy, digitalisation,
// agriculture, culture, health, transport, water, waste, education, SMEs) and the vocabulary
// Interreg operation titles actually use. It is a stem match, because Bulgarian inflects: „туризъм"
// / „туристически" / „туристическа" all have to hit. Anything not listed simply does not bridge —
// the reader still gets the ИСУН arm, and the UI says the Interreg arm searched in English.
//
// Kept in `functions/` (CommonJS) rather than `src/lib`, because the route runs in the Cloud
// Function and cannot import from the SPA bundle. The gate is `db_routes.fundsfit.test.js`, which
// asserts both directions: that every listed topic is REACHABLE from the phrasing a reader would
// type, and that a table of ordinary non-topic words stays unbridged.

/** [Bulgarian stem, English term].
 *
 *  Stems are lowercase, and every one is a WORD-INITIAL form — the matcher below anchors them to a
 *  word boundary rather than matching anywhere in the string. Plain substring matching was the
 *  first attempt and it mis-bridged the most ordinary vocabulary there is: „гора" is inside
 *  „стара за-гора" (a major city), „вод" inside „произ-вод-ство", „за-вод" and „ръко-вод-ство".
 *  A furniture manufacturer typing „производство на мебели" got an Interreg section of water
 *  projects. Lengthening the stems helps but cannot be relied on — the anchor is the actual rule.
 *
 *  Compounds are therefore listed explicitly where they are real („екотуризъм", „агротуризъм"):
 *  the anchor is what makes the table safe, and the cost of the anchor is that an embedded topic
 *  has to be named. */
const BG_EN_TOPICS = [
  ["туриз", "tourism"],
  ["турист", "tourism"],
  // Word-initial matching means a compound has to be named, not inferred.
  ["екотуриз", "ecotourism"],
  ["агротуриз", "rural tourism"],
  ["селски туризъм", "rural tourism"],
  ["културн", "cultural heritage"],
  ["култур", "culture"],
  ["наслед", "heritage"],
  ["енергийн", "energy efficiency"],
  ["енерги", "energy"],
  ["възобновяем", "renewable energy"],
  ["фотоволта", "solar energy"],
  ["дигитал", "digitalisation"],
  ["цифров", "digital"],
  ["иноваци", "innovation"],
  ["предприемач", "entrepreneurship"],
  ["земедел", "agriculture"],
  ["селск", "rural development"],
  ["храни", "food"],
  ["здрав", "health"],
  ["болниц", "healthcare"],
  ["социалн", "social inclusion"],
  ["образован", "education"],
  ["обучен", "training"],
  ["заетост", "employment"],
  ["младеж", "youth"],
  ["транспорт", "transport"],
  ["път", "road"],
  ["мобилност", "mobility"],
  // NOT „вод": it is inside „произ-вод-ство", „за-вод", „ръко-вод-ство" — all core EU-funds
  // vocabulary — so a furniture manufacturer got an Interreg section full of water projects.
  ["водоснабд", "water supply"],
  ["водопров", "water supply"],
  ["отпадни вод", "wastewater"],
  ["пречиств", "wastewater treatment"],
  ["питейна вод", "drinking water"],
  ["отпадъц", "waste"],
  ["отпадък", "waste"],
  // The DEFINITE form is how Bulgarian actually writes it („опазване на околната среда"), so the
  // indefinite-only entry this replaces was unreachable in practice.
  ["околна", "environment"],
  ["околнат", "environment"],
  ["опазван", "environment"],
  ["природ", "nature"],
  ["климат", "climate"],
  ["наводнен", "flood"],
  ["риск", "risk management"],
  // „трансгранич" spelled out: the anchor rejects „гранич" inside „транс-гранично", which is how
  // Interreg's own subject is almost always written. Found by the reachability gate, not by review.
  ["трансгранич", "cross-border"],
  ["гранич", "cross-border"],
  ["спорт", "sport"],
  ["занаят", "crafts"],
  ["музей", "museum"],
  ["река", "river"],
  ["море", "sea"],
  // NOT „гор": „стара за-гор-а" is a major city and „гор-ива" is fuels.
  ["гора", "forest"],
  ["горск", "forest"],
  ["залесяв", "forest"],
];

/**
 * The term to search the Interreg corpus with, and whether it was bridged.
 *
 * Returns the ORIGINAL query when it is already Latin (an English query needs no bridge, and
 * bridging it would be wrong) or when no topic matches — in which case the Interreg arm simply
 * runs on the reader's own words and usually finds nothing, which the UI names rather than hides.
 */
/** Does `stem` occur in `text` at the START of a word?
 *
 *  „Word" is any run of letters or digits; the boundary is the string start or any character that
 *  is not one. Anchoring only the START (not the end) is deliberate — Bulgarian inflects the tail,
 *  which is the whole reason these are stems: „турист" has to reach „туристическа". */
const startsWord = (text, stem) => {
  let from = 0;
  for (;;) {
    const i = text.indexOf(stem, from);
    if (i === -1) return false;
    if (i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1])) return true;
    from = i + 1;
  }
};

const interregQueryFor = (q) => {
  const t = String(q || "")
    .toLowerCase()
    .trim();
  if (!t) return { term: t, bridged: null };
  // Already Latin — the reader typed English (or an operation's own title). Do not touch it.
  if (!/[Ѐ-ӿ]/u.test(t)) return { term: t, bridged: null };
  // LONGEST STEM FIRST, so „културн" beats „култур" and „енергийн" beats „енерги". Declaration
  // order is not relied on: a shorter stem that is a prefix of a longer one would otherwise win
  // by accident of where it was added.
  const hit = [...BG_EN_TOPICS]
    .sort((a, b) => b[0].length - a[0].length)
    .find(([stem]) => startsWord(t, stem));
  return hit ? { term: hit[1], bridged: hit[1] } : { term: t, bridged: null };
};

module.exports = { BG_EN_TOPICS, interregQueryFor };
