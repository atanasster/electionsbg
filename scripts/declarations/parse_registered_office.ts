/**
 * Resolve a raw `registeredOffice` string (as it appears in cacbg.bg property
 * declarations, table 10 / 11, cell 5) to one or more EKATTE codes.
 *
 * The source field is unstructured free text in two common shapes:
 *   1) Long form:  "БЪЛГАРИЯ, гр. София, 1618"
 *                  "БЪЛГАРИЯ, с. Лозен, 1151"
 *                  "БЪЛГАРИЯ, гр. Варна, 9000, ул. Цар Симеон 23"
 *   2) Bare name:  "София" / "СОФИЯ" / "Софиа" / "Сифия" / "София (столица)"
 *                  "Варна" / "Пловдив" / "с. Неофит Рилски"
 *
 * Strategy: strip the БЪЛГАРИЯ prefix, capture the 4-digit postcode if any,
 * detect the гр./с. type token, look the name up in data/settlements.json.
 * Use the postcode→EKATTE table only as a tie-breaker on village name
 * collisions (Лозен exists 5×, Лясково 6×, …) — for cities, name alone is
 * enough (the only Bulgarian city-name collision is "Бяла").
 *
 * Sofia city: any of the synonyms (`София`, `СОФИЯ`, `Софиа`, `Сифия`,
 * `София (столица)`, `БЪЛГАРИЯ, гр. София, NNNN`) collapses to the synthetic
 * EKATTE 68134 — see scripts/lib/oblast_names.ts. We do NOT split into the
 * 24 rayons because (a) 66% of Sofia source records have no postcode, and
 * (b) no public dataset cleanly maps Sofia postcodes to rayons.
 */

import { SOFIA_EKATTE } from "../lib/oblast_names";

export type Settlement = {
  ekatte: string;
  name: string;
  oblast: string;
  t_v_m?: string;
};

export type PostcodeIndex = Record<
  string,
  { ekatte: string[]; names: string[] }
>;

export type OfficeMatchQuality =
  | "high" //  unambiguous city or postcode-pinned village
  | "medium" //  bare city/settlement name, single match, no postcode
  | "low" //  ambiguous candidates, picked first by heuristic
  | "foreign" //  string clearly references a non-BG location
  | "unresolved"; //  no match (garbage / typo / not in NSI table)

export type OfficeMatch = {
  ekatte: string | null;
  quality: OfficeMatchQuality;
  reason: string;
  /** All candidates that survived filtering, when more than one. Kept so a
   * downstream caller can decide to fan-out (e.g. emit two settlement-page
   * shards for a Лозен-on-postcode-1151 ambiguity). For our current use we
   * pick the first by population/oblast-center proximity. */
  alternates?: string[];
};

/** Recognised foreign string starters. Conservative; we only filter strings
 * we've actually seen in the wild data — random unmatched strings still go
 * through the resolver so we don't silently miss new BG settlements. */
const FOREIGN_PATTERNS: RegExp[] = [
  /^amsterdam$/i,
  /^great\s*britain$/i,
  /^истанбул$/i,
  /^кавала/i,
  /^сащ$/i, // САЩ — USA
  /^чужбина$/i,
  /^укра[ий]на$/i,
  /^дортмунд/i,
  /^с\.твърдица-молдова$/i,
];

/** Oblast code used in settlements.json for "this is a foreign country", not
 * a Bulgarian settlement (e.g. ekatte=US name="САЩ"). We must never resolve a
 * registered-office to one of these — they'd surface as a settlement page
 * with no UI. Filtered out in `buildSettlementIndex`. */
const FOREIGN_OBLAST = "32";

const SOFIA_SYNONYMS = /^(софия|софиа|сифия|со?фия\s*\(\s*столица\s*\))$/i;

/** Build name-keyed indexes once and pass to resolveOffice() for each call. */
export const buildSettlementIndex = (settlements: Settlement[]) => {
  const byCityName = new Map<string, Settlement[]>();
  const byVillageName = new Map<string, Settlement[]>();
  const byAnyName = new Map<string, Settlement[]>();
  const byEkatte = new Map<string, Settlement>();
  for (const s of settlements) {
    // Skip foreign-country pseudo-rows (oblast="32", ekatte=ISO code).
    if (s.oblast === FOREIGN_OBLAST) continue;
    const k = s.name.toLowerCase().replace(/\s+/g, " ").trim();
    const bucket = (m: Map<string, Settlement[]>, key: string) => {
      const v = m.get(key);
      if (v) v.push(s);
      else m.set(key, [s]);
    };
    bucket(byAnyName, k);
    if (s.t_v_m === "гр.") bucket(byCityName, k);
    else if (s.t_v_m === "с.") bucket(byVillageName, k);
    byEkatte.set(s.ekatte, s);
  }
  return { byCityName, byVillageName, byAnyName, byEkatte };
};
export type SettlementIndex = ReturnType<typeof buildSettlementIndex>;

type Normalized = {
  name: string;
  type: "city" | "village" | null;
  postcode: string | null;
};

const normalizeOfficeText = (raw: string): Normalized => {
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(/^БЪЛГАРИЯ\s*,\s*/i, "").trim();
  const pcMatch = s.match(/\b(\d{4})\b/);
  const postcode = pcMatch ? pcMatch[1] : null;
  if (pcMatch) s = s.slice(0, pcMatch.index).replace(/,\s*$/, "").trim();
  // strip explicit street tokens
  s = s.split(/,\s*ул\.|,\s*бул\.|,\s*ж\.к\./i)[0].trim();
  s = s
    .replace(/,\s*(общ|обл)\..*$/i, "")
    .replace(/,\s*$/, "")
    .trim();
  let type: Normalized["type"] = null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^гр\.\s*(.+)$/i))) {
    type = "city";
    s = m[1].trim();
  } else if ((m = s.match(/^с\.\s*(.+)$/i))) {
    type = "village";
    s = m[1].trim();
  } else if ((m = s.match(/^гр\.(.+)$/i))) {
    type = "city";
    s = m[1].trim();
  }
  s = s.replace(/\s*\(.+\)$/, "").trim(); // strip "(столица)" / "(quarter)"
  // Strip trailing punctuation-only fragments left after a stray comma in the
  // source (e.g. "БЪЛГАРИЯ, гр. София, ." → "София .").
  s = s.replace(/[,.\-\s]+$/, "").trim();
  return { name: s, type, postcode };
};

export const resolveOffice = (
  raw: string,
  settlementIndex: SettlementIndex,
  postcodeIndex: PostcodeIndex,
): OfficeMatch => {
  if (!raw || !raw.trim()) {
    return { ekatte: null, quality: "unresolved", reason: "empty" };
  }
  const trimmed = raw.trim();
  if (FOREIGN_PATTERNS.some((p) => p.test(trimmed))) {
    return { ekatte: null, quality: "foreign", reason: "foreign location" };
  }
  const n = normalizeOfficeText(raw);
  const lower = n.name.toLowerCase();

  if (SOFIA_SYNONYMS.test(lower) || (n.type === "city" && lower === "софия")) {
    return { ekatte: SOFIA_EKATTE, quality: "high", reason: "sofia capital" };
  }

  // Postcode tiebreaker — short-circuit if the postcode resolves uniquely.
  const pc = n.postcode ? postcodeIndex[n.postcode] : null;
  if (pc && pc.ekatte.length === 1 && pc.names.length === 1) {
    // sanity-check the name agrees, otherwise fall through to name-based
    if (
      pc.names[0].toLowerCase().replace(/\s+/g, " ") === lower ||
      lower === ""
    ) {
      return {
        ekatte: pc.ekatte[0],
        quality: "high",
        reason: `postcode ${n.postcode}`,
      };
    }
  }

  // Pick the candidate pool by type.
  const pool =
    n.type === "village"
      ? settlementIndex.byVillageName
      : n.type === "city"
        ? settlementIndex.byCityName
        : settlementIndex.byAnyName;
  let candidates = pool.get(lower) ?? [];
  if (candidates.length === 0 && pool !== settlementIndex.byAnyName) {
    candidates = settlementIndex.byAnyName.get(lower) ?? [];
  }

  if (candidates.length === 1) {
    return {
      ekatte: candidates[0].ekatte,
      quality: n.postcode ? "high" : "medium",
      reason: n.postcode
        ? `name + postcode ${n.postcode}`
        : "single name match",
    };
  }
  if (candidates.length > 1) {
    // Try postcode disambiguation first
    if (pc && pc.ekatte.length >= 1) {
      const hit = candidates.find((c) => pc.ekatte.includes(c.ekatte));
      if (hit) {
        return {
          ekatte: hit.ekatte,
          quality: "high",
          reason: `name + postcode ${n.postcode}`,
        };
      }
    }
    // Prefer city subset
    const cities = candidates.filter((c) => c.t_v_m === "гр.");
    if (cities.length === 1) {
      return {
        ekatte: cities[0].ekatte,
        quality: "medium",
        reason: "single-city among ambiguous matches",
      };
    }
    return {
      ekatte: candidates[0].ekatte,
      quality: "low",
      reason: `${candidates.length} candidates, picked first`,
      alternates: candidates.slice(1).map((c) => c.ekatte),
    };
  }

  return { ekatte: null, quality: "unresolved", reason: "no name match" };
};
