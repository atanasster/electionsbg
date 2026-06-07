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

import { AmbiguousPlaceError, parsePlacePin } from "./clarify";
import { fetchData } from "./dataClient";
import { fuzzyBestMatch } from "./resolve";
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
    .replace(/[\s.\-_/'’`()]+/g, "")
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

// A settlement (населено място) carries its OWN ekatte + its parent obshtina, so
// a resolved settlement is PlaceMatch-shaped and drops into the place tools as a
// fallback: ekatte-keyed tools (GRAO, procurement) get the village itself,
// obshtina-keyed tools (census) get its parent município.
type SettlementRow = Muni & { tvm: string };
let settlementCache: SettlementRow[] | null = null;

const loadSettlements = async (): Promise<SettlementRow[]> => {
  if (settlementCache) return settlementCache;
  const raw = await fetchData<
    {
      ekatte: string;
      name: string;
      name_en: string;
      oblast: string;
      obshtina: string;
      nuts3: string;
      t_v_m?: string;
    }[]
  >("/settlements.json");
  settlementCache = raw.map((e) => ({
    obshtina: e.obshtina,
    name: e.name,
    nameEn: e.name_en,
    oblast: e.oblast,
    nuts3: e.nuts3,
    ekatte: e.ekatte,
    tvm: e.t_v_m ?? "",
  }));
  return settlementCache;
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
  opts: { exact?: boolean } = {},
): Promise<PlaceMatch | undefined> => {
  if (!query) return undefined;
  // A disambiguation pick re-arrives as an "obshtina:<code>" pin — resolve it
  // straight to that município (a settlement pin isn't ours, so decline it so it
  // isn't fuzzy-matched to a lookalike name).
  const pin = parsePlacePin(query);
  if (pin) {
    if (pin.kind !== "obshtina") return undefined;
    if (pin.value === SOFIA_ALIAS.obshtina)
      return { ...SOFIA_ALIAS, oblastName: { bg: "София", en: "Sofia" } };
    const all = await loadMunis();
    const m = all.find((x) => x.obshtina === pin.value);
    return m ? { ...m, oblastName: oblastName(m.oblast) } : undefined;
  }
  if (isSofia(query)) {
    return { ...SOFIA_ALIAS, oblastName: { bg: "София", en: "Sofia" } };
  }
  const munis = await loadMunis();
  const q = norm(query);
  if (!q) return undefined;

  const exact = munis.filter((m) => norm(m.name) === q || norm(m.nameEn) === q);
  // Genuine duplicate names (Бяла, Искър, Средец) — don't guess; let the caller
  // ask the user which one. runTool turns this into a chooser.
  if (exact.length > 1)
    throw new AmbiguousPlaceError(
      "municipality",
      query,
      exact.map((m) => ({ ...m, oblastName: oblastName(m.oblast) })),
    );
  let pool = exact;
  // exact-only mode: skip the substring/fuzzy tiers (used to order an EXACT
  // settlement ahead of a FUZZY município — see resolvePlaceForData).
  if (pool.length === 0 && opts.exact) return undefined;
  if (pool.length === 0) {
    pool = munis.filter((m) => {
      const a = norm(m.name);
      const b = norm(m.nameEn);
      return a.includes(q) || q.includes(a) || b.includes(q) || q.includes(b);
    });
  }
  if (pool.length === 0) {
    // typo / transliteration-drift fallback ("Пловдв", "Asenovgrd", "Turnovo").
    // Include the synthetic Sofia bundle so a misspelt capital ("Софя", "Sofa",
    // mixed-script "Cофия") still resolves — isSofia above is exact-substring
    // only and Sofia is NOT in municipalities.json.
    const hit = fuzzyBestMatch(
      query,
      () => [
        { item: SOFIA_ALIAS, keys: ["София", "Sofia", SOFIA_ALIAS.name] },
        ...munis.map((m) => ({ item: m, keys: [m.name, m.nameEn] })),
      ],
      { threshold: 0.3, minLen: 4, cacheKey: "muni" },
    );
    if (!hit) return undefined;
    if (hit.item === SOFIA_ALIAS) {
      return { ...SOFIA_ALIAS, oblastName: { bg: "София", en: "Sofia" } };
    }
    pool = [hit.item];
  }

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

// Resolve a settlement (село/град) by free-text name (BG or EN). Same tiers as
// município — exact → substring → fuzzy typo fallback. Settlement names collide
// heavily (dozens of villages share a name), so among equal matches we prefer a
// town (гр.) over a village (с.), then the shortest name, and expose the rest in
// `.ambiguous`. Returns a PlaceMatch (its own ekatte, parent obshtina) so it
// slots into the place tools unchanged. município resolution should be tried
// FIRST by callers (the bigger entity wins on a name shared with a município).
export const resolveSettlement = async (
  query: string,
  opts: { exact?: boolean } = {},
): Promise<PlaceMatch | undefined> => {
  if (!query) return undefined;
  const all = await loadSettlements();
  // A disambiguation pick re-arrives as an "ekatte:<code>" pin — resolve it
  // straight to that settlement (a município pin isn't ours, so decline it).
  const pin = parsePlacePin(query);
  if (pin) {
    if (pin.kind !== "ekatte") return undefined;
    const s = all.find((x) => x.ekatte === pin.value);
    return s ? { ...s, oblastName: oblastName(s.oblast) } : undefined;
  }
  const q = norm(query);
  if (!q) return undefined;

  const exact = all.filter((s) => norm(s.name) === q || norm(s.nameEn) === q);
  // Several settlements share a name ("Баня" = a town + five villages) — don't
  // guess; raise so runTool can ask the user which one (only on an EXACT-name
  // collision, so a confident single match still resolves silently).
  if (exact.length > 1)
    throw new AmbiguousPlaceError(
      "settlement",
      query,
      exact.map((s) => ({ ...s, oblastName: oblastName(s.oblast) })),
    );
  let pool = exact;
  if (pool.length === 0 && opts.exact) return undefined;
  if (pool.length === 0) {
    pool = all.filter((s) => {
      const a = norm(s.name);
      const b = norm(s.nameEn);
      return a.includes(q) || q.includes(a) || b.includes(q) || q.includes(b);
    });
  }
  if (pool.length === 0) {
    const hit = fuzzyBestMatch(
      query,
      () => all.map((s) => ({ item: s, keys: [s.name, s.nameEn] })),
      { threshold: 0.3, minLen: 4, cacheKey: "settlement" },
    );
    if (!hit) return undefined;
    pool = [hit.item];
  }

  // towns before villages, then shortest name (so "Сливен" the town beats a
  // same-named hamlet, and "Бяла" beats "Бяла черква" on a substring sweep)
  const rank = (s: SettlementRow): number => (s.tvm === "гр." ? 0 : 1);
  pool.sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length);
  const best = pool[0];
  const alternatives =
    pool.length > 1 ? pool.filter((s) => s !== best).slice(0, 5) : undefined;
  return {
    ...best,
    oblastName: oblastName(best.oblast),
    ambiguous: alternatives,
  };
};

// Place resolution for settlement-level tools (GRAO / census / procurement).
// Order = EXACT before FUZZY: an exact município, then an exact settlement, then
// a fuzzy município, then a fuzzy settlement. This is the key precedence fix:
// "Баня" no longer substring-matches the município "Долна баня" (which would
// pre-empt the 5 villages literally named "Баня") — the exact settlement wins;
// yet a partial/typo'd município name ("Пловдв") still beats a fuzzy settlement.
export const resolvePlaceForData = async (
  query: string,
): Promise<PlaceMatch | undefined> =>
  (await resolveMunicipality(query, { exact: true })) ??
  (await resolveSettlement(query, { exact: true })) ??
  (await resolveMunicipality(query)) ??
  (await resolveSettlement(query));

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
  // typo fallback over the bare oblast names (strip the "(област)/(province)/
  // (МИР)" qualifier so only the place name is fuzzy-matched).
  return fuzzyBestMatch(
    query,
    () =>
      Object.entries(OBLASTS).map(([code, name]) => ({
        item: { code, name },
        keys: [oblastBase(name.bg), oblastBase(name.en)],
      })),
    { threshold: 0.3, minLen: 4, cacheKey: "oblast" },
  )?.item;
};

// Find an oblast whose name appears *inside* a longer sentence (so a question
// like "активността в Хасково" resolves Хасково even with surrounding words).
// strip a trailing "(област)" / "(province)" / "(23 МИР)" qualifier from an
// oblast display name so only the bare place name is matched. Needed because the
// global QUALIFIER strip relies on \b, which JS does not honour around Cyrillic,
// so "Пловдив (област)" would otherwise keep "област" and never match a query
// that writes it in a different position ("в област Пловдив").
const oblastBase = (s: string): string => s.replace(/\s*\([^)]*\)\s*/g, " ");

export const findOblastInText = (
  text: string,
): { code: string; name: { bg: string; en: string } } | undefined => {
  const t = norm(text);
  for (const [code, name] of Object.entries(OBLASTS)) {
    const nb = norm(oblastBase(name.bg));
    const ne = norm(oblastBase(name.en));
    if (nb.length >= 4 && t.includes(nb)) return { code, name };
    if (ne.length >= 4 && t.includes(ne)) return { code, name };
  }
  return undefined;
};

// Convenience: a place's display name in the requested language.
export const placeLabel = (p: PlaceMatch, lang: Lang): string =>
  lang === "bg" ? p.name : p.nameEn || p.name;
