// Ingest the single pre-2012 partial local election that results.cik.bg
// archives: the 2009-11-15 Sofia by-election — Столична община mayor
// (Йорданка Фандъкова, after Бойко Борисов left to become PM) + Район
// Панчарево mayor. This is the ONLY date under the `chmi2008-2010` umbrella;
// the 2007-2011 council term produced no other archived partial. (The older
// `chmi2004-2006` umbrella exists but predates the parliamentary-coverage
// floor and is out of scope.)
//
// The page is a single caption-based result page in the same ЦИКМИ template
// the 2007 cycle uses (caption + thead + `<tr class="elected">`, candidate
// cell `NAME<br><span class="party">PARTY</span>`), so the shared
// parseMayorTable reads both mayor tables directly. We assemble one SOF bundle
// (mayor + the Панчарево район) under data/2009_11_15_chmi/ and refresh the
// cross-cycle chmi history so it surfaces on /local/chmi + the Sofia município
// page — closing the chmi-feed gap below 2012.
//
// Re-runnable: caches the fetched HTML under raw_data/2009_11_15_chmi/html/.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { load } from "cheerio";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { cikFetchText } from "./cik_fetch";
import { parseMayorTable } from "./parse_rezultati_html";
import { buildByNickNameLower } from "./local_coalitions";
import { pickElectedMayor } from "./build_municipality_json";
import { buildChmiHistory } from "./build_chmi_history";
import {
  LocalDistrictMayorResult,
  LocalMayorResult,
  LocalMunicipalityBundle,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_ROOT = path.resolve(__dirname, "../../raw_data");

export const CHMI2009_SLUG = "chmi2008-2010/2009-11-15_chastichen";
const CYCLE = "2009_11_15_chmi";
const URL = `https://results.cik.bg/${CHMI2009_SLUG}/index.html`;

const collapse = (s: string): string =>
  s.replace(/ /g, " ").replace(/\s+/g, " ").trim();

const loadCanonical = (
  publicFolder: string,
): CanonicalPartiesIndex | undefined => {
  const f = path.join(publicFolder, "canonical_parties.json");
  return fs.existsSync(f)
    ? (JSON.parse(fs.readFileSync(f, "utf-8")) as CanonicalPartiesIndex)
    : undefined;
};

export const ingestChmi2009 = async (opts: {
  publicFolder: string;
  stringify: (o: object) => string;
}): Promise<{ bundles: number }> => {
  const { publicFolder, stringify } = opts;
  const rawDir = path.join(RAW_ROOT, CYCLE, "html");
  const rawFile = path.join(rawDir, "index.html");
  fs.mkdirSync(rawDir, { recursive: true });

  let html: string | null = fs.existsSync(rawFile)
    ? fs.readFileSync(rawFile, "utf-8")
    : null;
  if (html) {
    console.log(`[chmi2009] reusing cached ${rawFile}`);
  } else {
    html = await cikFetchText(URL, { allow404: true });
    if (!html) throw new Error(`[chmi2009] fetch failed: ${URL}`);
    fs.writeFileSync(rawFile, html, "utf-8");
  }

  const canonical = loadCanonical(publicFolder);
  const $ = load(html);
  const byNick = buildByNickNameLower(canonical);

  let mayor: LocalMayorResult[] = [];
  const districts: LocalDistrictMayorResult[] = [];

  $("table").each((_, table) => {
    const $table = $(table);
    const cap = collapse($table.find("caption").first().text());
    const lc = cap.toLocaleLowerCase("bg");
    const rayonMatch = lc.match(/кмет\s+на\s+район\s+(.+)$/);
    if (rayonMatch) {
      const candidates = parseMayorTable($, $table, 1, byNick);
      if (candidates.length) {
        // Recover the район name from the caption with original casing.
        const name = collapse(cap.replace(/^.*?район\s+/i, ""));
        districts.push({
          districtName: name,
          districtCode: "",
          candidates,
          elected: pickElectedMayor(candidates),
        });
      }
    } else if (/кмет\s+на\s+(?:\S+\s+)?община/.test(lc)) {
      mayor = parseMayorTable($, $table, 1, byNick);
    }
  });

  if (mayor.length === 0 && districts.length === 0) {
    throw new Error("[chmi2009] no mayor/район tables parsed");
  }

  const bundle: LocalMunicipalityBundle = {
    cycle: CYCLE,
    oikCode: "",
    obshtinaCode: "SOF",
    obshtinaName: "Столична",
    oblastName: "София (столица)",
    protocol: {
      numRegisteredVoters: 0,
      totalActualVoters: 0,
      numValidVotes: 0,
    },
    mayor: {
      round1: mayor,
      round2: undefined,
      elected: pickElectedMayor(mayor),
    },
    council: [],
    kmetstva: [],
    districts,
  };

  const outDir = path.join(publicFolder, CYCLE, "municipalities");
  fs.rmSync(path.join(publicFolder, CYCLE), { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "SOF.json"), stringify(bundle), "utf-8");

  buildChmiHistory({ stringify });

  console.log(
    `[chmi2009] wrote SOF bundle (mayor=${mayor.find((m) => m.isElected)?.candidateName ?? "?"}, ${districts.length} район)`,
  );
  return { bundles: 1 };
};
