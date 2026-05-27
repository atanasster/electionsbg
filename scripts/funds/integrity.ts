// Integrity / red-flags derivative for /funds/integrity. Computes per-programme
// concentration metrics from the already-ingested project corpus, plus a
// cross-cutting view of serial winners and a name-match against the АОП
// debarred-suppliers register.
//
// What this script does NOT compute (limitations of the upstream feeds):
//
// - **Single-bidder rate per EU-funded contract.** The АОП OCDS feed surfaces
//   bid count only on tender records; the contract-grain rows we ingest carry
//   only the awarder, contractor, amount and CPV — not the tender id needed to
//   join back to bids. A future ingest of the tender-grain feed would unlock
//   this. The companion "AOP award overlap" metric here measures something
//   different but still useful: how much OVERALL procurement money flows to
//   the same beneficiaries that win EU funds.
//
// Reads:
//   data/funds/projects/index.json                # programme list + totals
//   data/funds/projects/by-program/{code}.json    # per-contract rows
//   data/funds/derived/political_links.json       # for АОП cross-reference
//   data/procurement/debarred.json                # name-match flags
//
// Writes:
//   data/funds/derived/integrity.json                       # slim leaderboard
//   data/funds/derived/integrity-by-program/{code}.json     # per-programme
//   data/funds/derived/integrity-by-program/index.json      # manifest

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { inferTaxonomy } from "./taxonomy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const FUNDS_DIR = path.join(ROOT, "data/funds");
const PROJECTS_INDEX = path.join(FUNDS_DIR, "projects/index.json");
const BY_PROGRAM_DIR = path.join(FUNDS_DIR, "projects/by-program");
const DERIVED_DIR = path.join(FUNDS_DIR, "derived");
const POLITICAL_FILE = path.join(DERIVED_DIR, "political_links.json");
const INTEGRITY_FILE = path.join(DERIVED_DIR, "integrity.json");
const INTEGRITY_SHARD_DIR = path.join(DERIVED_DIR, "integrity-by-program");
const DEBARRED_FILE = path.join(ROOT, "data/procurement/debarred.json");

// Concentration cutoffs are the standard antitrust HHI bands (×10000):
// <1500 unconcentrated, 1500-2500 moderate, >2500 high.
const HHI_HIGH = 2500;
const HHI_MODERATE = 1500;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const canonicalJson = (data: unknown): string =>
  JSON.stringify(data, null, 2) + "\n";

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[„""'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

interface ProjectsIndex {
  byProgram: Array<{
    programCode: string;
    programName: string;
    rollup: {
      contractCount: number;
      beneficiaryCount: number;
      totalEur: number;
      paidEur: number;
    };
  }>;
}

interface ProgramShard {
  programCode: string;
  programName: string;
  contracts: Array<{
    beneficiaryEik: string | null;
    beneficiaryName: string;
    totalEur: number;
    paidEur: number;
  }>;
}

interface PoliticalIndexFile {
  flaggedEiks?: string[];
  top?: Array<{ eik: string; procurementEur?: number }>;
}

interface DebarredFile {
  entries?: Array<{ name: string; nameNormalized: string }>;
}

// ---- Output shapes ----

export interface IntegrityBeneficiary {
  eik: string | null;
  name: string;
  totalEur: number;
  share: number; // share of programme total, 0..1
  contractCount: number;
}

export interface IntegrityProgramFile {
  programCode: string;
  programName: string;
  period: string;
  fundType: string;
  totals: {
    contractCount: number;
    beneficiaryCount: number;
    totalEur: number;
    paidEur: number;
  };
  hhi: number; // 0..10000
  hhiBand: "low" | "moderate" | "high";
  top5Share: number; // 0..1
  top1Share: number; // 0..1
  topBeneficiaries: IntegrityBeneficiary[]; // top-10
  debarredBeneficiaryCount: number;
  debarredBeneficiaryEur: number;
  debarredBeneficiaries: IntegrityBeneficiary[];
}

export interface IntegritySerialWinner {
  eik: string | null;
  name: string;
  programmeCount: number;
  totalEur: number; // EUR across all programmes
  topProgrammes: Array<{
    programCode: string;
    programName: string;
    eur: number;
  }>;
}

export interface IntegrityIndex {
  generatedAt: string;
  totals: {
    programmeCount: number;
    highConcentrationCount: number;
    moderateConcentrationCount: number;
    debarredOverlapCount: number;
    debarredOverlapEur: number;
  };
  // Programme-level concentration leaderboard.
  topByConcentration: Array<{
    programCode: string;
    programName: string;
    period: string;
    fundType: string;
    totalEur: number;
    paidEur: number;
    contractCount: number;
    beneficiaryCount: number;
    hhi: number;
    hhiBand: "low" | "moderate" | "high";
    top1Share: number;
    top1Name: string;
    debarredFlag: boolean;
  }>;
  // Top-N beneficiaries by funds, with the programme count — surfaces
  // serial winners regardless of any single-programme concentration.
  topSerialWinners: IntegritySerialWinner[];
  // EIKs flagged as debarred suppliers in the АОП register that ALSO appear
  // in ИСУН.
  debarredFlagged: Array<{
    eik: string | null;
    name: string;
    totalEur: number;
    programmeCount: number;
  }>;
}

// ---- Build ----

const readProgramShard = (programCode: string): ProgramShard | null => {
  const file = path.join(BY_PROGRAM_DIR, `${programCode}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ProgramShard;
  } catch {
    return null;
  }
};

const writeJsonIfChanged = (file: string, content: string): boolean => {
  if (fs.existsSync(file)) {
    try {
      if (fs.readFileSync(file, "utf8") === content) return false;
    } catch {
      // overwrite
    }
  }
  fs.writeFileSync(file, content);
  return true;
};

const computeProgrammeIntegrity = (
  shard: ProgramShard,
  debarredNames: Set<string>,
): IntegrityProgramFile => {
  // Aggregate per-EIK (null-EIK rows fold into one pseudo-bucket).
  interface Agg {
    eik: string | null;
    name: string;
    totalEur: number;
    paidEur: number;
    contractCount: number;
  }
  const byEik = new Map<string, Agg>();
  let totalEur = 0;
  let paidEur = 0;
  for (const c of shard.contracts ?? []) {
    const key = c.beneficiaryEik ?? `__null__:${normalize(c.beneficiaryName)}`;
    const prev = byEik.get(key);
    if (!prev) {
      byEik.set(key, {
        eik: c.beneficiaryEik,
        name: c.beneficiaryName,
        totalEur: c.totalEur,
        paidEur: c.paidEur,
        contractCount: 1,
      });
    } else {
      prev.totalEur += c.totalEur;
      prev.paidEur += c.paidEur;
      prev.contractCount += 1;
      // Keep the largest contract's name (parent unit).
      if (c.totalEur > prev.totalEur / prev.contractCount)
        prev.name = c.beneficiaryName;
    }
    totalEur += c.totalEur;
    paidEur += c.paidEur;
  }
  const beneficiaries = [...byEik.values()].sort(
    (a, b) => b.totalEur - a.totalEur,
  );

  // HHI on contracted EUR.
  let hhi = 0;
  for (const b of beneficiaries) {
    const share = totalEur > 0 ? b.totalEur / totalEur : 0;
    hhi += share * share;
  }
  hhi *= 10000;
  const hhiBand: "low" | "moderate" | "high" =
    hhi >= HHI_HIGH ? "high" : hhi >= HHI_MODERATE ? "moderate" : "low";

  const top1Share =
    totalEur > 0 && beneficiaries.length > 0
      ? beneficiaries[0].totalEur / totalEur
      : 0;
  const top5Share =
    totalEur > 0
      ? beneficiaries.slice(0, 5).reduce((s, b) => s + b.totalEur, 0) / totalEur
      : 0;

  const topBeneficiaries: IntegrityBeneficiary[] = beneficiaries
    .slice(0, 10)
    .map((b) => ({
      eik: b.eik,
      name: b.name,
      totalEur: round2(b.totalEur),
      share: round2(totalEur > 0 ? b.totalEur / totalEur : 0),
      contractCount: b.contractCount,
    }));

  const debarred: IntegrityBeneficiary[] = [];
  let debarredEur = 0;
  for (const b of beneficiaries) {
    if (!debarredNames.has(normalize(b.name))) continue;
    debarredEur += b.totalEur;
    debarred.push({
      eik: b.eik,
      name: b.name,
      totalEur: round2(b.totalEur),
      share: round2(totalEur > 0 ? b.totalEur / totalEur : 0),
      contractCount: b.contractCount,
    });
  }

  const t = inferTaxonomy(shard.programCode);
  return {
    programCode: shard.programCode,
    programName: shard.programName,
    period: t.period,
    fundType: t.fundType,
    totals: {
      contractCount: (shard.contracts ?? []).length,
      beneficiaryCount: beneficiaries.length,
      totalEur: round2(totalEur),
      paidEur: round2(paidEur),
    },
    hhi: round1(hhi),
    hhiBand,
    top5Share: round2(top5Share),
    top1Share: round2(top1Share),
    topBeneficiaries,
    debarredBeneficiaryCount: debarred.length,
    debarredBeneficiaryEur: round2(debarredEur),
    debarredBeneficiaries: debarred,
  };
};

const buildSerialWinners = (
  programmeFiles: IntegrityProgramFile[],
): IntegritySerialWinner[] => {
  interface Agg {
    eik: string | null;
    name: string;
    programmes: Map<string, { programName: string; eur: number }>;
    totalEur: number;
  }
  const byEik = new Map<string, Agg>();
  for (const p of programmeFiles) {
    for (const b of p.topBeneficiaries) {
      const key = b.eik ?? `__null__:${normalize(b.name)}`;
      const prev = byEik.get(key);
      if (!prev) {
        byEik.set(key, {
          eik: b.eik,
          name: b.name,
          programmes: new Map([
            [p.programCode, { programName: p.programName, eur: b.totalEur }],
          ]),
          totalEur: b.totalEur,
        });
      } else {
        prev.programmes.set(p.programCode, {
          programName: p.programName,
          eur: (prev.programmes.get(p.programCode)?.eur ?? 0) + b.totalEur,
        });
        prev.totalEur += b.totalEur;
        if (b.totalEur > prev.totalEur / prev.programmes.size)
          prev.name = b.name;
      }
    }
  }
  const arr: IntegritySerialWinner[] = [];
  for (const a of byEik.values()) {
    if (a.programmes.size < 2) continue;
    const topProgrammes = [...a.programmes.entries()]
      .map(([programCode, v]) => ({
        programCode,
        programName: v.programName,
        eur: round2(v.eur),
      }))
      .sort((a, b) => b.eur - a.eur)
      .slice(0, 5);
    arr.push({
      eik: a.eik,
      name: a.name,
      programmeCount: a.programmes.size,
      totalEur: round2(a.totalEur),
      topProgrammes,
    });
  }
  // Rank by combined exposure: log(EUR) × programmeCount.
  arr.sort(
    (a, b) =>
      Math.log1p(b.totalEur) * b.programmeCount -
      Math.log1p(a.totalEur) * a.programmeCount,
  );
  return arr.slice(0, 30);
};

export const buildIntegrity = (): {
  index: IntegrityIndex;
  perProgramme: IntegrityProgramFile[];
} => {
  if (!fs.existsSync(PROJECTS_INDEX)) {
    throw new Error(
      `integrity: ${PROJECTS_INDEX} missing — run funds:ingest-projects first`,
    );
  }
  const idx = JSON.parse(
    fs.readFileSync(PROJECTS_INDEX, "utf8"),
  ) as ProjectsIndex;

  let debarredNames = new Set<string>();
  if (fs.existsSync(DEBARRED_FILE)) {
    const file = JSON.parse(
      fs.readFileSync(DEBARRED_FILE, "utf8"),
    ) as DebarredFile;
    debarredNames = new Set(
      (file.entries ?? []).map((e) => normalize(e.nameNormalized)),
    );
  }

  let politicalFlagged = new Set<string>();
  if (fs.existsSync(POLITICAL_FILE)) {
    const pol = JSON.parse(
      fs.readFileSync(POLITICAL_FILE, "utf8"),
    ) as PoliticalIndexFile;
    politicalFlagged = new Set(pol.flaggedEiks ?? []);
  }
  void politicalFlagged; // reserved for future "politically-tied + concentrated" composite metric

  const perProgramme: IntegrityProgramFile[] = [];
  for (const p of idx.byProgram) {
    const shard = readProgramShard(p.programCode);
    if (!shard) continue;
    perProgramme.push(computeProgrammeIntegrity(shard, debarredNames));
  }
  perProgramme.sort((a, b) => b.hhi - a.hhi);

  const topSerialWinners = buildSerialWinners(perProgramme);

  // Cross-cutting debarred index: which debarred names appear in ИСУН and how
  // much they've totalled across programmes.
  interface DebarredAgg {
    eik: string | null;
    name: string;
    totalEur: number;
    programmes: Set<string>;
  }
  const debarredAgg = new Map<string, DebarredAgg>();
  for (const p of perProgramme) {
    for (const b of p.debarredBeneficiaries) {
      const key = b.eik ?? `__null__:${normalize(b.name)}`;
      const prev = debarredAgg.get(key);
      if (!prev) {
        debarredAgg.set(key, {
          eik: b.eik,
          name: b.name,
          totalEur: b.totalEur,
          programmes: new Set([p.programCode]),
        });
      } else {
        prev.totalEur += b.totalEur;
        prev.programmes.add(p.programCode);
      }
    }
  }
  const debarredFlagged = [...debarredAgg.values()]
    .map((a) => ({
      eik: a.eik,
      name: a.name,
      totalEur: round2(a.totalEur),
      programmeCount: a.programmes.size,
    }))
    .sort((a, b) => b.totalEur - a.totalEur);

  const highCount = perProgramme.filter((p) => p.hhiBand === "high").length;
  const modCount = perProgramme.filter((p) => p.hhiBand === "moderate").length;

  const topByConcentration = perProgramme
    .filter((p) => p.totals.totalEur > 1_000_000) // suppress noise from sub-€1M programmes
    .map((p) => ({
      programCode: p.programCode,
      programName: p.programName,
      period: p.period,
      fundType: p.fundType,
      totalEur: p.totals.totalEur,
      paidEur: p.totals.paidEur,
      contractCount: p.totals.contractCount,
      beneficiaryCount: p.totals.beneficiaryCount,
      hhi: p.hhi,
      hhiBand: p.hhiBand,
      top1Share: p.top1Share,
      top1Name: p.topBeneficiaries[0]?.name ?? "",
      debarredFlag: p.debarredBeneficiaryCount > 0,
    }))
    .sort((a, b) => b.hhi - a.hhi)
    .slice(0, 30);

  return {
    index: {
      generatedAt: new Date().toISOString(),
      totals: {
        programmeCount: perProgramme.length,
        highConcentrationCount: highCount,
        moderateConcentrationCount: modCount,
        debarredOverlapCount: debarredFlagged.length,
        debarredOverlapEur: debarredFlagged.reduce((s, d) => s + d.totalEur, 0),
      },
      topByConcentration,
      topSerialWinners,
      debarredFlagged,
    },
    perProgramme,
  };
};

export const writeIntegrity = (data: {
  index: IntegrityIndex;
  perProgramme: IntegrityProgramFile[];
}): void => {
  fs.mkdirSync(DERIVED_DIR, { recursive: true });
  fs.mkdirSync(INTEGRITY_SHARD_DIR, { recursive: true });
  writeJsonIfChanged(INTEGRITY_FILE, canonicalJson(data.index));

  const wanted = new Set<string>();
  for (const p of data.perProgramme) {
    const f = `${p.programCode}.json`;
    wanted.add(f);
    writeJsonIfChanged(path.join(INTEGRITY_SHARD_DIR, f), canonicalJson(p));
  }
  // Manifest of programme codes that have an integrity shard.
  const manifest = canonicalJson({
    generatedAt: data.index.generatedAt,
    programCodes: data.perProgramme.map((p) => p.programCode),
  });
  writeJsonIfChanged(path.join(INTEGRITY_SHARD_DIR, "index.json"), manifest);

  for (const f of fs.readdirSync(INTEGRITY_SHARD_DIR)) {
    if (!f.endsWith(".json")) continue;
    if (f === "index.json") continue;
    if (wanted.has(f)) continue;
    fs.unlinkSync(path.join(INTEGRITY_SHARD_DIR, f));
  }
};

const isMain =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMain) {
  console.log("→ building EU-funds integrity (red-flags) derivative");
  const data = buildIntegrity();
  writeIntegrity(data);
  const t = data.index.totals;
  console.log(
    `✓ integrity.json — ${t.programmeCount} programme(s), ` +
      `${t.highConcentrationCount} high-HHI, ${t.moderateConcentrationCount} moderate, ` +
      `${t.debarredOverlapCount} debarred-overlap (€${Math.round(t.debarredOverlapEur).toLocaleString("en-US")})`,
  );
  console.log(`  ${data.perProgramme.length} per-programme shard(s) written`);
}
