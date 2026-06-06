// Shared place resolver — the linchpin for every place-based tool (local
// elections per-município + place-keyed governance).
//
// Resolves free-text BG/EN place names to the codes the data is keyed by:
//   - obshtina (município) code, e.g. "PDV01", "VAR06", synthetic "SOF" for Sofia
//   - oblast / МИР code, e.g. "VAR", "PDV" (province) vs "PDV-00" (city),
//     "S23/S24/S25" (Sofia city), "SFO" (Sofia province), "32" (abroad)
//   - ekatte + nuts3 for the município centre
//
// Source: /municipalities.json (294 entries). Its `oblast` field matches the
// governance regional keys here, so we trust it (unlike the budget-shard
// `area.oblast` caveat which is a different field).

import { fetchData } from "./dataClient";
import type { Lang } from "./types";

export type Muni = {
  obshtina: string;
  name: string;
  nameEn: string;
  oblast: string;
  nuts3: string;
  ekatte: string;
};

export type PlaceMatch = Muni & {
  oblastName: { bg: string; en: string };
  // other same-name municipalities (Бяла, Искър, Средец collide) for disambig
  ambiguous?: Muni[];
};

// 31 МИР / oblast codes used across the governance + regional data, bilingual.
export const OBLASTS: Record<string, { bg: string; en: string }> = {
  BGS: { bg: "Бургас", en: "Burgas" },
  BLG: { bg: "Благоевград", en: "Blagoevgrad" },
  DOB: { bg: "Добрич", en: "Dobrich" },
  GAB: { bg: "Габрово", en: "Gabrovo" },
  HKV: { bg: "Хасково", en: "Haskovo" },
  JAM: { bg: "Ямбол", en: "Yambol" },
  KNL: { bg: "Кюстендил", en: "Kyustendil" },
  KRZ: { bg: "Кърджали", en: "Kardzhali" },
  LOV: { bg: "Ловеч", en: "Lovech" },
  MON: { bg: "Монтана", en: "Montana" },
  PAZ: { bg: "Пазарджик", en: "Pazardzhik" },
  PDV: { bg: "Пловдив (област)", en: "Plovdiv (province)" },
  "PDV-00": { bg: "Пловдив (град)", en: "Plovdiv (city)" },
  PER: { bg: "Перник", en: "Pernik" },
  PVN: { bg: "Плевен", en: "Pleven" },
  RAZ: { bg: "Разград", en: "Razgrad" },
  RSE: { bg: "Русе", en: "Ruse" },
  S23: { bg: "София (23 МИР)", en: "Sofia (MIR 23)" },
  S24: { bg: "София (24 МИР)", en: "Sofia (MIR 24)" },
  S25: { bg: "София (25 МИР)", en: "Sofia (MIR 25)" },
  SFO: { bg: "София (област)", en: "Sofia (province)" },
  SHU: { bg: "Шумен", en: "Shumen" },
  SLS: { bg: "Силистра", en: "Silistra" },
  SLV: { bg: "Сливен", en: "Sliven" },
  SML: { bg: "Смолян", en: "Smolyan" },
  SZR: { bg: "Стара Загора", en: "Stara Zagora" },
  TGV: { bg: "Търговище", en: "Targovishte" },
  VAR: { bg: "Варна", en: "Varna" },
  VID: { bg: "Видин", en: "Vidin" },
  VRC: { bg: "Враца", en: "Vratsa" },
  VTR: { bg: "Велико Търново", en: "Veliko Tarnovo" },
  "32": { bg: "Чужбина", en: "Abroad" },
};

export const oblastName = (code: string): { bg: string; en: string } =>
  OBLASTS[code] ?? { bg: code, en: code };

// Sofia's city-wide local-elections bundle uses the synthetic obshtina "SOF".
const SOFIA_ALIAS: Muni = {
  obshtina: "SOF",
  name: "Столична община",
  nameEn: "Sofia",
  oblast: "S23",
  nuts3: "BG411",
  ekatte: "68134",
};

const QUALIFIER =
  /\b(община|общ\.?|област|municipality|oblast|province|region|град|city)\b/g;

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(QUALIFIER, " ")
    .replace(/[\s.\-_/'’`]+/g, "")
    .trim();

let muniCache: Muni[] | null = null;

export const loadMunis = async (): Promise<Muni[]> => {
  if (muniCache) return muniCache;
  const raw = await fetchData<
    {
      ekatte: string;
      name: string;
      name_en: string;
      obshtina: string;
      nuts3: string;
      oblast: string;
    }[]
  >("/municipalities.json");
  muniCache = raw.map((e) => ({
    obshtina: e.obshtina,
    name: e.name,
    nameEn: e.name_en,
    oblast: e.oblast,
    nuts3: e.nuts3,
    ekatte: e.ekatte,
  }));
  return muniCache;
};

// Sofia is the synthetic SOF município (not in municipalities.json), so the
// substring match below can't find it — detect it by keyword. Substring (not
// exact) so leftover words from extractPlace ("...кметове на софия") still hit.
// "софийск"/"софийска област" (the SFO oblast) deliberately does NOT match.
const isSofia = (q: string): boolean =>
  /софия|sofia|столичн|столица/.test(norm(q));

// Resolve a município by free-text name (BG or EN). Exact normalized name wins;
// otherwise the longest substring match. Same-name collisions return the first
// match with `.ambiguous` listing the alternatives.
export const resolveMunicipality = async (
  query: string,
): Promise<PlaceMatch | undefined> => {
  if (!query) return undefined;
  if (isSofia(query)) {
    return { ...SOFIA_ALIAS, oblastName: { bg: "София", en: "Sofia" } };
  }
  const munis = await loadMunis();
  const q = norm(query);
  if (!q) return undefined;

  const exact = munis.filter((m) => norm(m.name) === q || norm(m.nameEn) === q);
  let pool = exact;
  if (pool.length === 0) {
    pool = munis.filter((m) => {
      const a = norm(m.name);
      const b = norm(m.nameEn);
      return a.includes(q) || q.includes(a) || b.includes(q) || q.includes(b);
    });
  }
  if (pool.length === 0) return undefined;

  // prefer the shortest name (so "Варна" beats "Долни чифлик" on substring)
  pool.sort((a, b) => a.name.length - b.name.length);
  const best = pool[0];
  const alternatives =
    exact.length > 1 ? exact.filter((m) => m !== best) : undefined;
  return {
    ...best,
    oblastName: oblastName(best.oblast),
    ambiguous: alternatives,
  };
};

// Resolve an oblast / МИР by free-text name or raw code.
export const resolveOblast = (
  query: string,
): { code: string; name: { bg: string; en: string } } | undefined => {
  if (!query) return undefined;
  const raw = query.trim().toUpperCase();
  if (OBLASTS[raw]) return { code: raw, name: OBLASTS[raw] };
  const q = norm(query);
  // Sofia city defaults to MIR 23; Plovdiv defaults to the province
  if (["софияград", "sofiacity"].includes(q))
    return { code: "S23", name: OBLASTS.S23 };
  if (["софияобласт", "sofiaprovince"].includes(q))
    return { code: "SFO", name: OBLASTS.SFO };
  for (const [code, name] of Object.entries(OBLASTS)) {
    if (norm(name.bg) === q || norm(name.en) === q) return { code, name };
  }
  // looser: a name that starts with the query (e.g. "Стара" -> Стара Загора)
  for (const [code, name] of Object.entries(OBLASTS)) {
    if (norm(name.bg).startsWith(q) || norm(name.en).startsWith(q))
      return { code, name };
  }
  return undefined;
};

// Find an oblast whose name appears *inside* a longer sentence (so a question
// like "активността в Хасково" resolves Хасково even with surrounding words).
export const findOblastInText = (
  text: string,
): { code: string; name: { bg: string; en: string } } | undefined => {
  const t = norm(text);
  for (const [code, name] of Object.entries(OBLASTS)) {
    const nb = norm(name.bg);
    const ne = norm(name.en);
    if (nb.length >= 4 && t.includes(nb)) return { code, name };
    if (ne.length >= 4 && t.includes(ne)) return { code, name };
  }
  return undefined;
};

// Convenience: a place's display name in the requested language.
export const placeLabel = (p: PlaceMatch, lang: Lang): string =>
  lang === "bg" ? p.name : p.nameEn || p.name;
