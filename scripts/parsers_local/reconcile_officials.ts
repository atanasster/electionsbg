// Reconcile elected officials (CIK winners) against currently-sitting
// officials (Сметна палата declarations under data/officials/municipal/).
//
// Per município, produce a diff record covering:
//   - Mayor: does the CIK winner still sit? Matches / replaced / missing.
//   - Council: how many CIK-elected councillors are still on the roster?
//     Which ones aren't? Which sitting councillors don't appear in CIK
//     (likely substitutes who replaced a resigning councillor)?
//
// Writes data/<cycle>/officials_diff.json — consumed by the SPA's
// OfficialsDiffTile (per município) and SverkaScreen (national overview).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  LocalMunicipalityBundle,
  LocalCouncilCandidate,
} from "@/data/local/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OFFICIALS_DIR = path.resolve(
  __dirname,
  "../../data/officials/municipal/by_obshtina",
);

// Normalise for cross-source name matching.
//   - lowercase (Bulgarian)
//   - strip diacritic combining marks (rare; Bulgarian generally uses
//     precomposed characters but be defensive)
//   - collapse whitespace
//   - drop punctuation
//   - strip middle initial dots ("Ив." → "Ив")
//   - swap dash/hyphen variants on surnames (Петкова-Георгиева ↔ Петкова Георгиева)
const normName = (s: string): string =>
  s
    .normalize("NFKC")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,;:]/g, " ")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("bg")
    .trim();

// Compare two names ignoring whitespace + diacritics + dashes. Also accept
// a "missing middle name" as a soft match — e.g. "Иван Петров" matches
// "Иван Стоянов Петров" (first + last present, middle differs/missing).
const namesMatch = (a: string, b: string): boolean => {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const partsA = na.split(" ").filter(Boolean);
  const partsB = nb.split(" ").filter(Boolean);
  if (partsA.length < 2 || partsB.length < 2) return false;
  // First + last token match → soft match (covers "missing middle" and
  // married-name variants like "Петкова" vs "Петкова Иванова").
  return (
    partsA[0] === partsB[0] &&
    partsA[partsA.length - 1] === partsB[partsB.length - 1]
  );
};

type OfficialEntry = {
  slug: string;
  name: string;
  role: string;
};

type OfficialsShard = {
  obshtina: string;
  registryName: string;
  years?: number[];
  entries: OfficialEntry[];
};

const readOfficialsShard = (obshtinaCode: string): OfficialsShard | null => {
  const file = path.join(OFFICIALS_DIR, `${obshtinaCode}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as OfficialsShard;
  } catch {
    return null;
  }
};

export type MayorDiffStatus =
  | "match"
  | "replaced"
  | "missing_official"
  | "missing_cik";

export type CouncilOnlyOfficial = { name: string; slug: string };
export type CouncilOnlyCik = {
  name: string;
  party: string;
  primaryCanonicalId: string | null;
};

export type MunicipalityOfficialsDiff = {
  obshtinaCode: string;
  obshtinaName: string;
  mayor: {
    cikName: string | null;
    cikParty: string | null;
    cikRound: 1 | 2 | null;
    officialName: string | null;
    officialSlug: string | null;
    officialYear: number | null;
    status: MayorDiffStatus;
  };
  council: {
    cikSeats: number;
    cikElectedCount: number;
    officialSeats: number;
    matched: number;
    onlyInCik: CouncilOnlyCik[];
    onlyInOfficial: CouncilOnlyOfficial[];
  };
  /** Quick-status summary used by the tile + sverka table. */
  overallStatus: "match" | "partial_mismatch" | "mismatch" | "missing";
};

export type CycleOfficialsDiff = {
  cycle: string;
  generatedAt: string;
  summary: {
    municipalitiesChecked: number;
    mayorMatches: number;
    mayorReplaced: number;
    mayorMissingOfficial: number;
    mayorMissingCik: number;
    totalCikElectedCouncillors: number;
    totalOfficialCouncillors: number;
    totalCouncillorMatches: number;
  };
  municipalities: MunicipalityOfficialsDiff[];
};

const computeMayorDiff = (
  bundle: LocalMunicipalityBundle,
  shard: OfficialsShard | null,
): MunicipalityOfficialsDiff["mayor"] => {
  const cik = bundle.mayor.elected;
  const officialMayor = shard?.entries.find((e) => e.role === "mayor") ?? null;
  const officialYear = shard?.years?.[0] ?? null;
  if (!cik && !officialMayor) {
    return {
      cikName: null,
      cikParty: null,
      cikRound: null,
      officialName: null,
      officialSlug: null,
      officialYear,
      status: "missing_cik",
    };
  }
  if (!cik) {
    return {
      cikName: null,
      cikParty: null,
      cikRound: null,
      officialName: officialMayor?.name ?? null,
      officialSlug: officialMayor?.slug ?? null,
      officialYear,
      status: "missing_cik",
    };
  }
  if (!officialMayor) {
    return {
      cikName: cik.candidateName,
      cikParty: cik.localPartyName,
      cikRound: cik.round,
      officialName: null,
      officialSlug: null,
      officialYear,
      status: "missing_official",
    };
  }
  const isMatch = namesMatch(cik.candidateName, officialMayor.name);
  return {
    cikName: cik.candidateName,
    cikParty: cik.localPartyName,
    cikRound: cik.round,
    officialName: officialMayor.name,
    officialSlug: officialMayor.slug,
    officialYear,
    status: isMatch ? "match" : "replaced",
  };
};

const computeCouncilDiff = (
  bundle: LocalMunicipalityBundle,
  shard: OfficialsShard | null,
): MunicipalityOfficialsDiff["council"] => {
  const cikElected: {
    name: string;
    party: string;
    canonicalId: string | null;
  }[] = [];
  let cikSeats = 0;
  for (const party of bundle.council) {
    cikSeats += party.mandatesWon;
    for (const c of party.candidates as LocalCouncilCandidate[]) {
      if (c.isElected) {
        cikElected.push({
          name: c.name,
          party: party.localPartyName,
          canonicalId: party.primaryCanonicalId,
        });
      }
    }
  }
  const officials = shard?.entries.filter((e) => e.role === "councillor") ?? [];
  // Greedy match: for each official, try to find a CIK-elected councillor
  // whose name matches.
  const used = new Set<number>();
  let matched = 0;
  const onlyInOfficial: CouncilOnlyOfficial[] = [];
  for (const off of officials) {
    const idx = cikElected.findIndex(
      (c, i) => !used.has(i) && namesMatch(c.name, off.name),
    );
    if (idx >= 0) {
      used.add(idx);
      matched++;
    } else {
      onlyInOfficial.push({ name: off.name, slug: off.slug });
    }
  }
  const onlyInCik: CouncilOnlyCik[] = cikElected
    .filter((_, i) => !used.has(i))
    .map((c) => ({
      name: c.name,
      party: c.party,
      primaryCanonicalId: c.canonicalId,
    }));
  return {
    cikSeats,
    cikElectedCount: cikElected.length,
    officialSeats: officials.length,
    matched,
    onlyInCik,
    onlyInOfficial,
  };
};

const computeOverall = (
  mayorStatus: MayorDiffStatus,
  council: MunicipalityOfficialsDiff["council"],
): MunicipalityOfficialsDiff["overallStatus"] => {
  if (mayorStatus === "missing_cik") return "missing";
  if (mayorStatus === "missing_official") return "missing";
  // No council to compare (e.g. Sofia районs) — base overall on mayor only.
  if (council.cikElectedCount === 0) {
    return mayorStatus === "match" ? "match" : "mismatch";
  }
  const councilHealthy = council.matched / council.cikElectedCount >= 0.8;
  if (mayorStatus === "match" && councilHealthy) return "match";
  if (mayorStatus === "match") return "partial_mismatch";
  return "mismatch";
};

export const reconcileOfficials = (opts: {
  cycle: string;
  publicFolder: string;
  stringify: (o: object) => string;
}): void => {
  const { cycle, publicFolder, stringify } = opts;
  const muniDir = path.join(publicFolder, cycle, "municipalities");
  if (!fs.existsSync(muniDir)) {
    console.warn(
      `[reconcile_officials] ${cycle}: no município bundles in ${muniDir} — skip`,
    );
    return;
  }
  const muniFiles = fs.readdirSync(muniDir).filter((f) => f.endsWith(".json"));
  const out: MunicipalityOfficialsDiff[] = [];
  let mayorMatches = 0;
  let mayorReplaced = 0;
  let mayorMissingOfficial = 0;
  let mayorMissingCik = 0;
  let totalCikElectedCouncillors = 0;
  let totalOfficialCouncillors = 0;
  let totalCouncillorMatches = 0;

  for (const f of muniFiles) {
    const bundle = JSON.parse(
      fs.readFileSync(path.join(muniDir, f), "utf-8"),
    ) as LocalMunicipalityBundle;
    // Skip the synthetic SOF entry — Sofia city-wide has no single
    // officials roster to compare against (the catalogue splits into 24
    // районs, each with its own roster).
    if (bundle.obshtinaCode === "SOF") continue;
    const shard = readOfficialsShard(bundle.obshtinaCode);
    const mayor = computeMayorDiff(bundle, shard);
    // Sofia районs don't have their own council — the município council
    // is elected city-wide. Suppress council comparison on район shards
    // (council was replicated from SOF for display purposes; comparing
    // against the район-level roster would produce false 0/61 mismatches).
    const isSofiaRayon = /^S2\d{3}$/.test(bundle.obshtinaCode);
    const council: MunicipalityOfficialsDiff["council"] = isSofiaRayon
      ? {
          cikSeats: 0,
          cikElectedCount: 0,
          officialSeats: 0,
          matched: 0,
          onlyInCik: [],
          onlyInOfficial: [],
        }
      : computeCouncilDiff(bundle, shard);
    const overallStatus = computeOverall(mayor.status, council);
    out.push({
      obshtinaCode: bundle.obshtinaCode,
      obshtinaName: bundle.obshtinaName,
      mayor,
      council,
      overallStatus,
    });
    if (mayor.status === "match") mayorMatches++;
    else if (mayor.status === "replaced") mayorReplaced++;
    else if (mayor.status === "missing_official") mayorMissingOfficial++;
    else mayorMissingCik++;
    totalCikElectedCouncillors += council.cikElectedCount;
    totalOfficialCouncillors += council.officialSeats;
    totalCouncillorMatches += council.matched;
  }

  // Sort: mismatches first so they're prominent in /sverka's default view.
  out.sort((a, b) => {
    const order: Record<MunicipalityOfficialsDiff["overallStatus"], number> = {
      mismatch: 0,
      partial_mismatch: 1,
      missing: 2,
      match: 3,
    };
    if (order[a.overallStatus] !== order[b.overallStatus]) {
      return order[a.overallStatus] - order[b.overallStatus];
    }
    return a.obshtinaName.localeCompare(b.obshtinaName, "bg");
  });

  const diff: CycleOfficialsDiff = {
    cycle,
    generatedAt: new Date().toISOString(),
    summary: {
      municipalitiesChecked: out.length,
      mayorMatches,
      mayorReplaced,
      mayorMissingOfficial,
      mayorMissingCik,
      totalCikElectedCouncillors,
      totalOfficialCouncillors,
      totalCouncillorMatches,
    },
    municipalities: out,
  };

  // Full diff — consumed by SverkaScreen for the national table.
  const outFile = path.join(publicFolder, cycle, "officials_diff.json");
  fs.writeFileSync(outFile, stringify(diff), "utf-8");
  // Per-município sidecars — consumed by the OfficialsDiffTile so the
  // município dashboard doesn't pull the full 60KB national file just to
  // display one row. ~1KB per shard.
  const sidecarDir = path.join(publicFolder, cycle, "officials_diff");
  fs.mkdirSync(sidecarDir, { recursive: true });
  for (const m of out) {
    fs.writeFileSync(
      path.join(sidecarDir, `${m.obshtinaCode}.json`),
      stringify(m),
      "utf-8",
    );
  }
  console.log(
    `[reconcile_officials] ${cycle}: ${out.length} municípios checked; mayor=${mayorMatches} match/${mayorReplaced} replaced/${mayorMissingOfficial} no-decl; councillors=${totalCouncillorMatches}/${totalCikElectedCouncillors} matched`,
  );
};
