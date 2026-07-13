// Ownership classification (state | municipal | private) for the НЗОК hospital
// corpus — the answer to Диагноза България's biggest published gap ("excludes
// private hospitals"). NO new source is needed: the МЗ ЕЕОФ financial return
// (Наредба № 5/2019) is filed ONLY by state- and municipally-owned лечебни
// заведения, so it IS the authoritative public-hospital roster. A facility НЗОК
// pays that is absent from ЕЕОФ is, by construction, private.
//
// The hard part is linking the ЕЕОФ roster (name-keyed, ~180 hospitals) to the
// payment universe (Рег.№-keyed, ~430 facilities). We classify with a layered,
// EXACT-first ladder so a miss stays honest rather than risking a wrong label:
//
//   1. eik bridge     — payment.eik ∈ the ЕЕОФ eik set (financials loader already
//                       resolves eik per row). Exact, zero false positives.
//   2. exact fold     — payment name folds identically to an ЕЕОФ name.
//   3. strict surname — shared distinctive NON-city surname/brand token(s)
//                       (≥4 chars) covering the smaller name, with CITY and
//                       facility-TYPE agreement as guards. City is a guard, never
//                       a match key (every Пловдив hospital shares "ПЛОВДИВ"); an
//                       all-common-saint-token match (Св. Иван Рилски is in a
//                       dozen towns) additionally requires the cities to agree.
//   4. manual override — a hand-verified table (below) for the residual the
//                       heuristics cannot reach: the national state hospitals
//                       whose ЕЕОФ row never resolved an eik (Св. Иван Рилски ЕАД,
//                       Царица Йоанна–ИСУЛ, …) and the state hospitals ЕЕОФ never
//                       lists at all because they answer to another ministry (ВМА
//                       → МО, Медицински институт → МВР).
//
// Anything left after the ladder is `private`. Verified split (2026-05, YTD €):
// state 41.5% · municipal 14.9% · private 43.5% — i.e. ~44% of НЗОК hospital money
// flows to private hospitals, the slice a state/municipal-only scope makes vanish.

import { fold } from "../../db/lib/nzok_fold";

export type Ownership = "state" | "municipal" | "private";

// A facility's ownership plus the ladder rung that decided it (kept for the audit
// print + the JSON provenance, never surfaced to users).
export interface OwnershipVerdict {
  ownership: Ownership;
  method: string;
}

// ── Hand-verified overrides. Each was confirmed individually; comment = why the
// heuristics miss it. Keyed by eik first (a company owns all its ЛЗ), then by
// Рег.№ for the state МВР/МО facilities that carry no eik in the corpus.
export const MANUAL_OWNERSHIP_BY_EIK: Record<string, Ownership> = {
  // National state hospitals whose ЕЕОФ row never resolved an eik (abbreviated /
  // saint / national names the fold+dist ladder cannot bridge to the payments name).
  "000715054": "state", // УМБАЛ „Св. Иван Рилски“ ЕАД, София (national)
  "831605806": "state", // УМБАЛ „Царица Йоанна – ИСУЛ“ ЕАД
  "000662776": "state", // УСБАЛО „Проф. Иван Черноземски“ ЕАД (national oncology)
  // State hospitals ЕЕОФ never lists — they report to another ministry, not МЗ.
  "129000273": "state", // Военномедицинска академия (ВМА) — Министерство на отбраната
  "129007218": "state", // Медицински институт – МВР
};

// State facilities carrying no eik in the payment corpus (МВР/МО rehab filials).
// Keyed by Рег.№ ЛЗ. A null-eik row cannot ride the by-eik override above.
export const MANUAL_OWNERSHIP_BY_REGNO: Record<string, Ownership> = {};

// Facility-type tokens (stripped before surname matching) + the city gazetteer
// (a GUARD, never a match key) + common saint/ordinal tokens (a lone shared one
// is not identifying, so such a match must also agree on city).
const TYPE = new Set([
  "УМБАЛ",
  "МБАЛ",
  "СБАЛ",
  "СБАЛК",
  "СБАЛО",
  "СБАЛОЗ",
  "СБАЛББ",
  "СБАЛАГ",
  "СБАГАЛ",
  "СБДПЛР",
  "СБПЛР",
  "ДКЦ",
  "КОЦ",
  "МЦ",
  "МДЦ",
  "ДЦ",
  "УСБАЛ",
  "СБР",
  "ЛЗ",
  "БОЛНИЦА",
  "МНОГОПРОФИЛНА",
  "АКТИВНО",
  "ЛЕЧЕНИЕ",
  "СПЕЦИАЛИЗИРАНА",
  "УНИВЕРСИТЕТСКА",
  "ОБЛАСТНА",
  "ОКРЪЖНА",
  "ХОСПИТАЛ",
  "КЛИНИКА",
  "КЛИНИК",
  "СИТИ",
  "БПЛР",
  "МОБАЛ",
  "МБАЛНП",
  "НСБФТР",
  "УСБАЛДБ",
  "УСБАЛЕ",
  "УСБАЛО",
  "СБАЛИПБ",
  "СБАЛХЗ",
  "СБЛРВБ",
  "СБПЛББ",
  "СБПФЗПЛР",
  "СБПЛРПФЗ",
  "СБАЛПФЗ",
  "ЦПЗ",
  "ЦКВЗ",
  "ДПБ",
  "НКБ",
  "МБПЛ",
  "СБАЛПЗ",
  "БДПЛР",
  "СХБАЛ",
  "СГЕБАЛ",
  "СОБАЛ",
  "СБАЛТОСМ",
  "АМЦСМП",
  "МЦСМП",
  "ОМЦ",
  "АМЦ",
  "ФИЛИАЛ",
  "КЛОН",
  "КЪМ",
]);

const CITY = new Set([
  "СОФИЯ",
  "ПЛОВДИВ",
  "ВАРНА",
  "БУРГАС",
  "ПЛЕВЕН",
  "РУСЕ",
  "СТАРА",
  "ЗАГОРА",
  "СЛИВЕН",
  "ВРАЦА",
  "ВИДИН",
  "МОНТАНА",
  "ПЕРНИК",
  "КЮСТЕНДИЛ",
  "БЛАГОЕВГРАД",
  "КЪРДЖАЛИ",
  "СМОЛЯН",
  "ПАЗАРДЖИК",
  "ХАСКОВО",
  "ЯМБОЛ",
  "ГАБРОВО",
  "ЛОВЕЧ",
  "ТЪРНОВО",
  "ГОРНА",
  "ОРЯХОВИЦА",
  "ДОБРИЧ",
  "ШУМЕН",
  "ТЪРГОВИЩЕ",
  "РАЗГРАД",
  "СИЛИСТРА",
  "ДУПНИЦА",
  "КАЗАНЛЪК",
  "ПАНАГЮРИЩЕ",
  "ТРЯВНА",
  "ТРОЯН",
  "РОМАН",
  "МЕЗДРА",
  "КОТЕЛ",
  "ВЕЛИНГРАД",
  "ИСКРЕЦ",
  "АСЕНОВГРАД",
  "КАРЛОВО",
  "СВИЩОВ",
  "ПОПОВО",
  "ДЕВИН",
  "БЕРКОВИЦА",
  "ПРОВАДИЯ",
  "ЕЛХОВО",
  "ГОЦЕ",
  "ДЕЛЧЕВ",
  "ЗЛАТОГРАД",
  "МАДАН",
  "ИСПЕРИХ",
  "КУБРАТ",
  "ПЕЩЕРА",
  "ЛЮБИМЕЦ",
  "КОСТЕНЕЦ",
  "БУХОВО",
  "ПАНЧАРЕВО",
  "СТАМБОЛИЙСКИ",
  "ВЕЛИКО",
  "ДИМИТРОВГРАД",
  "БАНКЯ",
  "БАНЯ",
  "КОЗЛОДУЙ",
  "ПОМОРИЕ",
  "САНДАНСКИ",
  "ХИСАР",
  "ЛОМ",
  "ЧЕПЕЛАРЕ",
  "БЯЛА",
]);

const COMMON = new Set([
  "РИЛСКИ",
  "ГЕОРГИ",
  "АННА",
  "МИНА",
  "ПЕТКА",
  "ИВАН",
  "НИКОЛАЙ",
  "ПАНТЕЛЕЙМОН",
  "БОГОРОДИЦА",
  "НАДЕЖДА",
  "СОФИЯ",
  "ПЪРВА",
  "ВТОРА",
  "ТРЕТА",
  "ЧЕТВЪРТА",
  "ПЕТА",
  "ЕКАТЕРИНА",
  "НИКОЛА",
  "ПЕТЪР",
  "МАРИНА",
  "БОРИС",
  "ЙОАНА",
  "ЙОАННА",
  "ЦАРИЦА",
  "КНЯГИНЯ",
  "ДИМИТЪР",
  "ЙОАН",
  "КАРИДАД",
]);

const distinct = (s: string): string[] => [
  ...new Set(
    fold(s)
      .split(" ")
      .filter((w) => w && w.length >= 4 && !TYPE.has(w) && !CITY.has(w)),
  ),
];
const cityOf = (s: string): string[] => [
  ...new Set(
    fold(s)
      .split(" ")
      .filter((w) => CITY.has(w)),
  ),
];
const typeOf = (s: string): "H" | "C" | "?" => {
  for (const t of fold(s).split(" ")) {
    if (/БАЛ|НКБ|БОЛНИЦА|ХОСПИТАЛ/.test(t)) return "H";
    if (/ДКЦ|МДЦ|МЦ|ДЦ|АМЦ|ЦЕНТ/.test(t)) return "C";
  }
  return "?";
};

interface EeofEntry {
  ownership: Ownership;
  fold: string;
  dist: string[];
  city: string[];
  type: "H" | "C" | "?";
}

export interface EeofOwnershipIndex {
  byEik: Map<string, Ownership>;
  byFold: Map<string, Ownership>;
  entries: EeofEntry[];
}

/** Build the ownership lookup from the latest quarter of the ЕЕОФ financials file
 *  (data/budget/nzok/hospital_financials.json). Only state + municipal hospitals
 *  file ЕЕОФ, so the two ownership classes are exactly this roster. */
export const buildEeofOwnershipIndex = (financials: {
  quarters: {
    quarter: string;
    ownership: string;
    hospitals: { name: string }[];
  }[];
}): EeofOwnershipIndex & { quarter: string | null } => {
  const quarter =
    financials.quarters
      .map((q) => q.quarter)
      .sort((a, b) => b.localeCompare(a))[0] ?? null;
  const byEik = new Map<string, Ownership>();
  const byFold = new Map<string, Ownership>();
  const entries: EeofEntry[] = [];
  // The financials JSON carries no eik (eik is joined at PG-load time), so the eik
  // bridge is seeded by the caller from the loaded table; here we index by name.
  for (const q of financials.quarters) {
    if (q.quarter !== quarter) continue;
    const ownership = q.ownership === "state" ? "state" : "municipal";
    for (const h of q.hospitals) {
      const f = fold(h.name);
      if (!f) continue;
      if (!byFold.has(f)) byFold.set(f, ownership);
      entries.push({
        ownership,
        fold: f,
        dist: distinct(h.name),
        city: cityOf(h.name),
        type: typeOf(h.name),
      });
    }
  }
  return { byEik, byFold, entries, quarter };
};

/** Classify one payment facility against the ЕЕОФ index + the manual overrides. */
export const classifyOwnership = (
  facility: { regNo: string; name: string; eik: string | null },
  index: EeofOwnershipIndex,
): OwnershipVerdict => {
  const { regNo, name, eik } = facility;
  // Manual overrides win — they encode verified truth the heuristics cannot reach.
  if (eik && MANUAL_OWNERSHIP_BY_EIK[eik])
    return { ownership: MANUAL_OWNERSHIP_BY_EIK[eik], method: "override" };
  if (MANUAL_OWNERSHIP_BY_REGNO[regNo])
    return { ownership: MANUAL_OWNERSHIP_BY_REGNO[regNo], method: "override" };
  // 1. eik bridge (exact).
  if (eik && index.byEik.has(eik))
    return { ownership: index.byEik.get(eik)!, method: "eik" };
  // 2. exact fold.
  const f = fold(name);
  if (index.byFold.has(f))
    return { ownership: index.byFold.get(f)!, method: "fold" };
  // 3. strict surname match.
  const pd = distinct(name);
  const pcity = cityOf(name);
  const ptype = typeOf(name);
  let best: { ownership: Ownership; score: number } | null = null;
  for (const e of index.entries) {
    if (!pd.length || !e.dist.length) continue;
    const shared = pd.filter((t) => e.dist.includes(t));
    if (!shared.length) continue;
    if (pcity.length && e.city.length && !pcity.some((c) => e.city.includes(c)))
      continue; // city guard
    if (ptype !== "?" && e.type !== "?" && ptype !== e.type) continue; // type guard
    const smaller = Math.min(pd.length, e.dist.length);
    const coversSmaller = shared.length === smaller;
    const citiesAgree =
      pcity.length > 0 &&
      e.city.length > 0 &&
      pcity.some((c) => e.city.includes(c));
    const strong = shared.some((t) => t.length >= 5 && !COMMON.has(t));
    const allCommon = shared.every((t) => COMMON.has(t));
    const ok = allCommon
      ? citiesAgree && coversSmaller
      : (coversSmaller && strong) ||
        shared.length >= 2 ||
        (coversSmaller && citiesAgree);
    if (!ok) continue;
    const score =
      shared.reduce((a, t) => a + t.length, 0) + (citiesAgree ? 3 : 0);
    if (!best || score > best.score) best = { ownership: e.ownership, score };
  }
  if (best) return { ownership: best.ownership, method: "surname" };
  return { ownership: "private", method: "residual" };
};
