// Bridge the НЗОК CLINICAL-ACTIVITY feed (keyed by facility NAME only, no Рег.№)
// to an EIK, so the "Кой лекува по коя пътека" pathway tree and the /company/:eik
// case-mix tile can link each hospital to its own page.
//
// WHY THIS MODULE EXISTS. The activities feed spells hospitals differently from
// every other source: it appends the town ("… ЕАД Пловдив"), uses local
// abbreviations ("МБАЛ-ПЗ", "МИ МВР", "ЮЗБ"), and glues the legal form onto the
// brand ("Черноземски''ЕАД"). The old bridge was a single EXACT strongFold-equality
// join against the already-EIK-resolved payments/financials names — which matched
// only ~31% of facilities, leaving the country's biggest hospitals (Пирогов,
// Александровска, Токуда, Дафовски) unlinked even though we already hold their EIK.
//
// The resolver here layers several HIGH-PRECISION tiers (all scoped to the RZOK
// region the facility bills in, so a brand token can only match within its own
// РЗОК) over that exact join, lifting facility coverage to ~80% of cases with no
// observed false positives:
//   A. exact strongFold equality (the original bridge — kept)
//   B. exact brand-token-set equality within the RZOK
//   C. unique brand-token SUBSET within the RZOK (one side ⊆ the other), gated by
//      a distinctive (≥4-char, non-generic) shared token
//   D. unique max-overlap winner within the RZOK, gated by a shared PROPER-NAME
//      token (≥5 chars, non-generic) so generic hospital vocabulary can't match
// plus two curated tables for the holdouts no name fold can bridge — the
// abbreviation-only names and the dialysis/oncology centres that are outside the
// болнична-помощ payments universe (their EIKs hand-verified against TR / payments):
//   FORCE     — checked BEFORE the tiers, to override a known tier-D mis-hit
//               (a Хисар МВР rehab that otherwise collides with the ВМА Хисар one)
//   FALLBACK  — checked AFTER the tiers, only for facilities still unmatched
//
// This module is DB-free and pure so it can be unit-tested (see
// nzok_activity_eik.test.ts); the loader feeds it the payments + financials names.

// ── strongFold: the cross-source name key. Kept byte-identical to the fold the
// loader has always used for the exact join (tier A), so that tier's behaviour and
// match rate are unchanged. Uppercase, strip quotes, collapse the saint prefix,
// drop the "Д-р" honorific, then keep only non-legal-form tokens.
const DROP_TOKENS = new Set([
  "ЕАД",
  "АД",
  "ЕООД",
  "ООД",
  "ДЗЗД",
  "ДР",
  "ГР",
  "ЕТ",
]);
/** The exact-match fold KEY: base tokens only, so it stays byte-identical to the
 *  fold the loader has always used (tier A's behaviour is unchanged). */
export const strongFold = (name: string): string => foldBase(name).join(" ");

const foldBase = (name: string): string[] =>
  name
    .toUpperCase()
    .replace(/[«»"'`„“”‘’]/g, "")
    .replace(/СВЕТИ|СВЕТА|СВ\./g, "СВ")
    .replace(/Д-Р/g, "ДР")
    .replace(/[^0-9A-ZА-Я]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && !DROP_TOKENS.has(t));

// Legal-form suffixes that the activities feed can fuse onto a brand token when a
// closing quote sits directly before them (Черноземски''ЕАД → ЧЕРНОЗЕМСКИЕАД).
// Longest-first so ЕАД is stripped in preference to АД.
const GLUED_SUFFIXES = ["ЕООД", "ЕАД", "ООД", "АД"];

/** The fold token list used for curated-SIGNATURE matching only (never for the
 *  tier-A key). Additionally un-glues a fused legal form as an EXTRA token, so a
 *  signature like ["ЧЕРНОЗЕМСКИ"] can still find a glued "ЧЕРНОЗЕМСКИЕАД". */
export const strongFoldTokens = (name: string): string[] => {
  const base = foldBase(name);
  const out = [...base];
  for (const t of base)
    for (const suf of GLUED_SUFFIXES)
      if (t.length > suf.length + 3 && t.endsWith(suf)) {
        const pre = t.slice(0, -suf.length);
        if (!DROP_TOKENS.has(pre)) out.push(pre);
        break;
      }
  return out;
};

// ── Brand tokenisation for tiers B–D. Drops legal forms, town names (a hospital's
// town is a separate field, not its brand), the facility-type acronyms (any token
// containing "БАЛ" plus ДКЦ/КОЦ/…) and generic hospital vocabulary, leaving the
// distinctive brand (a person, a saint, a coined name).
const LEGAL = new Set([
  "ЕАД",
  "АД",
  "ЕООД",
  "ООД",
  "ДЗЗД",
  "ЕТ",
  "АГ",
  "АДСИЦ",
  "СД",
  "КД",
]);
const CITIES = new Set([
  "СОФИЯ",
  "ПЛОВДИВ",
  "ВАРНА",
  "БУРГАС",
  "РУСЕ",
  "СТАРА",
  "ЗАГОРА",
  "ПЛЕВЕН",
  "СЛИВЕН",
  "ДОБРИЧ",
  "ШУМЕН",
  "ПЕРНИК",
  "ХАСКОВО",
  "ЯМБОЛ",
  "ПАЗАРДЖИК",
  "БЛАГОЕВГРАД",
  "ВЕЛИКО",
  "ТЪРНОВО",
  "ВРАЦА",
  "ГАБРОВО",
  "ВИДИН",
  "МОНТАНА",
  "КЪРДЖАЛИ",
  "КЮСТЕНДИЛ",
  "ТЪРГОВИЩЕ",
  "РАЗГРАД",
  "СИЛИСТРА",
  "ЛОВЕЧ",
  "СМОЛЯН",
  "БАНКЯ",
  "ХИСАРЯ",
  "ХИСАР",
  "ГОРНА",
  "ОРЯХОВИЦА",
  "ЕЛХОВО",
  "ДЕВИН",
  "ЕТРОПОЛЕ",
  "БЕЛОГРАДЧИК",
  "ЛЮБИМЕЦ",
  "РОМАН",
  "СЕВЛИЕВО",
  "СВИЛЕНГРАД",
]);
// Generic hospital vocabulary — never distinctive, so it can neither form a brand
// nor gate a tier-C/D match. Expanded deliberately (МЕДИЦИНСКИ/КОМПЛЕКС/… included)
// so two facilities sharing only such words never match.
const GENERIC = new Set([
  "УНИВЕРСИТЕТСКА",
  "УНИВЕРСИТЕТСКО",
  "МНОГОПРОФИЛНА",
  "МНОГОПРОФИЛНО",
  "БОЛНИЦА",
  "ЗА",
  "АКТИВНО",
  "ЛЕЧЕНИЕ",
  "СПЕШНА",
  "МЕДИЦИНА",
  "МЕДИЦИНСКИ",
  "МЕДИЦИНСКА",
  "МЕДИЦИНСКО",
  "КОМПЛЕКС",
  "СПЕЦИАЛИЗИРАНА",
  "СПЕЦИАЛИЗИРАНО",
  "СПЕЦИАЛИЗИРАН",
  "ПОМОЩ",
  "ПО",
  "ОБЛАСТНА",
  "ОБЛАСТНО",
  "ДИАГНОСТИЧНО",
  "ДИАГНОСТИЧЕН",
  "КОНСУЛТАТИВЕН",
  "КОНСУЛТАТИВНО",
  "ЦЕНТЪР",
  "НАЦИОНАЛНА",
  "НАЦИОНАЛЕН",
  "И",
  "ПРОДЪЛЖИТЕЛНО",
  "РЕХАБИЛИТАЦИЯ",
  "ЗАБОЛЯВАНИЯ",
  "ЗАБОЛЯВАНИЯТА",
  "ОНКОЛОГИЧЕН",
  "ОНКОЛОГИЧНИ",
  "ОНКОЛОГИЯ",
  "КОМПЛЕКСЕН",
  "ДЕТСКИ",
  "ДЕТСКА",
  "БОЛЕСТИ",
  "ОЧНИ",
  "ОЧЕН",
  "ГР",
  "ПРОФ",
  "АКАД",
  "ДОЦ",
  "ЛЕЧЕБНО",
  "ЗАВЕДЕНИЕ",
  "ДР",
  "ДОКТОР",
  "ДОКТОРА",
  "ЗДРАВЕ",
  "ЗДРАВЕОПАЗВАНЕ",
  "ФИЛИАЛ",
  "НА",
  "КЛОН",
  "ЖЕНСКО",
  "БЕЛОДРОБНИ",
  "БЕЛОДРОБНА",
  "КАРДИОЛОГИЯ",
  "ОРТОПЕДИЯ",
  "ХИРУРГИЯ",
  "КОЖНО",
  "ВЕНЕРИЧЕСКИ",
  "ПСИХИАТРИЯ",
  "ПСИХИАТРИЧНА",
  "НЕРВНИ",
]);
const EXTRA_ACR = new Set([
  "ДКЦ",
  "КДЦ",
  "КОЦ",
  "ЦПЗ",
  "ЦКВЗ",
  "УСБ",
  "СБР",
  "МДОЗС",
  "ДМСГД",
  "МЦ",
  "МС",
  "ДЦ",
  "МК",
  "НК",
  "ДПЛР",
  "БПЛР",
  "БДПЛР",
  "УСБАЛО",
  "СБАЛХЗ",
  "СБАЛОЗ",
  "ОМЦ",
  "МЦОБ",
  "МЦСМП",
  "МЦСП",
  "СБДПЛР",
  "СБПЛББ",
  "СБАЛИПБ",
  "УСБАЛЕ",
]);
const SAINT = new Set(["СВЕТИ", "СВЕТА", "СВ", "СВЕТО"]);
const isTypeAcr = (t: string): boolean => t.includes("БАЛ") || EXTRA_ACR.has(t);

export const brandTokens = (name: string): string[] =>
  name
    .toUpperCase()
    .replace(/[«»"'`„“”‘’–—-]/g, " ")
    .replace(/[^0-9A-ZА-Я]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => (SAINT.has(w) ? "СВ" : w))
    .filter(
      (w) =>
        w.length > 1 &&
        !LEGAL.has(w) &&
        !CITIES.has(w) &&
        !GENERIC.has(w) &&
        !isTypeAcr(w) &&
        !/^\d+$/.test(w),
    );

// ── Curated tables for holdouts no fold can bridge. Each `tokens` entry must be a
// SUBSET of the facility's strongFold token list (see strongFoldTokens); `rzok`
// scopes a match to one РЗОК region when the tokens alone aren't unique. Every EIK
// is hand-verified against the Commerce Register (tr_companies) or the payments
// crosswalk — comment names the facility.
export interface Sig {
  tokens: string[];
  eik: string;
  rzok?: string;
}

// FORCE — applied BEFORE the automatic tiers, to override where a tier would
// otherwise mis-hit. All МВР facilities (institute + Банкя/Хисар rehab filials) are
// one legal entity; without this the Хисар filial collides with the ВМА Хисар one.
export const FORCE_SIGNATURES: Sig[] = [
  { tokens: ["МВР"], eik: "129007218" }, // Медицински институт на МВР (+ филиали)
];

// FALLBACK — applied only when the tiers leave a facility unmatched.
export const FALLBACK_SIGNATURES: Sig[] = [
  // Abbreviation-only names the brand fold can't reach.
  { tokens: ["ПЗ"], rzok: "13", eik: "130072241" }, // МБАЛ-Пазарджик (МБАЛ-ПЗ)
  { tokens: ["ЮЗБ"], eik: "101522447" }, // Югозападна болница, Сандански
  { tokens: ["СБАЛХЗ"], eik: "200105779" }, // СБАЛ хематологични заболявания, София
  // Oncology / specialised centres outside the payments universe.
  { tokens: ["ЧЕРНОЗЕМСКИ"], eik: "000662776" }, // УСБАЛ по онкология Черноземски
  { tokens: ["МУШМОВ"], eik: "000693654" }, // СБАЛОЗ Проф. Марин Мушмов, София
  { tokens: ["КЛЕМЕНТИНА"], rzok: "22", eik: "000689061" }, // МБАЛ Княгиня Клементина
  { tokens: ["КОЦ", "РУСЕ"], rzok: "18", eik: "117527022" }, // КОЦ Русе
  { tokens: ["ОНКОЛОГИЧЕН", "БУРГАС"], rzok: "02", eik: "000053191" }, // КОЦ Бургас
  { tokens: ["УНИВЕРСИТЕТСКА", "БУРГАС"], rzok: "02", eik: "102274111" }, // УМБАЛ Бургас
  { tokens: ["ХАСКОВО"], rzok: "26", eik: "126529015" }, // МБАЛ Хасково
  // Dialysis chains (болнична-помощ payments feed doesn't carry them).
  { tokens: ["ФЪРСТ", "ДИАЛИЗИС"], eik: "131269708" }, // Фърст Диализис Сървисиз (all sites)
  { tokens: ["ДИАЛИЗЕН", "ДРУЖБА"], eik: "206217870" }, // Диализен център Дружба
  { tokens: ["ХЕМОМЕД"], eik: "202976681" }, // Диализен център Хемомед
  { tokens: ["ДИАЛМЕД"], eik: "201314380" }, // Диализен център Диалмед
  { tokens: ["НЕФРОЦЕНТЪР"], eik: "206049069" }, // Нефроцентър Бургас
];

const eqSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

const sigMatches = (sig: Sig, foldToks: string[], rzok: string): boolean =>
  (!sig.rzok || sig.rzok === rzok) &&
  sig.tokens.every((t) => foldToks.includes(t));

export interface NamedEik {
  name: string;
  eik: string;
  /** RZOK region code ("02", "22", …); absent for the МЗ financials source. */
  rzok?: string;
}

/** Build the facility-name → EIK resolver from the two already-EIK-resolved
 *  sources. `payments` carries the RZOK region (enabling the region-scoped tiers);
 *  `financials` is a second, MZ-spelled name source used only for exact folds. */
export const buildActivityEikResolver = (
  payments: NamedEik[],
  financials: NamedEik[],
): ((name: string, rzokCode: string) => string | null) => {
  // Exact strongFold → eik (tier A), from both sources.
  const eikByFold = new Map<string, string>();
  for (const h of [...payments, ...financials]) {
    if (!h.eik) continue;
    const f = strongFold(h.name);
    if (f && !eikByFold.has(f)) eikByFold.set(f, h.eik);
  }
  // Brand index for the region-scoped tiers (payments only — it carries RZOK).
  const payBrand = payments
    .filter((h) => h.eik)
    .map((h) => ({ eik: h.eik, rzok: h.rzok ?? "", br: brandTokens(h.name) }))
    .filter((h) => h.br.length && h.rzok);
  // Brand index for the financials exact-set fallback (no RZOK).
  const finBrand = financials
    .filter((h) => h.eik)
    .map((h) => ({ eik: h.eik, br: brandTokens(h.name) }))
    .filter((h) => h.br.length);

  const uniqueEik = (eiks: string[]): string | null => {
    const set = new Set(eiks);
    return set.size === 1 ? [...set][0] : null;
  };

  return (name: string, rzokCode: string): string | null => {
    const rzok = (rzokCode || "").slice(0, 2);
    const foldToks = strongFoldTokens(name);

    // FORCE curated overrides.
    for (const sig of FORCE_SIGNATURES)
      if (sigMatches(sig, foldToks, rzok)) return sig.eik;

    // Tier A — exact strongFold equality.
    const exact = eikByFold.get(strongFold(name));
    if (exact) return exact;

    const ab = brandTokens(name);
    if (ab.length) {
      const abs = new Set(ab);
      const pool = payBrand.filter((h) => h.rzok === rzok);

      // Tier B — exact brand-set equality.
      const setHit = uniqueEik(
        pool.filter((h) => eqSet(h.br, ab)).map((h) => h.eik),
      );
      if (setHit) return setHit;

      // Tier C — unique subset (one brand ⊆ the other), gated by a distinctive
      // (≥4-char, non-generic) token in the SHORTER brand so a lone generic token
      // can't carry the match.
      const distinctive = (toks: string[]): boolean =>
        toks.some((t) => t.length >= 4 && !GENERIC.has(t));
      const subHit = uniqueEik(
        pool
          .filter((h) => {
            const hs = new Set(h.br);
            const shorter = h.br.length <= ab.length ? h.br : ab;
            return (
              distinctive(shorter) &&
              (h.br.every((t) => abs.has(t)) || ab.every((t) => hs.has(t)))
            );
          })
          .map((h) => h.eik),
      );
      if (subHit) return subHit;

      // Tier D — unique max-overlap winner, gated by a shared PROPER-NAME token
      // (≥5 chars, non-generic) so generic vocabulary never wins.
      let best: string | null = null;
      let bestScore = 0;
      let tied = false;
      for (const h of pool) {
        const inter = h.br.filter((t) => abs.has(t));
        if (!inter.some((t) => t.length >= 5 && !GENERIC.has(t))) continue;
        if (inter.length > bestScore) {
          bestScore = inter.length;
          best = h.eik;
          tied = false;
        } else if (inter.length === bestScore && h.eik !== best) tied = true;
      }
      if (best && !tied) return best;

      // Tier E — financials exact brand-set equality (MZ-spelled names).
      const finHit = uniqueEik(
        finBrand.filter((h) => eqSet(h.br, ab)).map((h) => h.eik),
      );
      if (finHit) return finHit;
    }

    // FALLBACK curated overrides.
    for (const sig of FALLBACK_SIGNATURES)
      if (sigMatches(sig, foldToks, rzok)) return sig.eik;

    return null;
  };
};
