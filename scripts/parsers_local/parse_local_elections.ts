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
import { parseLocalParties } from "./parse_local_parties";
import { parseRezultatiHtml } from "./parse_rezultati_html";
import type { ParsedRezultatiPage } from "./parse_rezultati_html";
import {
  buildMunicipalityBundle,
  ObshtinaResolution,
} from "./build_municipality_json";
import { buildIndex } from "./build_index_json";
import { aggregateSections, SectionAggregation } from "./augment_sections";
import { aggregate2011Sections } from "./augment_sections_2011";
import {
  applyCouncilVotes,
  buildSectionShard,
  emitSectionFiles,
} from "./apply_section_augmentation";
import { buildRegionRollups } from "./build_region_json";
import { buildLocalDemographics } from "./build_local_demographics";
import { reconcileOfficials } from "./reconcile_officials";
import { buildChmiHistory } from "./build_chmi_history";
import municipalitiesData from "../../data/municipalities.json";
import { LATEST_LOCAL_CYCLE } from "@/data/local/useLatestLocalCycle";
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
  // catalogue only has the 24 districts (S23xx/S24xx/S25xx). We pin Sofia's
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

// Sofia City has 24 districts (S2***). The parser produces ONE city-wide
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
    // `district.elected` is the round-2-resolved winner (set in
    // mergeDistrictRounds). Fall back to the round-1 flag only for legacy
    // districts that predate that field (e.g. pre-2019 subpage ingest).
    const elected =
      district.elected ?? district.candidates.find((c) => c.isElected) ?? null;
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
        round2: district.round2,
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

  // Município structure + obshtina resolution always come from the mirrored
  // per-município HTML pages (the proven path: handles Sofia/район aliases +
  // fan-out, gives mayor + council mandates + elected lists). Section-level
  // votes/turnout from the CSV bundle are layered on additively below via
  // aggregateSections — they NEVER drive resolution. (The old "CSV mode"
  // ekatte-resolution fork mis-resolved ~25 municípios vs the HTML path and
  // never actually ran end-to-end — the parsers looked for un-dated filenames
  // the real bundles don't use — so it's been removed.)
  const tur1OS = path.join(inFolder, "ТУР1", "ОС");
  const hasCsv = fs.existsSync(tur1OS);
  let unmatchedByRawName: Record<string, string[]> = {};
  if (hasCsv) {
    // The CSV lists every party that ran (not just the HTML's mandate-winners),
    // so it's the richer source for the coalition-unmatched curation report.
    const parsed = await parseLocalParties(tur1OS, canonical);
    unmatchedByRawName = parsed.unmatchedByRawName;
  }

  const htmlOiks = oikCodesFromHtml(inFolder);
  if (htmlOiks.length === 0) {
    // Legacy chmi folders (chmi2012-2015 … chmi2019-2023) mirror numbered
    // pages (1.html, 2.html, …) that oikCodesFromHtml's 4-digit filter
    // ignores; their bundles are written directly by ingest_legacy_chmi, so
    // the modern parser has nothing to do here. Skip rather than throw so
    // `--local --all` glides over them.
    const tur1Dir = path.join(inFolder, "html", "tur1");
    const hasLegacyPages =
      fs.existsSync(tur1Dir) &&
      fs.readdirSync(tur1Dir).some((f) => /^\d+\.html$/.test(f));
    console.warn(
      `[parsers_local] ${cycle}: no OIK-município HTML pages — ${
        hasLegacyPages
          ? "legacy chmi folder, skipping modern parse"
          : "skipping"
      }.`,
    );
    return;
  }
  console.log(
    `[parsers_local] ${cycle}: ${htmlOiks.length} OIK HTML page(s)` +
      (hasCsv ? " + section CSV bundle" : " (no section CSV)"),
  );

  const htmlT1 = path.join(inFolder, "html", "tur1");
  const htmlT2 = path.join(inFolder, "html", "tur2");

  const bundles: LocalMunicipalityBundle[] = [];
  const unresolvedOiks: string[] = [];
  const missingHtml: string[] = [];

  for (const oikCode of htmlOiks) {
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
    const resolution = resolveByName(oikCode, tur1);
    if (!resolution) {
      unresolvedOiks.push(`${oikCode}(${tur1.municipalityName || "?"})`);
      continue;
    }
    const bundle = buildMunicipalityBundle({
      cycle,
      resolution,
      tur1,
      tur2,
      // Council-ballot turnout is set by the section augmentation below; the
      // HTML pages carry no protocol totals, so seed empty here.
      councilProtocols: [],
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

  // Section-level CSV augmentation. When the extracted bundle's ОС (council)
  // folder is present, sum its per-section votes per OIK to (a) backfill the
  // council `totalVotes`/`pctOfValid` that the HTML summary page omits — the
  // root cause of 2015's all-zero council vote share — and complete the
  // council with vote-winning-but-seatless parties, and (b) replace the
  // council-ballot turnout with the real protocol totals. Runs BEFORE the
  // Sofia fan-out so the район shards inherit the augmented city-wide council
  // by reference. The aggregation is reused below to emit section shards.
  let sectionAgg: SectionAggregation | null = null;
  sectionAgg = await aggregateSections({ rawFolder: inFolder, canonical });
  // 2011's bundle ("общински съветници", CP1251, pair-encoded votes) needs a
  // dedicated reader — falls through here when the modern ОС folder is absent.
  if (!sectionAgg) {
    sectionAgg = aggregate2011Sections({ rawFolder: inFolder, canonical });
  }
  if (sectionAgg) {
    let augmented = 0;
    for (const b of bundles) {
      if (applyCouncilVotes(b, sectionAgg)) augmented++;
    }
    console.log(
      `[parsers_local] ${cycle}: backfilled council votes + turnout for ${augmented} município(s) from section CSV`,
    );
  }

  // Pre-2019 cycles (2015) split each Sofia/Plovdiv/Varna район mayor
  // race into its own `mestni/NNNN_NNNNNr.html` page rather than nesting
  // it under "Резултати за кмет на район" sections on the parent
  // município page. The ingest mirrored these as `NNNN_NNNNNr.html`
  // siblings of `NNNN.html` in raw_data/<cycle>/html/tur1/. Walk them
  // here, parse each as a district mayor page, and append the resulting
  // districts to the parent município's bundle so the Sofia fan-out
  // below picks up район shards (S2***) for the older cycles too.
  if (fs.existsSync(htmlT1)) {
    const rayonFiles = fs
      .readdirSync(htmlT1)
      .filter((f) => /^(\d{4})_\d{5}r\.html$/.test(f));
    for (const file of rayonFiles) {
      const parentOik = file.match(/^(\d{4})_/)?.[1];
      if (!parentOik) continue;
      const parent = bundles.find((b) => b.oikCode === parentOik);
      if (!parent) continue;
      const t1Html = readHtmlIfExists(path.join(htmlT1, file));
      if (!t1Html) continue;
      const parsed = parseRezultatiHtml(t1Html, {
        oikCode: parentOik,
        round: 1,
        canonical,
      });
      // 2015 standalone район pages title themselves
      // "Резултати за община <city>, район <name>" in the breadcrumb but
      // their H3 race-section heading is the bare "Резултати за кмет на
      // район" (no суффикс) — so the parser's section.heading strip
      // leaves districtName empty and fanOutSofiaRayons can't match it
      // to S2401/S2302/…. Recover the район name from the breadcrumb
      // explicitly and override.
      const breadcrumbMatch = t1Html.match(
        /Резултати за община\s+[^,]+,\s*район\s+([^<\n,|]+)/i,
      );
      const rayonName = breadcrumbMatch?.[1]?.trim() ?? parsed.municipalityName;
      // The subpage's mayor[] holds the район кмет race (the parser
      // sees it as the page's main mayor section because there's no
      // parent município mayor on the standalone page). Promote those
      // rows into a synthetic districts[] entry keyed by the breadcrumb
      // район name. Fall back to the parser's own districts[] when the
      // page happens to use the "кмет на район" heading shape instead
      // — but override the (empty) districtName with the breadcrumb
      // value so the downstream Sofia fan-out can match.
      // Always override districtName with the breadcrumb-derived rayonName:
      // each standalone subpage describes exactly one район and the page-
      // level heading ("Резултати за кмет на район" without a suffix) is
      // never the actual name. The breadcrumb is authoritative here.
      if (parsed.districts.length > 0) {
        for (const d of parsed.districts) {
          parent.districts.push({ ...d, districtName: rayonName });
        }
      } else if (parsed.mayor.length > 0) {
        parent.districts.push({
          districtName: rayonName,
          districtCode: "",
          candidates: parsed.mayor,
        });
      }
    }
    if (rayonFiles.length > 0) {
      console.log(
        `[parsers_local] ${cycle}: merged ${rayonFiles.length} район subpage(s) into parent bundles`,
      );
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

  // Per-município section shards (council per-polling-station results +
  // turnout), emitted only when the section CSV covered the cycle.
  if (sectionAgg) {
    const sectionsDir = path.join(outFolder, "sections");
    // Clear stale shards first — obshtina codes can shift between runs (e.g.
    // an earlier район-fan-out bug), and a left-behind shard would surface
    // outdated per-station data on its page.
    fs.rmSync(sectionsDir, { recursive: true, force: true });
    fs.mkdirSync(sectionsDir, { recursive: true });
    let shardCount = 0;
    let sectionTotal = 0;
    // Sofia районs (S2***) carry oikCode === their own code, so buildSectionShard
    // finds no sections for them — historically they narrowed the full ~2MB SOF
    // index client-side. Emit each район its own light-index shard instead (the
    // heavy per-station detail files stay shared under sections/SOF/), keyed off
    // the city OIK + the район's 2-digit код.
    const sofiaOik = bundles.find((b) => b.obshtinaCode === "SOF")?.oikCode;
    let rayonShards = 0;
    for (const b of bundles) {
      const isSofiaRayon = /^S2\d{3}$/.test(b.obshtinaCode);
      if (isSofiaRayon) {
        if (!sofiaOik) continue;
        const full = buildSectionShard(
          { ...b, oikCode: sofiaOik },
          sectionAgg,
          canonical,
        );
        if (!full) continue;
        const rayonDigit = b.obshtinaCode.slice(-2);
        const shard = {
          ...full,
          sections: full.sections.filter(
            (s) => s.sectionCode.slice(4, 6) === rayonDigit,
          ),
        };
        if (shard.sections.length === 0) continue;
        sectionTotal += emitSectionFiles(shard, sectionsDir, stringify, true);
        shardCount++;
        rayonShards++;
        continue;
      }
      const shard = buildSectionShard(b, sectionAgg, canonical);
      if (!shard) continue;
      // Two tiers: light index + per-station detail files (see emitSectionFiles).
      sectionTotal += emitSectionFiles(shard, sectionsDir, stringify);
      shardCount++;
    }
    console.log(
      `[parsers_local] ${cycle}: wrote ${shardCount} section shard(s) (${rayonShards} Sofia район) covering ${sectionTotal} polling section(s)`,
    );
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

  // Per-oblast rollups + the national regions_summary, derived from the
  // bundles + index just written. Regular _mi cycles only — chmi partials are
  // single-município and carry no region dimension. Folded in here so the
  // standard watcher → update-local-elections flow keeps them fresh.
  if (cycle.endsWith("_mi")) {
    buildRegionRollups({ publicFolder, cycle, stringify });
    // Council-vote and mayoral-vote × Census 2021 demographic correlations for
    // the cycle dashboard. Regular cycles only — chmi partials are single-município.
    buildLocalDemographics({
      publicFolder,
      cycle,
      bundles,
      councilVoteShare: index.councilVoteShare,
      mayorsByCanonical: index.mayorsByCanonical,
      stringify,
    });
  }

  // Aggregate every ingested chmi (partial/new) cycle into a single
  // per-município history index so the SPA can surface "Извънредни
  // избори" inline on the município page. Runs unconditionally — cheap
  // and idempotent; it always reflects the current state of data/*_chmi/.
  // Built BEFORE reconcile so the latter can cross-link a "replaced" mayor
  // to the later partial/new election that installed the current officer.
  buildChmiHistory({ stringify });

  // Reconcile CIK winners against the Сметна палата currently-sitting
  // officials roster. Writes officials_diff.json — consumed by the
  // OfficialsDiffTile on each município page + the /sverka national screen.
  //
  // Only the LATEST regular cycle is reconciled: the officials roster is
  // always today's declarations, so comparing a prior cycle's winners
  // against present-day officials isn't meaningful (one or more elections
  // sit in between) and nothing in the SPA surfaces it. Chmi cycles ingest
  // only kmetstvo/район partials, which the roster doesn't track at all.
  if (cycle === LATEST_LOCAL_CYCLE) {
    reconcileOfficials({ cycle, publicFolder, stringify });
  }

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
