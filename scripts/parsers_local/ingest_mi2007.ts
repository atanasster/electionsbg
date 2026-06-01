// End-to-end ingest of the 2007 regular local-election cycle (ЦИКМИ archive
// at mi2007.cik.bg) — the cycle that closes the gap between the parliamentary
// floor (2005) and the earliest local cycle we already cover (2011).
//
// 2007 predates BOTH the modern results.cik.bg page model and the section-CSV
// `votes.txt` bundle, so it can't ride the standard ingestCycle → parseRezultati
// path. Instead it ships two static-HTML ZIPs (one page per place):
//
//   results_1.zip → round 1 (mayor candidate tables + full council + kmetstva +
//                   район mayors) — the primary data
//   results_2.zip → round 2 runoffs (mayor/kmetstvo/район tables) — winners
//
// We download both via the CF-bypass Playwright downloader, extract them, parse
// every page with parse_mi2007, resolve each to an obshtinaCode by breadcrumb
// name (reusing the legacy-chmi resolver), assemble one LocalMunicipalityBundle
// per obshtina (merging round 2 by file-path), fan out Sofia районs, and then
// run the SAME downstream builders a modern cycle uses (index / region rollups /
// demographics / chmi history). Turnout stays {0,0,0} — 2007 publishes activity
// only in a separate `activity1/` archive, exactly like the other HTML-only
// cycles.
//
// Acquisition is re-runnable: if raw_data/2007_10_28_mi/results_{1,2}/ are
// already extracted, the download is skipped (offline re-parse).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { cikDownloadFile } from "./cik_fetch";
import { extractZipCp866 } from "./extract_bundle";
import { parseMi2007Page } from "./parse_mi2007";
import { resolveByOblastName } from "./ingest_legacy_chmi";
import { pickElectedMayor } from "./build_municipality_json";
import { buildIndex } from "./build_index_json";
import { buildLocalRollups } from "./build_region_json";
import { buildLocalDemographics } from "./build_local_demographics";
import { buildChmiHistory } from "./build_chmi_history";
import municipalitiesData from "../../data/municipalities.json";
import { LocalDistrictMayorResult, LocalMunicipalityBundle } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_ROOT = path.resolve(__dirname, "../../raw_data");

export const MI2007_CYCLE = "2007_10_28_mi";
const ROUND1_DATE = "2007-10-28";
const ROUND2_DATE = "2007-11-04";

const BUNDLE_URLS: { name: string; url: string }[] = [
  { name: "results_1", url: "https://mi2007.cik.bg/results_1.zip" },
  { name: "results_2", url: "https://mi2007.cik.bg/results_2.zip" },
];
// A sibling HTML page on the same host warms the cf_clearance cookie before
// the ZIP download (per cikDownloadFile's contract).
const WARM_URL = "https://mi2007.cik.bg/results1/01/index.html";

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

// The 2007 ЦИКМИ archive labels the Добрич city/rural pair inconsistently and
// in a way the shared resolver can't disambiguate on its own:
//   - the CITY obshtina page reads "община град Добрич" (unique "град X" prefix
//     across all 265 obshtina pages) → must map to DOB28
//   - the RURAL município's villages are split between "община Добричка" (43)
//     and a bare "община Добрич" (35) — verified every bare-Добрич village
//     belongs to DOB15 in settlements.json, and the city has no kmetstva.
// Rewrite both to the canonical labels the shared NAME_ALIASES already knows
// ("Добрич-град" → DOB28, "Добричка" → DOB15) before resolution. Keyed by the
// normalised breadcrumb name; 2007-specific so it never touches other cycles.
const MI2007_OBSHTINA_RENAME: Record<string, string> = {
  "град добрич": "Добрич-град",
  добрич: "Добричка",
};

const loadCanonical = (
  publicFolder: string,
): CanonicalPartiesIndex | undefined => {
  const f = path.join(publicFolder, "canonical_parties.json");
  return fs.existsSync(f)
    ? (JSON.parse(fs.readFileSync(f, "utf-8")) as CanonicalPartiesIndex)
    : undefined;
};

// Download + extract one ZIP into raw_data/2007_10_28_mi/<name>/, retrying the
// CF-warmed download a few times (the first attempt in a session often loses
// the warm race). Skips when already extracted.
const ensureExtracted = async (
  rawFolder: string,
  name: string,
  url: string,
): Promise<boolean> => {
  const dir = path.join(rawFolder, name);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    console.log(`[mi2007] ${name}: already extracted, reusing`);
    return true;
  }
  const zipPath = path.join(rawFolder, `_${name}.zip`);
  let saved: string | null = null;
  for (let i = 0; i < 3 && !saved; i++) {
    saved = await cikDownloadFile(url, zipPath, {
      warmUrl: WARM_URL,
      timeoutMs: 180_000,
    });
    if (!saved)
      console.log(`[mi2007] ${name}: download attempt ${i + 1} failed`);
  }
  if (!saved) {
    console.warn(`[mi2007] ${name}: download failed (CF / 404)`);
    return false;
  }
  console.log(
    `[mi2007] ${name}: got ${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB, extracting`,
  );
  const written = extractZipCp866(zipPath, dir);
  fs.rmSync(zipPath, { force: true });
  console.log(`[mi2007] ${name}: extracted ${written.length} file(s)`);
  return true;
};

// Walk every `<oblast>/<file>.html` under a results dir, skipping index pages.
const listPages = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const oblast of fs.readdirSync(dir)) {
    const od = path.join(dir, oblast);
    if (!fs.statSync(od).isDirectory()) continue;
    for (const f of fs.readdirSync(od)) {
      if (!f.endsWith(".html") || f === "index.html") continue;
      out.push(`${oblast}/${f}`);
    }
  }
  return out.sort();
};

const ensureBundle = (
  bundles: Map<string, LocalMunicipalityBundle>,
  obshtinaCode: string,
  obshtinaName: string,
  oblastCode: string,
): LocalMunicipalityBundle => {
  let b = bundles.get(obshtinaCode);
  if (!b) {
    b = {
      cycle: MI2007_CYCLE,
      oikCode: "",
      obshtinaCode,
      obshtinaName,
      // SOF stores a display string (matching the modern Sofia bundle);
      // build_region_json special-cases it. Everything else stores the code.
      oblastName: obshtinaCode === "SOF" ? "София (столица)" : oblastCode,
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
    bundles.set(obshtinaCode, b);
  }
  return b;
};

// Split the Sofia city bundle's districts[] into per-район shards (S2***), as
// the modern parser does, so every Sofia район dashboard picks up its mayor.
const fanOutSofiaRayons = (
  city: LocalMunicipalityBundle,
): LocalMunicipalityBundle[] => {
  if (city.districts.length === 0) return [];
  const sofiaRayons = MUNICIPALITIES.filter((m) => m.obshtina.startsWith("S2"));
  const shards: LocalMunicipalityBundle[] = [];
  for (const d of city.districts) {
    const dn = normName(d.districtName);
    if (!dn) continue;
    const match = sofiaRayons.find((r) => normName(r.name) === dn);
    if (!match) continue;
    const elected = d.elected ?? d.candidates.find((c) => c.isElected) ?? null;
    shards.push({
      cycle: city.cycle,
      oikCode: match.obshtina,
      obshtinaCode: match.obshtina,
      obshtinaName: match.name,
      oblastName: city.oblastName,
      protocol: city.protocol,
      mayor: { round1: d.candidates, round2: d.round2, elected },
      council: city.council,
      kmetstva: [],
      districts: [],
    });
  }
  return shards;
};

export const ingestMi2007 = async (opts: {
  publicFolder: string;
  stringify: (o: object) => string;
}): Promise<{ bundles: number }> => {
  const { publicFolder, stringify } = opts;
  const rawFolder = path.join(RAW_ROOT, MI2007_CYCLE);
  fs.mkdirSync(rawFolder, { recursive: true });

  for (const { name, url } of BUNDLE_URLS) {
    const ok = await ensureExtracted(rawFolder, name, url);
    if (!ok && name === "results_1") {
      throw new Error(
        "[mi2007] round-1 bundle unavailable — cannot ingest. Retry (CF) or drop results_1.zip manually.",
      );
    }
  }

  const canonical = loadCanonical(publicFolder);
  const r1Dir = path.join(rawFolder, "results_1");
  const r2Dir = path.join(rawFolder, "results_2");

  const bundles = new Map<string, LocalMunicipalityBundle>();
  let testPages = 0;
  let unresolved = 0;

  const readPage = (dir: string, rel: string, round: 1 | 2) => {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) return null;
    return parseMi2007Page(fs.readFileSync(file, "utf-8"), {
      round,
      canonical,
    });
  };

  for (const rel of listPages(r1Dir)) {
    const p1 = readPage(r1Dir, rel, 1);
    if (!p1) continue;
    const bc = p1.breadcrumb;
    if (bc.isTest) {
      testPages++;
      continue;
    }
    if (!bc.obshtinaName) continue;
    const obshtinaName =
      MI2007_OBSHTINA_RENAME[normName(bc.obshtinaName)] ?? bc.obshtinaName;
    const res = resolveByOblastName(obshtinaName, bc.oblastName);
    if (!res) {
      unresolved++;
      if (unresolved <= 10)
        console.warn(`[mi2007] unresolved obshtina: ${bc.obshtinaName}`);
      continue;
    }
    const b = ensureBundle(
      bundles,
      res.obshtinaCode,
      res.obshtinaName,
      res.oblastName,
    );
    // Round 2 at the SAME relative path (results_2 mirrors results_1 paths).
    const p2 = readPage(r2Dir, rel, 2);

    if (p1.obshtinaMayor.length) {
      const round1 = p1.obshtinaMayor;
      const round2 = p2?.obshtinaMayor.length ? p2.obshtinaMayor : undefined;
      b.mayor = { round1, round2, elected: pickElectedMayor(round1, round2) };
    }
    if (p1.council.length) b.council = p1.council;
    if (p1.kmetstvoMayor.length) {
      // For a kmetstvo that went to a runoff, the round-2 table holds the
      // final result; otherwise round 1 stands (mirrors legacy-chmi handling).
      const candidates = p2?.kmetstvoMayor.length
        ? p2.kmetstvoMayor
        : p1.kmetstvoMayor;
      b.kmetstva.push({
        kmetstvoName: bc.placeName ?? "",
        ekatte: "",
        candidates,
      });
    }
    if (p1.rayonMayor.length) {
      const round1 = p1.rayonMayor;
      const round2 = p2?.rayonMayor.length ? p2.rayonMayor : undefined;
      const district: LocalDistrictMayorResult = {
        districtName: bc.placeName ?? "",
        districtCode: "",
        candidates: round1,
        round2,
        elected: pickElectedMayor(round1, round2),
      };
      b.districts.push(district);
    }
  }

  // Sofia fan-out (after all районs are attached to the SOF bundle).
  const sof = bundles.get("SOF");
  if (sof) {
    for (const shard of fanOutSofiaRayons(sof)) {
      if (!bundles.has(shard.obshtinaCode)) {
        bundles.set(shard.obshtinaCode, shard);
      }
    }
  }

  // Write bundles.
  const outFolder = path.join(publicFolder, MI2007_CYCLE);
  const muniDir = path.join(outFolder, "municipalities");
  fs.rmSync(muniDir, { recursive: true, force: true });
  fs.mkdirSync(muniDir, { recursive: true });
  const bundleList = [...bundles.values()];
  for (const b of bundleList) {
    fs.writeFileSync(
      path.join(muniDir, `${b.obshtinaCode}.json`),
      stringify(b),
      "utf-8",
    );
  }

  // Cycle index (council vote share + mayors-won rollups).
  const index = buildIndex({
    cycle: MI2007_CYCLE,
    round1Date: ROUND1_DATE,
    round2Date: ROUND2_DATE,
    bundles: bundleList,
    canonical,
  });
  fs.writeFileSync(
    path.join(outFolder, "index.json"),
    stringify(index),
    "utf-8",
  );

  // Per-oblast rollups + national regions_summary, then census correlations —
  // the same additive passes a modern regular cycle runs.
  buildLocalRollups({ publicFolder, cycle: MI2007_CYCLE, stringify });
  buildLocalDemographics({
    publicFolder,
    cycle: MI2007_CYCLE,
    bundles: bundleList,
    councilVoteShare: index.councilVoteShare,
    mayorsByCanonical: index.mayorsByCanonical,
    stringify,
  });
  // Keep the cross-cycle chmi history fresh (cheap, idempotent).
  buildChmiHistory({ stringify });

  console.log(
    `[mi2007] wrote ${bundleList.length} obshtina bundle(s)` +
      ` (skipped ${testPages} test page(s), ${unresolved} unresolved)`,
  );
  return { bundles: bundleList.length };
};
