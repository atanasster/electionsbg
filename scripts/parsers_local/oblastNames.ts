// The oblast dictionaries shared by every local-elections resolver, and the name+oblast
// tiebreak they exist for.
//
// WHY IT EXISTS. `data/municipalities.json` stores oblast as a CODE ("RSE"), while every
// CIK surface — the legacy chmi heading, the 2007 breadcrumb, the modern rezultati page
// header — gives the oblast NAME ("Русе"). Resolving a município by name alone is
// ambiguous: three catalogue names are not unique, and in each pair the oblast is the
// discriminator.
//
//   бяла   → VAR05 (Варна)  |  RSE04 (Русе)
//   искър  → PVN23 (Плевен) |  S2414 (София-Искър, a Sofia район)
//   средец → BGS06 (Бургас) |  S2401 (София-Средец, a Sofia район)
//
// искър/средец are latent AND not resolvable by the NAME map: their second entry is a Sofia
// район whose catalogue oblast is `S24`, a value this dictionary has no key for and — since
// CIK writes "София"/"Столична" for all of them — could not usefully gain one. They are safe
// only because the районни are fanned out of the SOF bundle and never arrive as their own
// tur1 page. If that ever changes they need the OIK code (below) or NAME_ALIASES, not this.
//
// This was NOT theoretical. `parse_local_elections.ts` matched on name only and took the
// first hit, so both "Бяла" pages resolved to VAR05 — and the collision handler kept the
// first bundle's mayor/council and discarded the second's. Общ. Бяла (обл. Русе) therefore
// had NO mayor race, NO council and NO councillor pages for the 2019 and 2023 cycles, while
// 14 of its village mayors were published as office-holders in обл. Варна. See
// docs/plans/village-mayor-attribution-v1.md §T0.
//
// TWO DICTIONARIES, because one input is not always present:
//
//   OBLAST_NAME_TO_CODE   the page's own oblast heading. Present on 2019+ pages only.
//   OIK_PREFIX_TO_OBLAST  the OIK code, present on EVERY page of EVERY cycle.
//
// The second exists because the first is empty exactly where the damage is worst: measured
// on the cached pages, 2011 (264/264) and 2015 (265/265) carry NO oblast at all, so a
// name+oblast tiebreak alone is inert there and both cycles still collide Бяла onto VAR05
// (2011 additionally files the rural Добрич OIK 0815 as the CITY DOB28 and drops the real
// city page). The OIK prefix is a reliable substitute: verified 1:1 across every cached
// tur1 page of 2019 and 2023 — 28 prefixes, 28 oblasts, zero prefix mapping to two oblasts.
//
// The legacy-chmi and 2007 ingests always resolved with the oblast (`resolveByOblastName`),
// which is why 2007 has an intact RSE04 bundle and 2019/2023 did not. The name map lived
// inside `ingest_legacy_chmi.ts`; it is hoisted here so every path uses the SAME dictionary
// rather than a copy that can drift — the same reason `localPersonRefs.ts` exists.

/** Normalise a place name for dictionary lookup: lowercase (Bulgarian locale), drop
 *  parentheticals ("София (столица)" → "софия"), collapse whitespace.
 *
 *  THE one implementation. It was copied byte-for-byte into six parser modules; the two
 *  that participate in município resolution now import it, so the gate that computes "which
 *  names are duplicated" and the production code that matches them cannot diverge. */
export const normPlaceName = (s: string): string =>
  s
    .toLocaleLowerCase("bg")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const OBLAST_NAME_TO_CODE: Record<string, string> = {
  благоевград: "BLG",
  бургас: "BGS",
  варна: "VAR",
  "велико търново": "VTR",
  видин: "VID",
  враца: "VRC",
  габрово: "GAB",
  добрич: "DOB",
  кърджали: "KRZ",
  кюстендил: "KNL",
  ловеч: "LOV",
  монтана: "MON",
  пазарджик: "PAZ",
  перник: "PER",
  плевен: "PVN",
  пловдив: "PDV",
  разград: "RAZ",
  русе: "RSE",
  силистра: "SLS",
  сливен: "SLV",
  смолян: "SML",
  // Three spellings of Sofia PROVINCE, because three CIK generations wrote it differently.
  // The CITY never reaches this map — "Столична"/"София" are routed by NAME_ALIASES → SOF
  // before any tiebreak. `софийска` is the modern rezultati form ("област Софийска") and
  // covers 22 of 265 pages per cycle; it was missing when this map was hoisted from the
  // legacy ingest, which silently disabled the tiebreak on all of them.
  софия: "SFO",
  "софия област": "SFO",
  софийска: "SFO",
  "стара загора": "SZR",
  търговище: "TGV",
  хасково: "HKV",
  шумен: "SHU",
  ямбол: "JAM",
};

/** OIK prefix → oblast code. A local-election OIK is `<oblast-ordinal><obshtina-ordinal>`,
 *  the 28 oblasts in Bulgarian alphabetical order. Verified 1:1 against the oblast heading on
 *  every cached tur1 page of 2019 and 2023.
 *
 *  `22` is Столична (Sofia CITY) and is deliberately absent: the city's município is not in
 *  data/municipalities.json under an oblast at all — it is the synthetic SOF bundle reached
 *  via NAME_ALIASES — so mapping it here could only ever mislead. `23` is Sofia PROVINCE. */
export const OIK_PREFIX_TO_OBLAST: Record<string, string> = {
  "01": "BLG",
  "02": "BGS",
  "03": "VAR",
  "04": "VTR",
  "05": "VID",
  "06": "VRC",
  "07": "GAB",
  "08": "DOB",
  "09": "KRZ",
  "10": "KNL",
  "11": "LOV",
  "12": "MON",
  "13": "PAZ",
  "14": "PER",
  "15": "PVN",
  "16": "PDV",
  "17": "RAZ",
  "18": "RSE",
  "19": "SLS",
  "20": "SLV",
  "21": "SML",
  "23": "SFO",
  "24": "SZR",
  "25": "TGV",
  "26": "HKV",
  "27": "SHU",
  "28": "JAM",
};

/** The oblast CODE for a heading's oblast NAME, or null when the name is absent/unknown.
 *  Unknown is a real state (a pre-2019 page with no oblast in its header), and callers fall
 *  back to the OIK prefix and then to a name-only match — so this must not throw. */
export const oblastCodeForName = (
  oblastName: string | null | undefined,
): string | null =>
  oblastName ? (OBLAST_NAME_TO_CODE[normPlaceName(oblastName)] ?? null) : null;

/** The oblast CODE encoded in an OIK code, or null for a non-4-digit code / unknown prefix
 *  (Sofia city's `22`, and the S2*** район pseudo-OIKs the fan-out mints). */
export const oblastCodeForOik = (
  oikCode: string | null | undefined,
): string | null =>
  oikCode && /^\d{4}$/.test(oikCode)
    ? (OIK_PREFIX_TO_OBLAST[oikCode.slice(0, 2)] ?? null)
    : null;

/** Пловдив-град files its catalogue row under the МИР code `PDV-00` while its page says
 *  `област Пловдив` (`PDV`) — the oblast-code shard mismatch this repo already knows about.
 *  Compare on the part before the dash so that pairing is not reported as a contradiction. */
const sameOblast = (catalogue: string, heading: string): boolean =>
  catalogue === heading || catalogue.split("-")[0] === heading;

export type OblastPick<T> = {
  pick: T | null;
  /** A multi-way name match that neither the heading nor the OIK could narrow — catalogue
   *  order decided, and the answer may be wrong. */
  ambiguous: boolean;
  /** The single match's oblast contradicts the one the page/OIK reports. NOT a tie, so
   *  `ambiguous` is false — but it is the 2011 Добрич shape: a confidently wrong resolution
   *  that no tiebreak signal can see, because there was no tie to break. */
  oblastMismatch: boolean;
};

/**
 * Pick the catalogue entry for a município name, using the oblast to disambiguate.
 *
 * `matches` is every catalogue row whose name equals the target. The oblast narrows it —
 * preferring the page's own heading, falling back to the oblast encoded in the OIK code.
 * With neither (or an unknown one) the FIRST match is returned, reproducing the previous
 * name-only behaviour exactly, so nothing that resolved before stops resolving.
 */
export const pickByOblast = <T extends { oblast: string }>(
  matches: readonly T[],
  oblastName: string | null | undefined,
  oikCode?: string | null,
): OblastPick<T> => {
  const code = oblastCodeForName(oblastName) ?? oblastCodeForOik(oikCode);
  if (matches.length === 0)
    return { pick: null, ambiguous: false, oblastMismatch: false };
  if (matches.length === 1)
    return {
      pick: matches[0],
      ambiguous: false,
      oblastMismatch: !!code && !sameOblast(matches[0].oblast, code),
    };
  const byOblast = code
    ? matches.find((m) => sameOblast(m.oblast, code))
    : null;
  return byOblast
    ? { pick: byOblast, ambiguous: false, oblastMismatch: false }
    : { pick: matches[0], ambiguous: true, oblastMismatch: false };
};
