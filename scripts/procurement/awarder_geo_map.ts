// Build EKATTE overrides for procurement awarders the OCDS feed never gave an
// address for — the ЦАИС ЕОП flat-feed gap-fill schools + legacy-only buyers.
// Without an address they have no `geo` and are dropped from by_settlement /
// the my-area place tiles. This writes a fill-missing override map that
// buildRollups consults (an address-derived geo always wins).
//
// Tiered resolution (see docs/plans/procurement-awarder-geo-v2.md):
//   B. МОН school register (data.egov.bg open data) → school/kindergarten EIK →
//      settlement + oblast → EKATTE. High confidence. Needs data.egov.bg
//      reachable (same egov POST API as update-indicators); skipped gracefully
//      when the host blocks us.
//   A. Name-suffix parse ("- гр.X" / "- с.X" in the awarder name) → EKATTE via
//      the shared resolver. Low confidence; fully local.
//
// Output: data/procurement/awarder_geo_overrides.json
//   { generatedAt, count, sources: {mon,name,unresolved}, awarders: { <eik>: {ekatte,source,confidence} } }
//
// Run: `npx tsx scripts/procurement/awarder_geo_map.ts`  (then rebuild rollups)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getResolver } from "./resolve_ekatte";
import { canonicalEik, isValidEik } from "./eik";
import { canonicalJson } from "./validate";
import { getResourceData } from "../budget/lib/egov_api";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const AWARDERS_DIR = path.join(PROCUREMENT_DIR, "awarders");
const OUT_FILE = path.join(PROCUREMENT_DIR, "awarder_geo_overrides.json");
// Tier D — buyer-EIK → modal oblast (NUTS3) from the tenders feed, built by
// build_tender_oblast_map.ts. Optional: present only after that crawl has run.
const OBLAST_MAP_FILE = path.join(
  PROCUREMENT_DIR,
  "derived",
  "buyer_oblast_map.json",
);
// Tier E — EIK → {locality, nuts} from the OCDS обявления party addresses, built
// by build_ocds_party_geo.ts. Optional.
const OCDS_PARTY_MAP_FILE = path.join(
  PROCUREMENT_DIR,
  "derived",
  "ocds_party_geo_map.json",
);

// МОН "Регистър на училищата, детските градини и обслужващите звена" — open data.
const MON_SCHOOL_RESOURCE = "cac4d569-529c-4209-b797-1cf5f69901f5";

// Province (oblast) name → NUTS3 code, the inverse of resolve_ekatte's
// NUTS_TO_PROVINCE — the resolver's `region` arg is a NUTS code.
const PROVINCE_TO_NUTS: Record<string, string> = {
  Видин: "BG311",
  Монтана: "BG312",
  Враца: "BG313",
  Плевен: "BG314",
  Ловеч: "BG315",
  "Велико Търново": "BG321",
  Габрово: "BG322",
  Русе: "BG323",
  Разград: "BG324",
  Силистра: "BG325",
  Варна: "BG331",
  Добрич: "BG332",
  Шумен: "BG333",
  Търговище: "BG334",
  Бургас: "BG341",
  Сливен: "BG342",
  Ямбол: "BG343",
  "Стара Загора": "BG344",
  "София (столица)": "BG411",
  София: "BG412",
  Благоевград: "BG413",
  Перник: "BG414",
  Кюстендил: "BG415",
  Пловдив: "BG421",
  Хасково: "BG422",
  Пазарджик: "BG423",
  Смолян: "BG424",
  Кърджали: "BG425",
};

const oblastToNuts = (raw: string): string | undefined => {
  const s = raw.replace(/^\s*обл(?:аст)?\.?\s*/i, "").trim();
  if (PROVINCE_TO_NUTS[s]) return PROVINCE_TO_NUTS[s];
  // "София-град" / "София град" → capital
  if (/^софия([\s-]*град)?$/i.test(s)) return "BG411";
  return undefined;
};

// Tier-A: a "- гр.X" / "- с.X" settlement suffix (NOT the "градина" substring —
// require a separator + the гр./с. token). Returns the captured settlement name.
const NAME_SUFFIX =
  /(?:[-,/]\s*|\s{2,})(?:гр|с)\.\s*([А-ЯЁ][а-яё]+(?:[ -][А-ЯЁ][а-яё]+)?)/;
const parseSettlement = (name: string): string | undefined =>
  name.match(NAME_SUFFIX)?.[1]?.trim();

interface AwarderFile {
  eik: string;
  name: string;
  address?: unknown;
}

interface MonRow {
  settlement: string;
  oblast: string;
}

// Fetch the МОН register and index it by 9-digit EIK. Defensive: detects
// columns from the header row, and returns an empty map (Tier B skipped) on any
// failure — incl. the data.egov.bg block that 403s non-pipeline IPs.
const fetchMonSchoolMap = async (): Promise<Map<string, MonRow>> => {
  const out = new Map<string, MonRow>();
  let rows: unknown[][];
  try {
    rows = await getResourceData(MON_SCHOOL_RESOURCE);
  } catch (e) {
    console.warn(
      `  Tier B skipped — МОН register fetch failed: ${(e as Error).message}`,
    );
    return out;
  }
  if (!rows.length) {
    console.warn("  Tier B skipped — МОН register returned no rows");
    return out;
  }
  const header = rows[0].map((c) => String(c ?? ""));
  const col = (re: RegExp): number => header.findIndex((h) => re.test(h));
  const eikCol = col(/еик|булстат|bulstat/i);
  const setlCol = col(
    /населено\s*м[яe]ст|^град$|^село$|settlement|нас\.?\s*място/i,
  );
  const oblCol = col(/област|oblast|region/i);
  if (eikCol < 0 || setlCol < 0) {
    console.warn(
      `  Tier B skipped — couldn't find EIK/settlement columns in МОН header: ${JSON.stringify(header).slice(0, 300)}`,
    );
    return out;
  }
  for (const r of rows.slice(1)) {
    const eik = canonicalEik(String(r[eikCol] ?? ""));
    if (!isValidEik(eik)) continue;
    out.set(eik, {
      settlement: String(r[setlCol] ?? "").trim(),
      oblast: oblCol >= 0 ? String(r[oblCol] ?? "").trim() : "",
    });
  }
  console.log(`  Tier B: МОН register indexed ${out.size} institution EIK(s)`);
  return out;
};

const main = async (): Promise<void> => {
  if (!fs.existsSync(AWARDERS_DIR)) {
    console.error(`no awarders dir at ${AWARDERS_DIR} — run the ingest first`);
    process.exit(1);
  }
  // Candidates: awarders the OCDS feed gave no address for.
  const candidates: AwarderFile[] = [];
  for (const f of fs.readdirSync(AWARDERS_DIR)) {
    if (!f.endsWith(".json")) continue;
    const a = JSON.parse(
      fs.readFileSync(path.join(AWARDERS_DIR, f), "utf8"),
    ) as AwarderFile;
    if (!a.address) candidates.push({ eik: a.eik, name: a.name });
  }
  console.log(
    `→ ${candidates.length} awarder(s) with no OCDS address (override candidates)`,
  );

  const resolver = getResolver();
  const monMap = await fetchMonSchoolMap();

  // Tier D — optional buyer→oblast map (disambiguates the Tier-A name parse).
  const oblastMap: Record<string, { nuts: string }> = fs.existsSync(
    OBLAST_MAP_FILE,
  )
    ? (JSON.parse(fs.readFileSync(OBLAST_MAP_FILE, "utf8")).awarders ?? {})
    : {};
  if (Object.keys(oblastMap).length)
    console.log(
      `  Tier D: ${Object.keys(oblastMap).length} buyer→oblast hint(s) loaded (tenders feed)`,
    );

  // Tier E — optional EIK → {locality, nuts} from OCDS party addresses.
  const ocdsMap: Record<string, { locality: string; nuts: string }> =
    fs.existsSync(OCDS_PARTY_MAP_FILE)
      ? (JSON.parse(fs.readFileSync(OCDS_PARTY_MAP_FILE, "utf8")).awarders ??
        {})
      : {};
  if (Object.keys(ocdsMap).length)
    console.log(
      `  Tier E: ${Object.keys(ocdsMap).length} EIK→locality address(es) loaded (OCDS parties)`,
    );

  const awarders: Record<
    string,
    { ekatte: string; source: string; confidence: string }
  > = {};
  const counts = { mon: 0, ocds: 0, name: 0, nameOblast: 0, unresolved: 0 };

  for (const a of candidates) {
    // Tier B — МОН register (higher confidence), then Tier A — name parse.
    const mon = monMap.get(a.eik);
    if (mon && mon.settlement) {
      const res = resolver.resolve({
        locality: mon.settlement,
        region: oblastToNuts(mon.oblast),
      });
      if (res.ekatte && res.confidence !== "unresolved") {
        awarders[a.eik] = {
          ekatte: res.ekatte,
          source: "mon",
          confidence: res.confidence,
        };
        counts.mon++;
        continue;
      }
    }
    // Tier E — OCDS party address (locality + NUTS). A real declared address, so
    // high quality; resolved to EKATTE via the shared resolver.
    const ocds = ocdsMap[a.eik];
    if (ocds && ocds.locality) {
      const res = resolver.resolve({
        locality: ocds.locality,
        region: ocds.nuts || undefined,
      });
      if (res.ekatte && res.confidence !== "unresolved") {
        awarders[a.eik] = {
          ekatte: res.ekatte,
          source: "ocds",
          confidence: res.confidence,
        };
        counts.ocds++;
        continue;
      }
    }
    const settlement = parseSettlement(a.name);
    if (settlement) {
      // Tier D disambiguation: feed the buyer's modal oblast (from the tenders
      // feed) as the resolver's `region` hint. For a settlement name that's
      // unique it's a no-op; for one that exists in several oblasti it picks the
      // EKATTE in the buyer's oblast and the resolver returns a higher
      // confidence. Re-resolve without the hint when the hint yields nothing
      // (e.g. a wrong/edge oblast) so the bare-name path still applies.
      const oblastNuts = oblastMap[a.eik]?.nuts;
      const hinted = oblastNuts
        ? resolver.resolve({ locality: settlement, region: oblastNuts })
        : undefined;
      const res =
        hinted && hinted.ekatte && hinted.confidence !== "unresolved"
          ? hinted
          : resolver.resolve({ locality: settlement });
      if (res.ekatte && res.confidence !== "unresolved") {
        const oblastConfirmed = !!(hinted && hinted.ekatte === res.ekatte);
        awarders[a.eik] = {
          ekatte: res.ekatte,
          source: oblastConfirmed ? "name+oblast" : "name",
          confidence: res.confidence,
        };
        if (oblastConfirmed) counts.nameOblast++;
        else counts.name++;
        continue;
      }
    }
    counts.unresolved++;
  }

  const resolved = counts.mon + counts.ocds + counts.name + counts.nameOblast;
  fs.writeFileSync(
    OUT_FILE,
    canonicalJson({
      generatedAt: new Date().toISOString(),
      count: resolved,
      sources: counts,
      awarders,
    }),
  );
  console.log(
    `✓ wrote ${OUT_FILE}\n` +
      `  resolved ${resolved}/${candidates.length} ` +
      `(МОН ${counts.mon}, OCDS ${counts.ocds}, name ${counts.name}, name+oblast ${counts.nameOblast}); ${counts.unresolved} unresolved`,
  );
  console.log(`→ now rebuild: npm run procurement:ingest (applies overrides)`);
};

main();
