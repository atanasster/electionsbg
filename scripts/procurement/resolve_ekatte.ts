// Resolve an OCDS `buyer.address` block to an EKATTE settlement code.
//
// Why this exists: АОП OCDS releases never populate the geographic fields
// on items/lots/tender (deliveryAddress, placeOfPerformance). We sampled
// 21,186 releases across 9 fortnight bundles — 0% fill. The only signal is
// `parties[].address` on the buyer, which IS reliably populated (~100%
// locality + postalCode + region). So buyer HQ becomes the location proxy.
//
// Resolution strategy, in order of confidence:
//   1. postal+name+province  → unambiguous (handles the 308 multi-village
//                              postal codes correctly)
//   2. postal alone          → unique for 92% of BG postal codes
//   3. name+province         → fallback when postal is missing/wrong; the
//                              official NUTS3 maps 1:1 to oblast names
//   4. name alone            → last resort
//
// Limitation that callers must handle separately: buyer HQ ≠ place of
// performance. A ministry in Sofia procuring road works in Vidin will pin
// to Sofia. That's why this module returns a `confidence` band — the
// downstream by_settlement aggregator decides which awarder tiers to
// include in settlement-level rollups (municipalities / schools / hospitals
// = trustworthy; ministries / central agencies = national-procurement
// rollup, not pinned to Sofia).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EKATTE_INDEX_FILE = path.resolve(
  __dirname,
  "../../data/ekatte_index.json",
);

export interface EkatteEntry {
  ekatte: string;
  name: string;
  postal: string | null;
  province: string;
  obshtina: string;
  obshtina_code: string;
  is_village: boolean;
  loc: string | null;
}

export interface OcdsAddress {
  locality?: string;
  region?: string;
  postalCode?: string;
  streetAddress?: string;
  countryName?: string;
}

export type ResolveConfidence =
  | "postal+name+province"
  | "postal+name"
  | "postal_only"
  | "name+province"
  | "name_only"
  | "unresolved";

export interface ResolveResult {
  ekatte: string | null;
  confidence: ResolveConfidence;
  matched?: EkatteEntry;
}

// Bulgaria's 28 official NUTS3 codes → oblast (province) name as published
// in raw_data/settlements_loc.csv.
const NUTS_TO_PROVINCE: Record<string, string> = {
  BG311: "Видин",
  BG312: "Монтана",
  BG313: "Враца",
  BG314: "Плевен",
  BG315: "Ловеч",
  BG321: "Велико Търново",
  BG322: "Габрово",
  BG323: "Русе",
  BG324: "Разград",
  BG325: "Силистра",
  BG331: "Варна",
  BG332: "Добрич",
  BG333: "Шумен",
  BG334: "Търговище",
  BG341: "Бургас",
  BG342: "Сливен",
  BG343: "Ямбол",
  BG344: "Стара Загора",
  BG411: "София (столица)",
  BG412: "София",
  BG413: "Благоевград",
  BG414: "Перник",
  BG415: "Кюстендил",
  BG421: "Пловдив",
  BG422: "Хасково",
  BG423: "Пазарджик",
  BG424: "Смолян",
  BG425: "Кърджали",
};

// Strip "гр./с./град/село/общ./обл." prefixes, punctuation, collapse
// whitespace, lowercase. Also handles the long-form locality strings
// АОП sometimes emits ("с. Гложене, община Козлодуй, област Враца") by
// keeping only the first segment.
const normName = (raw: string | undefined): string => {
  if (!raw) return "";
  const firstSeg = raw.split(",")[0];
  return firstSeg
    .toLowerCase()
    .replace(/^\s*(град|село|гр\.|с\.|кв\.|общ\.|обл\.)\s*\.?\s*/i, "")
    .replace(/^\s*(гр|с)\.\s*/i, "")
    .replace(/\(\s*\d{4,5}\s*\)/g, "")
    .replace(/[.,\\"'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

export class EkatteResolver {
  private byPostal = new Map<string, EkatteEntry[]>();
  private byNameOnly = new Map<string, EkatteEntry[]>();
  private byNameProv = new Map<string, EkatteEntry[]>();
  public readonly entries: EkatteEntry[];

  constructor(entries: EkatteEntry[]) {
    this.entries = entries;
    for (const e of entries) {
      if (e.postal) this.bucket(this.byPostal, e.postal, e);
      const n = normName(e.name);
      this.bucket(this.byNameOnly, n, e);
      this.bucket(this.byNameProv, n + "|" + e.province, e);
    }
  }

  private bucket(
    m: Map<string, EkatteEntry[]>,
    key: string,
    e: EkatteEntry,
  ): void {
    const arr = m.get(key);
    if (arr) arr.push(e);
    else m.set(key, [e]);
  }

  resolve(addr: OcdsAddress | null | undefined): ResolveResult {
    if (!addr) return { ekatte: null, confidence: "unresolved" };
    const locN = normName(addr.locality);
    const province = addr.region
      ? (NUTS_TO_PROVINCE[addr.region] ?? null)
      : null;
    const postal = addr.postalCode?.trim();

    if (postal) {
      const hits = this.byPostal.get(postal);
      if (hits && hits.length === 1) {
        return {
          ekatte: hits[0].ekatte,
          confidence: "postal_only",
          matched: hits[0],
        };
      }
      if (hits && hits.length > 1 && locN) {
        const matchN = hits.filter((h) => normName(h.name) === locN);
        if (matchN.length === 1) {
          return {
            ekatte: matchN[0].ekatte,
            confidence: "postal+name",
            matched: matchN[0],
          };
        }
        if (matchN.length > 1 && province) {
          const m2 = matchN.filter((h) => h.province === province);
          if (m2.length === 1) {
            return {
              ekatte: m2[0].ekatte,
              confidence: "postal+name+province",
              matched: m2[0],
            };
          }
        }
      }
    }

    if (locN && province) {
      const hits = this.byNameProv.get(locN + "|" + province);
      if (hits && hits.length === 1) {
        return {
          ekatte: hits[0].ekatte,
          confidence: "name+province",
          matched: hits[0],
        };
      }
    }

    if (locN) {
      const hits = this.byNameOnly.get(locN);
      if (hits && hits.length === 1) {
        return {
          ekatte: hits[0].ekatte,
          confidence: "name_only",
          matched: hits[0],
        };
      }
    }

    return { ekatte: null, confidence: "unresolved" };
  }
}

let cached: EkatteResolver | null = null;

export const getResolver = (): EkatteResolver => {
  if (!cached) {
    const data = JSON.parse(
      fs.readFileSync(EKATTE_INDEX_FILE, "utf8"),
    ) as EkatteEntry[];
    cached = new EkatteResolver(data);
  }
  return cached;
};

// Oblast (province) name → NUTS3 code — the inverse of NUTS_TO_PROVINCE. The
// 28 BG NUTS3 codes map 1:1 to oblast names, so this round-trips losslessly.
const PROVINCE_TO_NUTS: Record<string, string> = Object.fromEntries(
  Object.entries(NUTS_TO_PROVINCE).map(([nuts, prov]) => [prov, nuts]),
);

let ekatteNutsCache: Map<string, string> | null = null;

// EKATTE settlement code → its oblast NUTS3 code (e.g. "10447" → "BG321"),
// resolved through the EKATTE index's `province` name. Returns null for an
// unknown code or a province with no NUTS3 mapping. Used as the geo fallback for
// a local awarder's oblast when the tenders feed carries no modal oblast for it.
export const ekatteToNuts3 = (ekatte: string): string | null => {
  if (!ekatteNutsCache) {
    ekatteNutsCache = new Map();
    for (const e of getResolver().entries) {
      const nuts = PROVINCE_TO_NUTS[e.province];
      if (nuts) ekatteNutsCache.set(e.ekatte, nuts);
    }
  }
  return ekatteNutsCache.get(ekatte) ?? null;
};
