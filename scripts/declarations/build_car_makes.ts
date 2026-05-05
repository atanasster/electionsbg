/**
 * Build the per-NS "Top car makes" rollup consumed by the dashboard
 * `MpConnectionsTile`. Reads the most-recent declaration of every MP and
 * counts distinct MPs declaring at least one passenger car of each make.
 * Spouse-held cars count toward the MP's set.
 *
 * Output: /public/parliament/car-makes.json
 *
 * Why distinct MPs and not vehicle count? — A senator declaring three
 * Volkswagens would dominate raw vehicle counts; the journalistic question
 * is "how many of our MPs drive a VW", which `mpCount` answers cleanly.
 */

import fs from "fs";
import path from "path";
import type {
  CarMakeEntry,
  CarMakesFile,
  CarMakesScope,
  MpCarRow,
  MpCarsFile,
  MpDeclaration,
} from "../../src/data/dataTypes";

type MpIndexEntry = {
  id: number;
  name: string;
  nsFolders: string[];
  currentPartyGroupShort: string | null;
};
type ParliamentIndex = { mps: MpIndexEntry[] };

/** Cars only — passenger vehicles and SUV/jeeps. We exclude motorcycles
 * (мотор / мотоциклет), trailers (ремарке) and utility vehicles so the
 * column compares like-for-like across MPs.
 *
 * Bulgarian uses Cyrillic letters, which JS `\b` does NOT recognise as
 * word boundaries (it operates on ASCII \w). We just substring-match on
 * the lowercased description — false positives are negligible. */
const isCarDescription = (description: string | null): boolean => {
  if (!description) return false;
  const s = description.toLowerCase();
  return (
    s.includes("лек автомобил") ||
    s.includes("джип") ||
    s.includes("suv") ||
    s.includes("кросоувър") ||
    s.includes("кросовър")
  );
};

/** Brand alias map. Keys are normalized (uppercase, no diacritics, no
 * punctuation) substrings; values are the canonical English-cased label
 * the dashboard renders. Order does not matter — we match the LONGEST
 * key against each `detail` string so "ЛЕНД РОУВЪР" wins over "РОУВЪР".
 *
 * Iterate this table by re-running the build and reading the
 * `unmatchedSamples` field of the output: anything still falling into
 * "Other" should either get an alias here or stay parked as long-tail. */
const BRAND_ALIASES: Record<string, string> = {
  // German
  ФОЛКСВАГЕН: "Volkswagen",
  ФОЛЦВАГЕН: "Volkswagen",
  "ФОЛЦ ВАГЕН": "Volkswagen",
  ФОКСВАГЕН: "Volkswagen",
  ФОЛСВАГЕН: "Volkswagen",
  ФОЛВАГЕН: "Volkswagen",
  VW: "Volkswagen",
  VOLKSWAGEN: "Volkswagen",
  БМВ: "BMW",
  BMW: "BMW",
  МЕРЦЕДЕС: "Mercedes-Benz",
  "МЕРЦЕДЕС-БЕНЦ": "Mercedes-Benz",
  МЕРСЕДЕС: "Mercedes-Benz",
  МЕРСЕЦЕС: "Mercedes-Benz",
  MERCEDES: "Mercedes-Benz",
  "MERCEDES-BENZ": "Mercedes-Benz",
  АУДИ: "Audi",
  AUDI: "Audi",
  ОПЕЛ: "Opel",
  OPEL: "Opel",
  ПОРШЕ: "Porsche",
  PORSCHE: "Porsche",
  СМАРТ: "Smart",
  SMART: "Smart",
  // French
  РЕНО: "Renault",
  RENAULT: "Renault",
  ПЕЖО: "Peugeot",
  PEUGEOT: "Peugeot",
  СИТРОЕН: "Citroën",
  CITROEN: "Citroën",
  ДС: "DS",
  // Italian
  ФИАТ: "Fiat",
  FIAT: "Fiat",
  "АЛФА РОМЕО": "Alfa Romeo",
  "АЛФА-РОМЕО": "Alfa Romeo",
  "ALFA ROMEO": "Alfa Romeo",
  ЛАНЧА: "Lancia",
  LANCIA: "Lancia",
  ФЕРАРИ: "Ferrari",
  FERRARI: "Ferrari",
  МАЗЕРАТИ: "Maserati",
  MASERATI: "Maserati",
  // Czech / Romanian
  ШКОДА: "Škoda",
  SKODA: "Škoda",
  ДАЧИЯ: "Dacia",
  ДАЧИА: "Dacia",
  DACIA: "Dacia",
  // Spanish
  СЕАТ: "SEAT",
  SEAT: "SEAT",
  // Japanese
  ТОЙОТА: "Toyota",
  TOYOTA: "Toyota",
  ХОНДА: "Honda",
  HONDA: "Honda",
  НИСАН: "Nissan",
  НЕСАН: "Nissan",
  NISSAN: "Nissan",
  МАЗДА: "Mazda",
  MAZDA: "Mazda",
  МИЦУБИШИ: "Mitsubishi",
  МИЦУБИЦИ: "Mitsubishi",
  МИТСУБИШИ: "Mitsubishi",
  МИТЦУБИШИ: "Mitsubishi",
  MITSUBISHI: "Mitsubishi",
  СУЗУКИ: "Suzuki",
  SUZUKI: "Suzuki",
  СУБАРУ: "Subaru",
  СУБАРО: "Subaru",
  SUBARU: "Subaru",
  ЛЕКСУС: "Lexus",
  LEXUS: "Lexus",
  ИНФИНИТИ: "Infiniti",
  INFINITI: "Infiniti",
  ДАЙХАЦУ: "Daihatsu",
  DAIHATSU: "Daihatsu",
  АКУРА: "Acura",
  ACURA: "Acura",
  // Korean
  КИА: "Kia",
  КИЯ: "Kia",
  KIA: "Kia",
  ХЮНДАЙ: "Hyundai",
  ХЮНДАЕ: "Hyundai",
  ХЮНДАИ: "Hyundai",
  HYUNDAI: "Hyundai",
  ДЕУ: "Daewoo",
  DAEWOO: "Daewoo",
  "СЕНГ ЯНГ": "SsangYong",
  "СЕНГ-ЯНГ": "SsangYong",
  SSANGYONG: "SsangYong",
  ГЕНЕЗИС: "Genesis",
  GENESIS: "Genesis",
  // American
  ФОРД: "Ford",
  FORD: "Ford",
  ШЕВРОЛЕТ: "Chevrolet",
  CHEVROLET: "Chevrolet",
  КАДИЛАК: "Cadillac",
  CADILLAC: "Cadillac",
  ШРАЙСЛЕР: "Chrysler",
  КРАЙСЛЕР: "Chrysler",
  CHRYSLER: "Chrysler",
  ДОДЖ: "Dodge",
  DODGE: "Dodge",
  ДЖИП: "Jeep",
  JEEP: "Jeep",
  ТЕСЛА: "Tesla",
  TESLA: "Tesla",
  ХЪМЪР: "Hummer",
  HUMMER: "Hummer",
  ЛИНКЪЛН: "Lincoln",
  LINCOLN: "Lincoln",
  БЮИК: "Buick",
  БУИК: "Buick",
  BUICK: "Buick",
  GMC: "GMC",
  // Chinese — increasingly common in declarations
  ХАВАЛ: "Haval",
  HAVAL: "Haval",
  "ГРЕЙТ ВОЛ": "Great Wall",
  "GREAT WALL": "Great Wall",
  ЧЕРИ: "Chery",
  CHERY: "Chery",
  ГИЛИ: "Geely",
  GEELY: "Geely",
  "БИИ ВАЙ ДИ": "BYD",
  BYD: "BYD",
  MG: "MG",
  // Other long-tail
  ТОФАШ: "Tofaş",
  GALLOPER: "Hyundai",
  ГАЛОПЕР: "Hyundai",
  // British
  "ЛЕНД РОУВЪР": "Land Rover",
  "ЛЕНД-РОУВЪР": "Land Rover",
  "ЛЕНД РОВЪР": "Land Rover",
  "ЛЕНД РОВЕР": "Land Rover",
  "ЛАНД РОУВЪР": "Land Rover",
  "ЛАНД РОВЪР": "Land Rover",
  "ЛАНД РОВЕР": "Land Rover",
  "LAND ROVER": "Land Rover",
  "РЕЙНДЖ РОУВЪР": "Range Rover",
  "РЕЙНДЖ РОВЕР": "Range Rover",
  "РЕНДЖ РОУВЪР": "Range Rover",
  "РЕНДЖ РОВЕР": "Range Rover",
  "RANGE ROVER": "Range Rover",
  РОУВЪР: "Rover",
  ROVER: "Rover",
  МИНИ: "MINI",
  MINI: "MINI",
  ЯГУАР: "Jaguar",
  JAGUAR: "Jaguar",
  БЕНТЛИ: "Bentley",
  BENTLEY: "Bentley",
  "АСТЪН МАРТИН": "Aston Martin",
  "АСТОН МАРТИН": "Aston Martin",
  "ASTON MARTIN": "Aston Martin",
  "РОЛС РОЙС": "Rolls-Royce",
  "РОЛС-РОЙС": "Rolls-Royce",
  "ROLLS-ROYCE": "Rolls-Royce",
  // Swedish
  ВОЛВО: "Volvo",
  ВОЛОВО: "Volvo",
  VOLVO: "Volvo",
  СААБ: "Saab",
  SAAB: "Saab",
  // Eastern Bloc legacy
  ЛАДА: "Lada",
  LADA: "Lada",
  ВАЗ: "Lada",
  МОСКВИЧ: "Moskvich",
  MOSKVICH: "Moskvich",
  ВОЛГА: "Volga",
  УАЗ: "UAZ",
  UAZ: "UAZ",
  ГАЗ: "GAZ",
  ТРАБАНТ: "Trabant",
  TRABANT: "Trabant",
  ВАРТБУРГ: "Wartburg",
  WARTBURG: "Wartburg",
  "ШКОДА ФАВОРИТ": "Škoda",
  ЗАСТАВА: "Zastava",
};

const normalizeDetail = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[„""»«'`.,;:!?\-—()/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ALIAS_KEYS = Object.keys(BRAND_ALIASES).sort(
  (a, b) => b.length - a.length,
);

const detectMake = (detail: string | null): string | null => {
  if (!detail) return null;
  const norm = normalizeDetail(detail);
  if (!norm) return null;
  // Whole-word match on the normalized detail. We bracket each candidate
  // with explicit word boundaries (space-or-edge) so a make like "DS" does
  // not match the middle of "MAZDA".
  const padded = ` ${norm} `;
  for (const key of ALIAS_KEYS) {
    if (padded.includes(` ${key} `)) return BRAND_ALIASES[key];
    // Also accept a make-prefix match when the make is followed directly
    // by punctuation that we already collapsed to a space, e.g. "BMW X3"
    // → padded includes " BMW " (handled above). The fallback below is for
    // makes with internal spaces ("LAND ROVER"), already captured by the
    // padded include since spaces normalize to single spaces.
  }
  return null;
};

/** Same selection logic as build_assets_rankings: most recent declaration
 * by year, with filedAt as tiebreaker for same-year entries. */
const pickLatest = (decls: MpDeclaration[]): MpDeclaration | null => {
  if (decls.length === 0) return null;
  return [...decls].sort((a, b) => {
    if (b.declarationYear !== a.declarationYear) {
      return b.declarationYear - a.declarationYear;
    }
    return (b.filedAt ?? "").localeCompare(a.filedAt ?? "");
  })[0];
};

type MpMakes = {
  mpId: number;
  nsFolders: string[];
  /** make → vehicle count for this MP. */
  makes: Map<string, number>;
  /** Number of vehicle rows that fell through to "Other". */
  unmatchedRows: number;
  /** First few unmatched details (raw text) for the build log + JSON. */
  unmatchedSamples: string[];
};

type CarRowAccum = MpCarRow;

export type BuildCarMakesArgs = {
  publicFolder: string;
  stringify: (o: object) => string;
};

export const buildCarMakes = ({
  publicFolder,
  stringify,
}: BuildCarMakesArgs): void => {
  const declDir = path.join(publicFolder, "parliament", "declarations");
  const indexPath = path.join(publicFolder, "parliament", "index.json");
  if (!fs.existsSync(declDir) || !fs.existsSync(indexPath)) {
    console.warn(`[car-makes] declarations or index missing — skipping`);
    return;
  }
  const idx: ParliamentIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  const mpById = new Map<number, MpIndexEntry>();
  for (const mp of idx.mps) mpById.set(mp.id, mp);

  const perMp: MpMakes[] = [];
  const carRows: CarRowAccum[] = [];

  /** A normalized identity used for deduping rows that describe the same
   * physical vehicle. Bulgarian inheritance cases routinely produce 2+
   * declaration rows for one car (e.g. 1/6 share inherited + 5/6 share
   * acquired through partition); we want one row per car on the screen. */
  const normalizeDetailForKey = (detail: string | null): string => {
    if (!detail) return "";
    return detail
      .toLowerCase()
      .replace(/[„""»«'`.,;:!?\-—()/\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  for (const file of fs.readdirSync(declDir)) {
    if (!file.endsWith(".json")) continue;
    const mpIdNum = Number(file.replace(/\.json$/, ""));
    if (!Number.isFinite(mpIdNum)) continue;
    const mp = mpById.get(mpIdNum);
    if (!mp) continue;
    const decls: MpDeclaration[] = JSON.parse(
      fs.readFileSync(path.join(declDir, file), "utf-8"),
    );
    const latest = pickLatest(decls);
    if (!latest) continue;
    const assets = latest.assets ?? [];

    // First pass per MP: dedupe rows that describe the same physical car
    // (same normalized detail, acquired year, holder bucket). Merge the
    // share strings and sum any non-null BGN values.
    type Bucket = {
      first: CarRowAccum;
      shares: string[];
      valueBgnSum: number | null;
      mergedCount: number;
    };
    const buckets = new Map<string, Bucket>();

    for (const a of assets) {
      if (a.category !== "vehicle") continue;
      if (!isCarDescription(a.description)) continue;
      const key = [
        normalizeDetailForKey(a.detail),
        a.acquiredYear ?? "",
        a.isSpouse ? "s" : "d",
      ].join("|");
      const make = detectMake(a.detail);
      const existing = buckets.get(key);
      if (existing) {
        existing.mergedCount++;
        if (a.share) existing.shares.push(a.share);
        if (a.valueBgn != null) {
          existing.valueBgnSum = (existing.valueBgnSum ?? 0) + a.valueBgn;
        }
      } else {
        buckets.set(key, {
          first: {
            mpId: mp.id,
            mpName: mp.name,
            partyGroupShort: mp.currentPartyGroupShort,
            nsFolders: mp.nsFolders,
            make,
            detail: a.detail,
            description: a.description,
            acquiredYear: a.acquiredYear,
            valueBgn: a.valueBgn,
            amount: a.amount,
            currency: a.currency,
            isSpouse: a.isSpouse,
            share: a.share ?? null,
            mergedFromCount: 1,
            declarationYear: latest.declarationYear,
            sourceUrl: latest.sourceUrl,
          },
          shares: a.share ? [a.share] : [],
          valueBgnSum: a.valueBgn,
          mergedCount: 1,
        });
      }
    }

    const makes = new Map<string, number>();
    let unmatchedRows = 0;
    const unmatchedSamples: string[] = [];
    for (const bucket of buckets.values()) {
      const row: CarRowAccum = {
        ...bucket.first,
        valueBgn: bucket.valueBgnSum,
        share: bucket.shares.length > 0 ? bucket.shares.join(" + ") : null,
        mergedFromCount: bucket.mergedCount,
      };
      carRows.push(row);
      if (row.make) {
        makes.set(row.make, (makes.get(row.make) ?? 0) + 1);
      } else {
        unmatchedRows++;
        if (unmatchedSamples.length < 3 && row.detail) {
          unmatchedSamples.push(row.detail);
        }
      }
    }

    if (makes.size === 0 && unmatchedRows === 0) continue;
    perMp.push({
      mpId: mp.id,
      nsFolders: mp.nsFolders,
      makes,
      unmatchedRows,
      unmatchedSamples,
    });
  }

  // Sort by valueBgn DESC, nulls last. Tie-break by year (newer first) so
  // identical-value pairs stay deterministic.
  carRows.sort((a, b) => {
    const av = a.valueBgn ?? -Infinity;
    const bv = b.valueBgn ?? -Infinity;
    if (av !== bv) return bv - av;
    const ay = a.acquiredYear ?? -Infinity;
    const by = b.acquiredYear ?? -Infinity;
    if (ay !== by) return by - ay;
    return a.mpName.localeCompare(b.mpName, "bg");
  });

  const mpCarsOut: MpCarsFile = {
    generatedAt: new Date().toISOString(),
    cars: carRows,
  };
  fs.writeFileSync(
    path.join(publicFolder, "parliament", "mp-cars.json"),
    stringify(mpCarsOut),
    "utf-8",
  );

  const computeScope = (mps: MpMakes[]): CarMakesScope => {
    const mpsByMake = new Map<string, Set<number>>();
    const vehiclesByMake = new Map<string, number>();
    let unmatchedMpCount = 0;
    const unmatchedSampleSet = new Set<string>();
    for (const m of mps) {
      if (m.unmatchedRows > 0) {
        unmatchedMpCount++;
        for (const s of m.unmatchedSamples) unmatchedSampleSet.add(s);
      }
      for (const [make, count] of m.makes.entries()) {
        let set = mpsByMake.get(make);
        if (!set) {
          set = new Set();
          mpsByMake.set(make, set);
        }
        set.add(m.mpId);
        vehiclesByMake.set(make, (vehiclesByMake.get(make) ?? 0) + count);
      }
    }
    const topMakes: CarMakeEntry[] = [];
    for (const [make, mpSet] of mpsByMake) {
      const sampleMpIds = Array.from(mpSet).slice(0, 6);
      topMakes.push({
        make,
        mpCount: mpSet.size,
        vehicleCount: vehiclesByMake.get(make) ?? 0,
        sampleMpIds,
      });
    }
    topMakes.sort(
      (a, b) =>
        b.mpCount - a.mpCount ||
        b.vehicleCount - a.vehicleCount ||
        a.make.localeCompare(b.make, "bg"),
    );
    return {
      topMakes,
      unmatchedSamples: Array.from(unmatchedSampleSet).slice(0, 20),
      unmatchedMpCount,
    };
  };

  const all = computeScope(perMp);

  const allNsFolders = new Set<string>();
  for (const m of perMp) for (const ns of m.nsFolders) allNsFolders.add(ns);
  const byNs: Record<string, CarMakesScope> = {};
  for (const ns of allNsFolders) {
    byNs[ns] = computeScope(perMp.filter((m) => m.nsFolders.includes(ns)));
  }

  const out: CarMakesFile = {
    generatedAt: new Date().toISOString(),
    all,
    byNs,
  };

  fs.writeFileSync(
    path.join(publicFolder, "parliament", "car-makes.json"),
    stringify(out),
    "utf-8",
  );

  const totalUnmatched = all.unmatchedMpCount;
  console.log(
    `[car-makes] ${perMp.length} MPs scanned, ${all.topMakes.length} distinct makes, ` +
      `${carRows.length} car row(s), ` +
      `${totalUnmatched} MP(s) had unrecognised make tokens (samples: ${all.unmatchedSamples
        .slice(0, 3)
        .join(" | ")})`,
  );
};
