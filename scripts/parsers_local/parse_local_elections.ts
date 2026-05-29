// Top-level orchestrator for parsing a local-election cycle.
//
// Two modes, picked by what's present in raw_data/<cycle>/:
//
//   HTML-only mode (automated path, the common case after step 2):
//     raw_data/<cycle>/html/tur1/*.html + tur2/*.html
//     - obshtinaCode resolved by município name from the HTML header
//       against data/municipalities.json.
//     - Section-level data is empty in the output JSON.
//
//   CSV+HTML mode (manual operator drop — same as step 1):
//     raw_data/<cycle>/ТУР1/{ОС,КО,КК,КР}/*.txt + html/...
//     - obshtinaCode resolved by ekatte join from sections.txt.
//     - Section-level data populated from protocols/votes.
//
// Output: data/<cycle>/{municipalities/<obshtinaCode>.json, index.json,
//          _unmatched_coalitions.json}

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { parseLocalSections } from "./parse_local_sections";
import { parseCikParties, parseLocalParties } from "./parse_local_parties";
import { parseLocalProtocols } from "./parse_local_protocols";
import { parseRezultatiHtml } from "./parse_rezultati_html";
import type { ParsedRezultatiPage } from "./parse_rezultati_html";
import {
  buildMunicipalityBundle,
  ObshtinaResolution,
} from "./build_municipality_json";
import { buildIndex } from "./build_index_json";
import { reconcileOfficials } from "./reconcile_officials";
import { buildChmiHistory } from "./build_chmi_history";
import municipalitiesData from "../../data/municipalities.json";
import { LocalMunicipalityBundle } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type MunicipalityRef = {
  ekatte: string;
  name: string;
  obshtina: string;
  oblast: string;
};
const MUNICIPALITIES = municipalitiesData as MunicipalityRef[];

// CSV-mode resolution: OIK ekatte set → obshtinaCode via municipalities.json.
const resolveByEkatte = (
  oikCode: string,
  oikName: string,
  ekattes: Set<string>,
): ObshtinaResolution | null => {
  const obshtinaCounts = new Map<string, number>();
  let sampleOblast = "";
  let sampleName = "";
  for (const ekatte of ekattes) {
    if (!ekatte) continue;
    const padded = ekatte.padStart(5, "0");
    const match = MUNICIPALITIES.find((m) => m.ekatte === padded);
    if (!match) continue;
    obshtinaCounts.set(
      match.obshtina,
      (obshtinaCounts.get(match.obshtina) ?? 0) + 1,
    );
    if (!sampleOblast) sampleOblast = match.oblast;
    if (!sampleName) sampleName = match.name;
  }
  if (obshtinaCounts.size === 0) return null;
  const sorted = Array.from(obshtinaCounts.entries()).sort(
    (a, b) => b[1] - a[1],
  );
  return {
    oikCode,
    obshtinaCode: sorted[0][0],
    obshtinaName: oikName.replace(/^\d+\.\s*/, "").trim() || sampleName,
    oblastName: sampleOblast,
  };
};

// Normalise for the name → obshtinaCode lookup (case-insensitive, strip
// "(столица)" etc.).
const normName = (s: string): string =>
  s
    .toLocaleLowerCase("bg")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

// CIK município names don't always match data/municipalities.json verbatim.
// Curated aliases — extend as more cycles surface mismatches.
const NAME_ALIASES: Record<string, string> = {
  // CIK uses "Добричка", the catalogue uses "Добрич-селска" (the rural município
  // around Добрич city).
  добричка: "DOB15",
  // 2011 / 2015 cycles label Добрич city as "Добрич-град" (the modern label
  // is just "Добрич"). DOB28 = the city município.
  "добрич-град": "DOB28",
  // Sofia City has no city-wide entry in data/municipalities.json — the
  // catalogue only has the 24 районs (S23xx/S24xx/S25xx). We pin Sofia's
  // city-wide bundle under a synthetic `SOF` code so the район shards
  // (including S2302 Красно Село) can hold their per-район mayor results
  // unobstructed. The Sofia/район fan-out in fanOutSofiaRayons() reads
  // city-wide council data from this SOF bundle and replicates it onto
  // each S2*** shard.
  столична: "SOF",
  // 2011 / 2015 cycles label Sofia city as just "София" (vs "Столична" in
  // 2019+). Same target código.
  софия: "SOF",
  // Бобовдол → catalogue uses "Бобов дол" (with space).
  бобовдол: "KNL04",
};
// Codes that aren't in data/municipalities.json but the parser may emit
// as synthetic entries.
const SYNTHETIC_OBSHTINA_CODES = new Set(["SOF"]);

// Sofia City has 24 районs (S2***). The parser produces ONE city-wide
// bundle for Столична (pinned under S2302); this helper splits its
// `districts` array into per-район bundles so the SPA's S2*** dashboards
// each pick up their район mayor.
const fanOutSofiaRayons = (
  cityBundle: LocalMunicipalityBundle,
): LocalMunicipalityBundle[] => {
  if (cityBundle.districts.length === 0) return [];
  const sofiaRayons = MUNICIPALITIES.filter((m) => m.obshtina.startsWith("S2"));
  const rayonShards: LocalMunicipalityBundle[] = [];
  for (const district of cityBundle.districts) {
    const districtName = normName(district.districtName);
    if (!districtName) continue;
    const match = sofiaRayons.find((r) => normName(r.name) === districtName);
    if (!match) continue;
    const elected = district.candidates.find((c) => c.isElected) ?? null;
    rayonShards.push({
      cycle: cityBundle.cycle,
      // Use the район code as the "OIK" so the per-район shard is keyed
      // consistently; the original OIK is preserved on the parent bundle.
      oikCode: match.obshtina,
      obshtinaCode: match.obshtina,
      obshtinaName: match.name,
      oblastName: cityBundle.oblastName,
      // Per-район protocol totals aren't split out from CIK's HTML; reuse
      // the parent's totals as an approximation.
      protocol: cityBundle.protocol,
      mayor: {
        round1: district.candidates,
        round2: undefined,
        elected,
      },
      // Cross-link by replicating the city-wide council on each район
      // (per the design choice — single source of truth, displayed on
      // every район page).
      council: cityBundle.council,
      kmetstva: [],
      districts: [],
    });
  }
  return rayonShards;
};

// HTML-mode resolution: município name from page header → obshtinaCode.
const resolveByName = (
  oikCode: string,
  parsed: ParsedRezultatiPage,
): ObshtinaResolution | null => {
  const target = normName(parsed.municipalityName);
  if (!target) return null;
  // Alias table wins so we can route CIK names (Добричка, Столична) that
  // don't appear verbatim in data/municipalities.json.
  const aliasObshtina = NAME_ALIASES[target];
  if (aliasObshtina) {
    if (SYNTHETIC_OBSHTINA_CODES.has(aliasObshtina)) {
      // Synthetic code (e.g. SOF for Sofia city-wide) — no catalogue entry.
      return {
        oikCode,
        obshtinaCode: aliasObshtina,
        obshtinaName: parsed.municipalityName,
        oblastName: parsed.oblastName,
      };
    }
    const match = MUNICIPALITIES.find((m) => m.obshtina === aliasObshtina);
    if (match) {
      return {
        oikCode,
        obshtinaCode: aliasObshtina,
        obshtinaName: parsed.municipalityName,
        oblastName: match.oblast || parsed.oblastName,
      };
    }
  }
  const match = MUNICIPALITIES.find((m) => normName(m.name) === target);
  if (!match) return null;
  return {
    oikCode,
    obshtinaCode: match.obshtina,
    obshtinaName: match.name,
    oblastName: match.oblast || parsed.oblastName,
  };
};

const loadCanonicalParties = (
  publicFolder: string,
): CanonicalPartiesIndex | undefined => {
  const file = path.join(publicFolder, "canonical_parties.json");
  if (!fs.existsSync(file)) {
    console.warn(
      `[parsers_local] canonical_parties.json not found — coalition resolution will mark all coalitions as unmatched. Run \`npm run data -- --summary\` first.`,
    );
    return undefined;
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as CanonicalPartiesIndex;
};

const dateFromCycle = (
  cycle: string,
): { round1: string; round2: string | null } => {
  const m = cycle.match(/^(\d{4})_(\d{2})_(\d{2})/);
  if (!m) return { round1: cycle, round2: null };
  const round1 = `${m[1]}-${m[2]}-${m[3]}`;
  const r1Date = new Date(round1);
  const r2 = new Date(r1Date.getTime() + 7 * 86400 * 1000);
  const round2 = `${r2.getFullYear()}-${String(r2.getMonth() + 1).padStart(2, "0")}-${String(r2.getDate()).padStart(2, "0")}`;
  return { round1, round2 };
};

const readHtmlIfExists = (file: string): string | null => {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf-8");
};

// Enumerate OIK codes from raw_data/<cycle>/html/tur1/*.html.
const oikCodesFromHtml = (rawFolder: string): string[] => {
  const tur1Dir = path.join(rawFolder, "html", "tur1");
  if (!fs.existsSync(tur1Dir)) return [];
  return fs
    .readdirSync(tur1Dir)
    .map((f) => f.match(/^(\d{4})\.html$/)?.[1] ?? null)
    .filter((c): c is string => c !== null)
    .sort();
};

export const parseLocalElection = async (opts: {
  cycle: string;
  rawDataRoot: string;
  publicFolder: string;
  stringify: (o: object) => string;
}): Promise<void> => {
  const { cycle, rawDataRoot, publicFolder, stringify } = opts;
  const inFolder = path.join(rawDataRoot, cycle);
  if (!fs.existsSync(inFolder)) {
    throw new Error(`Local-election raw folder not found: ${inFolder}`);
  }
  const outFolder = path.join(publicFolder, cycle);
  fs.mkdirSync(outFolder, { recursive: true });
  fs.mkdirSync(path.join(outFolder, "municipalities"), { recursive: true });

  const canonical = loadCanonicalParties(publicFolder);

  // Detect CSV mode by presence of ТУР1/ОС folder.
  const tur1OS = path.join(inFolder, "ТУР1", "ОС");
  const csvMode = fs.existsSync(tur1OS);

  let oikToEkattes = new Map<string, Set<string>>();
  const oikToName = new Map<string, string>();
  let unmatchedByRawName: Record<string, string[]> = {};
  let councilProtocols: Awaited<ReturnType<typeof parseLocalProtocols>> = [];

  if (csvMode) {
    console.log(`[parsers_local] ${cycle}: CSV mode (sections.txt present)`);
    const sections = await parseLocalSections(tur1OS);
    councilProtocols = await parseLocalProtocols(tur1OS);
    const parsed = await parseLocalParties(tur1OS, canonical);
    unmatchedByRawName = parsed.unmatchedByRawName;
    await parseCikParties(tur1OS); // sanity read, ignored

    for (const s of sections) {
      if (!s.oikCode) continue;
      if (!oikToEkattes.has(s.oikCode)) oikToEkattes.set(s.oikCode, new Set());
      oikToEkattes.get(s.oikCode)!.add(s.ekatte);
    }
    for (const p of parsed.parties) {
      if (!oikToName.has(p.oikCode) && p.oikName) {
        oikToName.set(p.oikCode, p.oikName);
      }
    }
  } else {
    console.log(
      `[parsers_local] ${cycle}: HTML-only mode (no sections.txt — using rezultati pages)`,
    );
    const htmlOiks = oikCodesFromHtml(inFolder);
    if (htmlOiks.length === 0) {
      throw new Error(
        `${cycle}: neither ТУР1/ОС/sections.txt nor html/tur1/*.html present in ${inFolder}`,
      );
    }
    // Seed the iterate-list with HTML-discovered OIKs and let the per-OIK
    // resolution happen against the município-name from the parsed page.
    oikToEkattes = new Map(htmlOiks.map((o) => [o, new Set<string>()]));
  }

  const htmlT1 = path.join(inFolder, "html", "tur1");
  const htmlT2 = path.join(inFolder, "html", "tur2");

  const bundles: LocalMunicipalityBundle[] = [];
  const unresolvedOiks: string[] = [];
  const missingHtml: string[] = [];

  for (const [oikCode, ekattes] of oikToEkattes.entries()) {
    const t1Html = readHtmlIfExists(path.join(htmlT1, `${oikCode}.html`));
    const t2Html = readHtmlIfExists(path.join(htmlT2, `${oikCode}.html`));
    if (!t1Html) {
      missingHtml.push(oikCode);
      continue;
    }
    const tur1 = parseRezultatiHtml(t1Html, {
      oikCode,
      round: 1,
      canonical,
    });
    const tur2 = t2Html
      ? parseRezultatiHtml(t2Html, { oikCode, round: 2, canonical })
      : null;
    const resolution = csvMode
      ? (resolveByEkatte(oikCode, oikToName.get(oikCode) ?? "", ekattes) ??
        resolveByName(oikCode, tur1))
      : resolveByName(oikCode, tur1);
    if (!resolution) {
      unresolvedOiks.push(`${oikCode}(${tur1.municipalityName || "?"})`);
      continue;
    }
    const bundle = buildMunicipalityBundle({
      cycle,
      resolution,
      tur1,
      tur2,
      councilProtocols,
    });
    if (!bundle) continue;
    const existing = bundles.find(
      (b) => b.obshtinaCode === bundle.obshtinaCode,
    );
    if (existing) {
      existing.kmetstva.push(...bundle.kmetstva);
      existing.districts.push(...bundle.districts);
    } else {
      bundles.push(bundle);
    }
  }

  // Sofia City fan-out: split the city-wide bundle (pinned under the
  // synthetic SOF code via NAME_ALIASES) into 24 per-район shards so
  // every район dashboard (S2302 Красно Село, S2308 Изгрев, S2315 Младост,
  // …) picks up its own mayor result. The SOF entry stays as the
  // canonical city-wide bundle (council + mayor of Sofia + all kmetstva).
  const sofiaCity = bundles.find((b) => b.obshtinaCode === "SOF");
  if (sofiaCity) {
    const rayonShards = fanOutSofiaRayons(sofiaCity);
    for (const r of rayonShards) {
      if (!bundles.some((b) => b.obshtinaCode === r.obshtinaCode)) {
        bundles.push(r);
      }
    }
    if (rayonShards.length > 0) {
      console.log(
        `[parsers_local] ${cycle}: fanned out ${rayonShards.length} Sofia район shards`,
      );
    }
  }

  for (const b of bundles) {
    const file = path.join(
      outFolder,
      "municipalities",
      `${b.obshtinaCode}.json`,
    );
    fs.writeFileSync(file, stringify(b), "utf-8");
  }

  const dates = dateFromCycle(cycle);
  const index = buildIndex({
    cycle,
    round1Date: dates.round1,
    round2Date: dates.round2,
    bundles,
    canonical,
  });
  fs.writeFileSync(
    path.join(outFolder, "index.json"),
    stringify(index),
    "utf-8",
  );

  fs.writeFileSync(
    path.join(outFolder, "_unmatched_coalitions.json"),
    stringify(unmatchedByRawName),
    "utf-8",
  );

  // Reconcile CIK winners against the Сметна палата currently-sitting
  // officials roster. Writes officials_diff.json — consumed by the
  // OfficialsDiffTile on each município page + the /sverka national screen.
  //
  // Chmi cycles ingest village-level (kmetstvo) partials — the município
  // mayor is unchanged and the official roster doesn't track kmetstvo
  // mayors, so a comparison there produces only false-positive 0/0
  // mismatches. Restrict reconciliation to regular _mi cycles.
  if (cycle.endsWith("_mi")) {
    reconcileOfficials({ cycle, publicFolder, stringify });
  }

  // Aggregate every ingested chmi (partial/new) cycle into a single
  // per-município history index so the SPA can surface "Извънредни
  // избори" inline on the município page. Runs unconditionally — cheap
  // and idempotent; it always reflects the current state of data/*_chmi/.
  buildChmiHistory({ stringify });

  console.log(
    `[parsers_local] ${cycle}: wrote ${bundles.length} município bundles to ${outFolder}`,
  );
  if (unresolvedOiks.length) {
    console.warn(
      `[parsers_local] ${cycle}: ${unresolvedOiks.length} OIK(s) could not be mapped to obshtina: ${unresolvedOiks.slice(0, 5).join(", ")}${unresolvedOiks.length > 5 ? "..." : ""}`,
    );
  }
  if (missingHtml.length) {
    console.warn(
      `[parsers_local] ${cycle}: ${missingHtml.length} OIK(s) missing tur1 HTML page: ${missingHtml.slice(0, 5).join(", ")}${missingHtml.length > 5 ? "..." : ""}`,
    );
  }
  const unmatchedCount = Object.keys(unmatchedByRawName).length;
  if (unmatchedCount > 0) {
    console.warn(
      `[parsers_local] ${cycle}: ${unmatchedCount} coalition name(s) had unmatched fragments. Inspect ${path.join(outFolder, "_unmatched_coalitions.json")}.`,
    );
  }
};

export const parseLocalElections = async (opts: {
  date?: string;
  all?: boolean;
  rawDataRoot?: string;
  publicFolder: string;
  stringify: (o: object) => string;
}): Promise<void> => {
  const rawDataRoot =
    opts.rawDataRoot ?? path.resolve(__dirname, "../../raw_data");
  let cycles: string[] = [];
  if (opts.date) {
    cycles = [opts.date];
  } else if (opts.all) {
    cycles = fs
      .readdirSync(rawDataRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((n) => /_(mi|chmi)$/.test(n))
      .sort();
  } else {
    console.warn(
      "[parsers_local] no --local-date and no --all flag — nothing to do.",
    );
    return;
  }
  for (const cycle of cycles) {
    await parseLocalElection({
      cycle,
      rawDataRoot,
      publicFolder: opts.publicFolder,
      stringify: opts.stringify,
    });
  }
};
