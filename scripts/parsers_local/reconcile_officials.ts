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

// Levenshtein edit distance, capped — only used to forgive single-character
// typos (Тороманова/Троманова, Монев/Монов, Фейзи/Хейзи) on a per-token basis.
const editDistance = (a: string, b: string): number => {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
};

// Same token count where every token matches except exactly one, which
// differs by a single character. Guards: ≥3 tokens and the differing token
// ≥4 chars, so we don't conflate genuinely-different short names.
const oneTypoApart = (pa: string[], pb: string[]): boolean => {
  if (pa.length !== pb.length || pa.length < 3) return false;
  let diffs = 0;
  for (let i = 0; i < pa.length; i++) {
    if (pa[i] === pb[i]) continue;
    diffs++;
    if (diffs > 1) return false;
    if (Math.min(pa[i].length, pb[i].length) < 4) return false;
    if (editDistance(pa[i], pb[i]) > 1) return false;
  }
  return diffs === 1;
};

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
  if (
    partsA[0] === partsB[0] &&
    partsA[partsA.length - 1] === partsB[partsB.length - 1]
  ) {
    return true;
  }
  // Hyphenated / expanded married surnames: same given name + patronymic and
  // a shared surname token. normName already split the hyphen into separate
  // tokens, so "Иванка Петрова Дончева" matches "…Дончева-Славова" and
  // "Ива Емилова Добрева" matches "…Добрева-Чуклева". Requiring both the
  // first and patronymic to match keeps this from over-joining strangers.
  if (partsA[0] === partsB[0] && partsA[1] === partsB[1]) {
    const surA = new Set(partsA.slice(2));
    if (partsB.slice(2).some((t) => surA.has(t))) return true;
  }
  // Single-character typo in exactly one name part.
  if (oneTypoApart(partsA, partsB)) return true;
  return false;
};

type OfficialEntry = {
  slug: string;
  name: string;
  role: string;
  // Set on район-aggregating city shards (Plovdiv/Varna): a "Район <NAME>"
  // mayor entry carries the район label here; the city mayor has none.
  district?: string;
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

type ChmiMayorEvent = { name: string; date: string; cycle: string };

// Latest município-wide mayor partial/new election per obshtina, read from
// the chmi history index (built just before reconcile runs). Lets a
// "replaced" mayor be explained by the extraordinary election that installed
// the current officer rather than reading as an unexplained mismatch.
const loadChmiMayors = (): Map<string, ChmiMayorEvent> => {
  const file = path.resolve(__dirname, "../../data/local_chmi_history.json");
  const map = new Map<string, ChmiMayorEvent>();
  if (!fs.existsSync(file)) return map;
  try {
    const history = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      byObshtina: Record<
        string,
        { kind: string; candidateName: string; date: string; cycle: string }[]
      >;
    };
    for (const [code, events] of Object.entries(history.byObshtina)) {
      // events arrive sorted date-descending → first obshtina_mayor is newest.
      const latest = events.find((e) => e.kind === "obshtina_mayor");
      if (latest) {
        map.set(code, {
          name: latest.candidateName,
          date: latest.date,
          cycle: latest.cycle,
        });
      }
    }
  } catch {
    /* best-effort enrichment — a missing/garbled index just skips it */
  }
  return map;
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
    // When status is "replaced" and a later partial/new election (chmi)
    // installed the sitting officer, the winning result that explains the
    // change. `matchesOfficial` is true when that chmi winner is the current
    // roster mayor — i.e. the "mismatch" is fully accounted for.
    replacedBy?: {
      name: string;
      date: string;
      cycle: string;
      matchesOfficial: boolean;
    } | null;
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
  chmiMayor: ChmiMayorEvent | null,
): MunicipalityOfficialsDiff["mayor"] => {
  const cik = bundle.mayor.elected;
  // Plovdiv/Varna shards fold every район mayor (each tagged with a
  // `district`) under the city's obshtina alongside the city mayor (no
  // district). The CIK bundle's elected mayor is the CITY mayor, so prefer
  // the district-less entry — otherwise `.find` returns whichever район
  // mayor happens to sort first and the city mayor reads as "replaced".
  const mayorEntries = shard?.entries.filter((e) => e.role === "mayor") ?? [];
  const officialMayor =
    mayorEntries.find((e) => !e.district) ?? mayorEntries[0] ?? null;
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
  const replacedBy =
    !isMatch && chmiMayor
      ? {
          name: chmiMayor.name,
          date: chmiMayor.date,
          cycle: chmiMayor.cycle,
          matchesOfficial: namesMatch(chmiMayor.name, officialMayor.name),
        }
      : null;
  return {
    cikName: cik.candidateName,
    cikParty: cik.localPartyName,
    cikRound: cik.round,
    officialName: officialMayor.name,
    officialSlug: officialMayor.slug,
    officialYear,
    status: isMatch ? "match" : "replaced",
    replacedBy,
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
  // No council to compare (e.g. Sofia districts) — base overall on mayor only.
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
  const chmiMayors = loadChmiMayors();
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
    // districts, each with its own roster).
    if (bundle.obshtinaCode === "SOF") continue;
    const shard = readOfficialsShard(bundle.obshtinaCode);
    const mayor = computeMayorDiff(
      bundle,
      shard,
      chmiMayors.get(bundle.obshtinaCode) ?? null,
    );
    // Sofia districts don't have their own council — the município council
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
