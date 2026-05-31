// Ingest a LEGACY per-kmetstvo chmi cycle (umbrellas chmi2012-2015,
// chmi2016-2018, chmi2019-2023).
//
// These older partials publish one numbered page per race (tur1/<N>.html,
// optional tur2/<N>.html) rather than one OIK-município page. We enumerate the
// numbered pages sequentially (robust to the per-umbrella dropdown differences:
// id'd obl-select in 2019-2023, legacy location-select earlier), parse each via
// parseLegacyChmiPage, resolve the obshtina (heading "община X" + oblast, else
// the 9-digit section code's OIK), then assemble one LocalMunicipalityBundle
// per obshtina with the kmetstvo / mayor / район results so buildChmiHistory
// surfaces them on /local/chmi and the affected settlement pages.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { cikFetchText } from "./cik_fetch";
import { cycleSlugToRawFolder, ingestCycle } from "./ingest_cycle";
import { parseLegacyChmiPage, LegacyChmiResult } from "./parse_legacy_chmi";
import { pickElectedMayor } from "./build_municipality_json";
import { buildChmiHistory } from "./build_chmi_history";
import municipalitiesData from "../../data/municipalities.json";
import {
  LocalMunicipalityBundle,
  LocalMayorResult,
  LocalKmetstvoResult,
  LocalDistrictMayorResult,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_ROOT = path.resolve(__dirname, "../../raw_data");
const DATA_ROOT = path.resolve(__dirname, "../../data");
const ROOT = "https://results.cik.bg";

type MunicipalityRef = {
  ekatte: string;
  name: string;
  obshtina: string;
  oblast: string;
};
const MUNICIPALITIES = municipalitiesData as MunicipalityRef[];

const normName = (s: string): string =>
  s
    .toLocaleLowerCase("bg")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Curated município-name aliases (CIK labels that differ from the catalogue).
const NAME_ALIASES: Record<string, string> = {
  столична: "SOF",
  софия: "SOF",
  добричка: "DOB15",
  "добрич-град": "DOB28",
  бобовдол: "KNL04",
};

type Resolution = {
  obshtinaCode: string;
  obshtinaName: string;
  oblastName: string;
};

// OIK (4-digit) → obshtinaCode, built from the latest regular cycle's bundles
// (every município carries oikCode + obshtinaCode). Cached across calls.
const buildOikMap = (): Map<
  string,
  { obshtinaCode: string; obshtinaName: string; oblastName: string }
> => {
  const map = new Map<
    string,
    { obshtinaCode: string; obshtinaName: string; oblastName: string }
  >();
  for (const cycle of ["2023_10_29_mi", "2019_10_27_mi", "2015_10_25_mi"]) {
    const dir = path.join(DATA_ROOT, cycle, "municipalities");
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const b = JSON.parse(
        fs.readFileSync(path.join(dir, f), "utf-8"),
      ) as LocalMunicipalityBundle;
      if (b.oikCode && !map.has(b.oikCode)) {
        map.set(b.oikCode, {
          obshtinaCode: b.obshtinaCode,
          obshtinaName: b.obshtinaName,
          oblastName: b.oblastName,
        });
      }
    }
  }
  return map;
};
let oikMapCache: ReturnType<typeof buildOikMap> | null = null;

// municipalities.json stores oblast as a CODE (e.g. "RSE") but the legacy
// heading gives the oblast NAME (e.g. "Русе"). The 28 oblasts are stable, so
// map the normalised name → code directly — needed to disambiguate the 3
// non-unique município names (Бяла → VAR05/RSE04, Искър, Средец).
const OBLAST_NAME_TO_CODE: Record<string, string> = {
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
  софия: "SFO", // Sofia province (city is routed via NAME_ALIASES → SOF)
  "софия област": "SFO",
  "стара загора": "SZR",
  търговище: "TGV",
  хасково: "HKV",
  шумен: "SHU",
  ямбол: "JAM",
};

const resolveByOblastName = (
  obshtinaName: string,
  oblastName: string | null,
): Resolution | null => {
  const target = normName(obshtinaName);
  const alias = NAME_ALIASES[target];
  if (alias) {
    const m = MUNICIPALITIES.find((x) => x.obshtina === alias);
    return {
      obshtinaCode: alias,
      obshtinaName,
      oblastName: m?.oblast ?? oblastName ?? "",
    };
  }
  // Resolve the heading oblast NAME to its CODE before matching.
  const oblastCode = oblastName
    ? OBLAST_NAME_TO_CODE[normName(oblastName)]
    : null;
  // Prefer a name+oblast match (disambiguates same-named municipalities),
  // fall back to name-only.
  const matches = MUNICIPALITIES.filter((m) => normName(m.name) === target);
  const pick =
    (oblastCode && matches.find((m) => m.oblast === oblastCode)) || matches[0];
  if (!pick) return null;
  return {
    obshtinaCode: pick.obshtina,
    obshtinaName: pick.name,
    oblastName: pick.oblast,
  };
};

const resolveObshtina = (r: LegacyChmiResult): Resolution | null => {
  if (r.obshtinaName) {
    const byName = resolveByOblastName(r.obshtinaName, r.oblastName);
    if (byName) return byName;
  }
  if (r.oikFromSection) {
    if (!oikMapCache) oikMapCache = buildOikMap();
    const hit = oikMapCache.get(r.oikFromSection);
    if (hit) return hit;
  }
  return null;
};

// Enumerate numbered pages for one round by probing 1.html, 2.html, … and
// stopping after `gapTolerance` consecutive 404s.
const mirrorRound = async (opts: {
  cycleSlug: string;
  inner: string;
  round: 1 | 2;
  rawDir: string;
  gapTolerance?: number;
  maxPages?: number;
  delayMs?: number;
}): Promise<number[]> => {
  const {
    cycleSlug,
    inner,
    round,
    rawDir,
    gapTolerance = 3,
    maxPages = 400,
    delayMs = 150,
  } = opts;
  fs.mkdirSync(rawDir, { recursive: true });
  const present: number[] = [];
  let consecutiveMisses = 0;
  for (let n = 1; n <= maxPages; n++) {
    const file = path.join(rawDir, `${n}.html`);
    if (fs.existsSync(file)) {
      present.push(n);
      consecutiveMisses = 0;
      continue;
    }
    const url = `${ROOT}/${cycleSlug}/tur${round}/${inner}${n}.html`;
    const html = await cikFetchText(url, { allow404: true });
    if (html) {
      fs.writeFileSync(file, html, "utf-8");
      present.push(n);
      consecutiveMisses = 0;
    } else {
      consecutiveMisses++;
      if (consecutiveMisses >= gapTolerance && present.length > 0) break;
      if (consecutiveMisses >= gapTolerance) break;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return present;
};

const placeKey = (r: { raceType: string; placeName: string }): string =>
  `${r.raceType}::${normName(r.placeName)}`;

export const ingestLegacyChmiCycle = async (opts: {
  cycleSlug: string;
  publicFolder: string;
  stringify: (o: object) => string;
  canonical?: CanonicalPartiesIndex;
}): Promise<{ cycleSlug: string; bundles: number; pages: number }> => {
  const { cycleSlug, publicFolder, stringify } = opts;
  const canonical =
    opts.canonical ??
    (() => {
      const f = path.join(publicFolder, "canonical_parties.json");
      return fs.existsSync(f)
        ? (JSON.parse(fs.readFileSync(f, "utf-8")) as CanonicalPartiesIndex)
        : undefined;
    })();

  const folder = cycleSlugToRawFolder(cycleSlug);
  const rawFolder = path.join(RAW_ROOT, folder);
  // Legacy pages live directly under tur{1,2}/<N>.html (no rezultati/ subdir).
  const inner = "";

  console.log(`[legacy_chmi] ${cycleSlug} → ${folder} :: mirroring pages`);
  const t1 = await mirrorRound({
    cycleSlug,
    inner,
    round: 1,
    rawDir: path.join(rawFolder, "html", "tur1"),
  });
  // Within an umbrella, later dates migrated to the modern OIK-município
  // structure (tur1/rezultati/NNNN.html). When no numbered pages exist, this
  // is one of those — hand it to the modern ingest path.
  if (t1.length === 0) {
    console.log(
      `[legacy_chmi] ${cycleSlug} :: no numbered pages — modern-structured, delegating to ingestCycle`,
    );
    const res = await ingestCycle({ cycleSlug, publicFolder, stringify });
    return {
      cycleSlug,
      bundles: res.tur1Mirrored,
      pages: res.oikCount,
    };
  }
  const t2 = await mirrorRound({
    cycleSlug,
    inner,
    round: 2,
    rawDir: path.join(rawFolder, "html", "tur2"),
  });
  console.log(
    `[legacy_chmi] ${cycleSlug} :: tur1=${t1.length}, tur2=${t2.length}`,
  );

  const readPage = (round: 1 | 2, n: number): LegacyChmiResult | null => {
    const file = path.join(rawFolder, "html", `tur${round}`, `${n}.html`);
    if (!fs.existsSync(file)) return null;
    return parseLegacyChmiPage(fs.readFileSync(file, "utf-8"), {
      round,
      canonical,
    });
  };

  // Round-2 results keyed by (race, place) so we can attach runoffs.
  const round2ByPlace = new Map<string, LegacyChmiResult>();
  for (const n of t2) {
    const r = readPage(2, n);
    if (r) round2ByPlace.set(placeKey(r), r);
  }

  // Assemble one bundle per resolved obshtina.
  const bundles = new Map<string, LocalMunicipalityBundle>();
  const ensureBundle = (res: Resolution): LocalMunicipalityBundle => {
    let b = bundles.get(res.obshtinaCode);
    if (!b) {
      b = {
        cycle: folder,
        oikCode: "",
        obshtinaCode: res.obshtinaCode,
        obshtinaName: res.obshtinaName,
        oblastName: res.oblastName,
        protocol: {
          numRegisteredVoters: 0,
          totalActualVoters: 0,
          numValidVotes: 0,
        },
        mayor: { round1: [], round2: undefined, elected: null },
        council: [],
        kmetstva: [],
        districts: [],
      };
      bundles.set(res.obshtinaCode, b);
    }
    return b;
  };

  let unresolved = 0;
  for (const n of t1) {
    const r = readPage(1, n);
    if (!r) continue;
    const res = resolveObshtina(r);
    if (!res) {
      unresolved++;
      continue;
    }
    const b = ensureBundle(res);
    const r2 = round2ByPlace.get(placeKey(r));
    const round2 = r2?.candidates;

    if (r.raceType === "council") {
      b.council = r.councilParties;
    } else if (r.raceType === "obshtina") {
      const round1: LocalMayorResult[] = r.candidates;
      b.mayor = {
        round1,
        round2: round2 && round2.length ? round2 : undefined,
        elected: pickElectedMayor(round1, round2),
      };
    } else if (r.raceType === "rayon") {
      const district: LocalDistrictMayorResult = {
        districtName: r.placeName,
        districtCode: "",
        candidates: r.candidates,
        round2: round2 && round2.length ? round2 : undefined,
        elected: pickElectedMayor(r.candidates, round2),
      };
      b.districts.push(district);
    } else {
      const k: LocalKmetstvoResult = {
        kmetstvoName: r.placeName,
        ekatte: "",
        // Carry the round-2 winner forward so the elected flag is correct.
        candidates: round2 && round2.length ? round2 : r.candidates,
      };
      b.kmetstva.push(k);
    }
  }

  const outFolder = path.join(publicFolder, folder);
  const muniDir = path.join(outFolder, "municipalities");
  // Clear stale bundles first — a fixed resolution can move a race to a
  // different obshtina (e.g. the Бяла VAR05→RSE04 disambiguation), and the
  // old code's bundle would otherwise linger and double the event.
  fs.rmSync(muniDir, { recursive: true, force: true });
  fs.mkdirSync(muniDir, { recursive: true });
  for (const b of bundles.values()) {
    fs.writeFileSync(
      path.join(outFolder, "municipalities", `${b.obshtinaCode}.json`),
      stringify(b),
      "utf-8",
    );
  }
  // Refresh the cross-cycle chmi history so the new events surface.
  buildChmiHistory({ stringify });

  console.log(
    `[legacy_chmi] ${cycleSlug} :: wrote ${bundles.size} obshtina bundle(s)` +
      (unresolved ? ` (${unresolved} page(s) unresolved)` : ""),
  );
  return {
    cycleSlug,
    bundles: bundles.size,
    pages: t1.length,
  };
};
