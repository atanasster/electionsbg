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
import { pickLocalWinner } from "./localPersonRefs";
import { buildIndex } from "./build_index_json";
import { buildLocalRollups } from "./build_region_json";
import { buildLocalDemographics } from "./build_local_demographics";
import { buildChmiHistory } from "./build_chmi_history";
import municipalitiesData from "../../data/municipalities.json";
import {
  LocalDistrictMayorResult,
  LocalMayorResult,
  LocalMunicipalityBundle,
} from "./types";

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

/**
 * Which of the two 2007 кметство page families a page belongs to.
 *
 * The archive publishes EVERY кметство twice, and the ingest used to walk both — which is
 * where 2,395 duplicate entries and ~1,243 phantom village mayors came from:
 *
 *   `decision` — keyed `<oik><sequence>` (`20400002`), headed "Окончателни резултати ПО
 *                РЕШЕНИЕ НА ОИК", no round tabs. 2,465 pages.
 *   `results`  — keyed `<oik><EKATTE>` (`20402573`), headed "Окончателни резултати", with
 *                І тур / ІІ тур. 2,906 pages, each linking its own `dec_kk_*` decision.
 *
 * They are NOT two views of one result: they carry different candidate lists and disagree on
 * the winner in 1,267 of the 2,354 places that have both. `results` is the correct one, and
 * that is measured rather than assumed — adjudicated against two independent sources:
 *
 *   the ОИК's own decision text (`dec_kk_*.html`, which names who was elected or who
 *     advanced): `results` 883, `decision` 2, over 998 places;
 *   the round-2 pairing (whoever contested the runoff must be who round 1 flagged as
 *     advancing): `results` 897, `decision` 1, over 1,007 places.
 *
 * See docs/plans/village-mayor-attribution-v1.md §T3.
 */
export type KmetstvoPageFamily = "decision" | "results";

/**
 * Fold a 2007 кметство name so the two families' spellings of one seat land on one key.
 *
 * They do not name a seat the same way, and a raw-name key therefore leaves duplicates
 * behind — the exact thing this de-duplication exists to remove. Measured variants:
 *
 *   union form   "Бояново и Стройно" (decision) vs "Бояново" (results) — a кметство covering
 *                several settlements, named by its members on one page and by its centre on
 *                the other. Also Маломирово и Славейково, Мелница и Малко Кирилово.
 *   type prefix  "С. Ваксево" vs "Ваксево"; "Гара Бов" vs "Бов"
 *   separator    "Алеко-Константиново" vs "Алеко Константиново"; "Даскал Атанасово" vs
 *                "Даскал-Атанасово"; "Злато Поле" vs "Златополе"
 *
 * Everything here is a lossless narrowing of ONE name — it never merges two names that are
 * different words. Genuine misspellings ("Доситиево" / "Доситеево") are out of its reach and
 * are reported by the residual-duplicate check instead of being guessed at.
 */
export const foldKmetstvoName = (name: string): string =>
  name
    .toLocaleLowerCase("bg")
    .replace(/\(.*?\)/g, "")
    // The кметство's centre is the first member; " и " joins the rest.
    .split(/\s+и\s+/)[0]
    // A leading settlement-type marker is a label, not part of the name.
    .replace(/^\s*(?:с|гр|кв|гара|мах)\.?\s+/u, "")
    .replace(/-/g, " ")
    // …and once separators are spaces, close them up too, so "Злато Поле" == "Златополе".
    .replace(/\s+/g, "");

/** The marker sits inside markup, so match on the tag-stripped, whitespace-collapsed text —
 *  `raw.includes()` misses it. */
export const kmetstvoPageFamily = (rawHtml: string): KmetstvoPageFamily =>
  rawHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .includes("по решение на ОИК")
    ? "decision"
    : "results";

/**
 * Pick the page that should represent a seat, given one already chosen and a newcomer.
 *
 * `results` always wins. `decision` is kept ONLY where it is all there is, so dropping the
 * family outright would lose those seats rather than de-duplicate them. Measured by the run
 * itself: 5,367 pages fold to 2,947 seats — 2,906 taken from a `results` page and 41 from a
 * `decision` page with no `results` counterpart.
 */
/** The winning ROW of a кметство contest, resolved through the shared `pickLocalWinner` rule.
 *
 *  That helper takes the narrow `LocalMayorMention` shape (the fields the winner rule reads),
 *  so its return value is re-found in the full row list — the bundle stores whole
 *  `LocalMayorResult`s. A candidate name appears once per contest, so the match is exact. */
const electedRow = (
  round1: LocalMayorResult[],
  round2?: LocalMayorResult[],
): LocalMayorResult | null => {
  const win = pickLocalWinner(round1, round2);
  if (!win) return null;
  const pool = round2?.length ? round2 : round1;
  return pool.find((c) => c.candidateName === win.candidateName) ?? null;
};

export const preferKmetstvoPage = <T extends { family: KmetstvoPageFamily }>(
  current: T | undefined,
  next: T,
): T => {
  if (!current) return next;
  if (current.family === next.family) return current; // first page of a family wins, deterministically
  return current.family === "results" ? current : next;
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
  // A Set, not a list: 2007 emits one page per PLACE, so the same município breadcrumb
  // recurs hundreds of times and a per-page list would bury the handful of real cases.
  const ambiguousNames = new Set<string>();

  const readPage = (dir: string, rel: string, round: 1 | 2) => {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf-8");
    return { page: parseMi2007Page(raw, { round, canonical }), raw };
  };

  // Every кметство the archive publishes, keyed by (obshtina, folded place) — ONE entry per
  // seat, chosen by `preferKmetstvoPage`. Collected across the whole walk and emitted after
  // it, because the two page families for one seat arrive as two unrelated files.
  const kmetstvaByKey = new Map<
    string,
    {
      obshtinaCode: string;
      obshtinaName: string;
      oblastName: string;
      placeName: string;
      family: KmetstvoPageFamily;
      round1: LocalMayorResult[];
      round2?: LocalMayorResult[];
    }
  >();

  for (const rel of listPages(r1Dir)) {
    const r1 = readPage(r1Dir, rel, 1);
    if (!r1) continue;
    const p1 = r1.page;
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
    // A breadcrumb whose oblast could not narrow a duplicate name (бяла/искър/средец) —
    // catalogue order decided. Collected rather than swallowed; the HTML path does the same.
    if (res.ambiguous)
      ambiguousNames.add(
        `${bc.obshtinaName} (обл. ${bc.oblastName || "?"}) → ${res.obshtinaCode}`,
      );
    const b = ensureBundle(
      bundles,
      res.obshtinaCode,
      res.obshtinaName,
      res.oblastName,
    );
    // Round 2 at the SAME relative path (results_2 mirrors results_1 paths).
    const p2 = readPage(r2Dir, rel, 2)?.page;

    if (p1.obshtinaMayor.length) {
      const round1 = p1.obshtinaMayor;
      const round2 = p2?.obshtinaMayor.length ? p2.obshtinaMayor : undefined;
      b.mayor = { round1, round2, elected: pickElectedMayor(round1, round2) };
    }
    if (p1.council.length) b.council = p1.council;
    if (p1.kmetstvoMayor.length) {
      // COLLECTED, not pushed: the same seat arrives twice, once per page family, and only
      // one of them is the real result. Emitted after the walk by preferKmetstvoPage.
      //
      // Round 1 and round 2 are kept as SEPARATE tables, the way every other cycle carries
      // them. The old code replaced `candidates` with the round-2 table when one existed,
      // which threw the first-round field away and left `elected` unset — so the resolver
      // had to re-derive a winner from a round-1 table that CIK marks with BOTH finalists.
      const key = `${res.obshtinaCode}\t${foldKmetstvoName(bc.placeName ?? "")}`;
      const next = {
        obshtinaCode: res.obshtinaCode,
        obshtinaName: res.obshtinaName,
        oblastName: res.oblastName,
        placeName: bc.placeName ?? "",
        family: kmetstvoPageFamily(r1.raw),
        round1: p1.kmetstvoMayor,
        round2: p2?.kmetstvoMayor.length ? p2.kmetstvoMayor : undefined,
      };
      kmetstvaByKey.set(key, preferKmetstvoPage(kmetstvaByKey.get(key), next));
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

  // Emit the de-duplicated кметства, one per seat. Insertion order follows the sorted page
  // walk, so the arrays — and therefore the index-keyed `person_role.ref`s the resolver
  // mints from them — are deterministic across runs.
  const familyCount = { decision: 0, results: 0 };
  for (const k of kmetstvaByKey.values()) {
    familyCount[k.family]++;
    ensureBundle(
      bundles,
      k.obshtinaCode,
      k.obshtinaName,
      k.oblastName,
    ).kmetstva.push({
      kmetstvoName: k.placeName,
      ekatte: "",
      candidates: k.round1,
      round2: k.round2,
      // `pickLocalWinner`, NOT `pickElectedMayor`. The two differ when a round-1 table flags
      // BOTH finalists and no round-2 table exists — 25 of the 2007 seats — because
      // pickElectedMayor takes the first flagged row in document order while the resolver
      // takes the highest-vote one. The bundle's `elected` renders the name on /local while
      // the resolver's choice is what gets a /person page, so a divergence shows one man on
      // the page and publishes another. This is the shared rule both walks already use for
      // every other cycle.
      elected: electedRow(k.round1, k.round2),
    });
  }
  console.log(
    `[mi2007] ${kmetstvaByKey.size} кметство seat(s) after de-duplication ` +
      `(${familyCount.results} from the results pages, ${familyCount.decision} from a "по решение на ОИК" page with no results counterpart)`,
  );
  // A classifier that stops matching fails SILENTLY and in the worst possible direction: every
  // page reads as `results`, so "first page of a family wins" hands all 2,354 both-family
  // seats to the decision page (its filename sorts first) — the family adjudicated wrong
  // 883-to-2. The archive is frozen, so the counts cannot legitimately collapse.
  if (familyCount.results < 2000)
    throw new Error(
      `[mi2007] only ${familyCount.results} seat(s) came from a results page (expected ~2,900) — ` +
        `kmetstvoPageFamily is no longer matching "по решение на ОИК", so the wrong family would win every seat.`,
    );

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

  if (ambiguousNames.size)
    console.warn(
      `[mi2007] ${ambiguousNames.size} município name(s) the oblast could not disambiguate — catalogue order decided:\n  ${[...ambiguousNames].join("\n  ")}`,
    );
  console.log(
    `[mi2007] wrote ${bundleList.length} obshtina bundle(s)` +
      ` (skipped ${testPages} test page(s), ${unresolved} unresolved)`,
  );
  return { bundles: bundleList.length };
};
