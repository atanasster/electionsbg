// Political-economy join layer: which EU-funds beneficiaries are controlled
// by politically-exposed persons (MPs + cabinet + agency heads + governors +
// mayors + councillors), and how that intersects with public-procurement
// awards and the debarred-suppliers register.
//
// Reads (all already present after the standard ingest chain runs):
//   - data/funds/beneficiaries/<k>.json     (EU-funds organisation rollup)
//   - data/funds/derived/mp_connected.json  (MP cross-reference, produced earlier in this ingest)
//   - data/officials/derived/company_links.json  (cabinet/agency/governors/mayors → companies)
//   - data/officials/index.json             (slug → role/category/tier resolution)
//   - data/procurement/derived/top_contractors.json (slim АОП award totals)
//   - data/procurement/debarred.json        (debarred suppliers — name-matched)
//
// Writes:
//   - data/funds/derived/political_links.json
//       Slim leaderboard (top-50 by contractedEur) + corpus totals.
//   - data/funds/derived/political-by-eik/{eik}.json
//       Per-EIK shard for every flagged beneficiary — drives the /company panel.
//   - data/funds/derived/political-by-eik/index.json
//       Manifest of which EIKs have a shard.
//
// Editorial guardrail: a connection is only recorded when it's in the official
// Court-of-Audit declaration OR the Commerce Registry. No name-match guessing.
// The officials side uses the high-confidence filter (the same one the
// officials skill applies — declared + namesakeCount == 1).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { FundsBeneficiary } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const FUNDS_DIR = path.join(ROOT, "data/funds");
const BENEFICIARIES_DIR = path.join(FUNDS_DIR, "beneficiaries");
const DERIVED_DIR = path.join(FUNDS_DIR, "derived");
const MP_CONNECTED_FILE = path.join(DERIVED_DIR, "mp_connected.json");
const POLITICAL_FILE = path.join(DERIVED_DIR, "political_links.json");
const POLITICAL_SHARD_DIR = path.join(DERIVED_DIR, "political-by-eik");

const OFFICIALS_COMPANY_LINKS = path.join(
  ROOT,
  "data/officials/derived/company_links.json",
);
const OFFICIALS_INDEX = path.join(ROOT, "data/officials/index.json");
const PROC_TOP_CONTRACTORS = path.join(
  ROOT,
  "data/procurement/derived/top_contractors.json",
);
const PROC_DEBARRED = path.join(ROOT, "data/procurement/debarred.json");
const PROC_CONTRACTORS_DIR = path.join(ROOT, "data/procurement/contractors");

const TOP_N = 50;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const canonicalJson = (data: unknown): string =>
  JSON.stringify(data, null, 2) + "\n";

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[„""'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ---- Schema mirrors of upstream files (only the fields we read) ----

interface MpConnectedFile {
  entries: Array<{
    mpId: number;
    mpName: string;
    beneficiaryEik: string;
    beneficiaryName: string;
    orgType: string;
    relations: Array<{
      kind: string;
      isCurrent?: boolean;
      confidence?: "high" | "medium" | "low";
      shareSize?: string;
      valueEur?: number;
      fiscalYear?: number;
      declarationYear?: number;
    }>;
    contractCount: number;
    contractedEur: number;
    paidEur: number;
  }>;
}

interface OfficialsCompanyLinks {
  byOfficial: Record<
    string,
    {
      slug: string;
      name: string;
      tier: string;
      role: string;
      municipality: string | null;
      links: Array<{
        uic: string;
        companyName: string;
        source: "tr" | "declaration" | string;
        trRole?: string | null;
        shareSize?: string | null;
        valueEur?: number | null;
        confidence: "high" | "medium" | "low";
        namesakeCount?: number;
      }>;
    }
  >;
}

interface OfficialsIndex {
  entries: Array<{
    slug: string;
    name: string;
    category: string;
    categoryRaw?: string;
    institution: string | null;
    latestDeclarationYear: number | null;
  }>;
}

interface TopContractorsFile {
  entries: Array<{
    eik: string;
    name: string;
    totalEur: number;
    contractCount: number;
    awardCount: number;
  }>;
}

interface DebarredFile {
  entries: Array<{
    name: string;
    nameNormalized: string;
    debarredUntil: string;
  }>;
}

// ---- Output shapes ----

export interface PoliticalMpLink {
  mpId: number;
  mpName: string;
  relations: MpConnectedFile["entries"][number]["relations"];
}

export interface PoliticalOfficialRole {
  source: "tr" | "declaration" | string;
  trRole?: string | null;
  shareSize?: string | null;
  valueEur?: number | null;
}

export interface PoliticalOfficialLink {
  slug: string;
  name: string;
  category: string;
  tier: string;
  role: string;
  institution: string | null;
  municipality: string | null;
  confidence: "high" | "medium" | "low";
  latestDeclarationYear: number | null;
  // Multiple declared roles for the same (official, beneficiary) pair —
  // e.g. partner + manager in the same company.
  roles: PoliticalOfficialRole[];
}

export interface PoliticalEntry {
  eik: string;
  name: string;
  orgType: string;
  contractCount: number;
  contractedEur: number;
  paidEur: number;
  mps: PoliticalMpLink[];
  officials: PoliticalOfficialLink[];
  procurementEur: number;
  procurementContractCount: number;
  debarred: boolean;
  // Composite "exposure" score: log-scaled EU-funds contracted, weighted up
  // for multi-person controls and procurement overlap. Used only to rank
  // the leaderboard — never displayed.
  exposureScore: number;
}

export interface PoliticalShard {
  eik: string;
  entry: PoliticalEntry;
}

export interface PoliticalIndex {
  generatedAt: string;
  totals: {
    flaggedEiks: number;
    mpOnly: number;
    officialOnly: number;
    both: number;
    debarredFlagged: number;
    contractedEur: number;
    paidEur: number;
    procurementEur: number;
  };
  top: PoliticalEntry[];
  // All flagged EIKs in stable order — the leaderboard page paginates over
  // this list and fetches per-EIK shards as needed.
  flaggedEiks: string[];
}

// ---- Build steps ----

const readBeneficiaries = (): FundsBeneficiary[] => {
  if (!fs.existsSync(BENEFICIARIES_DIR)) {
    throw new Error(
      `political_links: ${BENEFICIARIES_DIR} missing — run funds:ingest first`,
    );
  }
  const rows: FundsBeneficiary[] = [];
  for (const f of fs.readdirSync(BENEFICIARIES_DIR)) {
    if (!f.endsWith(".json")) continue;
    const buf = fs.readFileSync(path.join(BENEFICIARIES_DIR, f), "utf8");
    const arr = JSON.parse(buf) as FundsBeneficiary[];
    rows.push(...arr);
  }
  return rows;
};

// Aggregate beneficiary rows by EIK (sub-units share their parent's EIK, so a
// connected company is counted once with summed totals). Same shape as
// cross_reference.ts uses.
interface AggBeneficiary {
  eik: string;
  name: string;
  orgType: string;
  contractCount: number;
  contractedEur: number;
  paidEur: number;
}

const aggregateByEik = (
  rows: FundsBeneficiary[],
): Map<string, AggBeneficiary> => {
  const byEik = new Map<string, AggBeneficiary>();
  for (const b of rows) {
    if (!b.eik) continue;
    const prev = byEik.get(b.eik);
    if (!prev) {
      byEik.set(b.eik, {
        eik: b.eik,
        name: b.name,
        orgType: b.orgType,
        contractCount: b.contractCount,
        contractedEur: b.contractedEur,
        paidEur: b.paidEur,
      });
      continue;
    }
    if (b.contractedEur > prev.contractedEur) {
      prev.name = b.name;
      prev.orgType = b.orgType;
    }
    prev.contractCount += b.contractCount;
    prev.contractedEur += b.contractedEur;
    prev.paidEur += b.paidEur;
  }
  return byEik;
};

const buildMpByEik = (): Map<string, PoliticalMpLink[]> => {
  const byEik = new Map<string, PoliticalMpLink[]>();
  if (!fs.existsSync(MP_CONNECTED_FILE)) return byEik;
  const file = JSON.parse(
    fs.readFileSync(MP_CONNECTED_FILE, "utf8"),
  ) as MpConnectedFile;
  for (const e of file.entries) {
    const arr = byEik.get(e.beneficiaryEik) ?? [];
    arr.push({ mpId: e.mpId, mpName: e.mpName, relations: e.relations });
    byEik.set(e.beneficiaryEik, arr);
  }
  return byEik;
};

const buildOfficialsByEik = (): Map<string, PoliticalOfficialLink[]> => {
  const byEik = new Map<string, PoliticalOfficialLink[]>();
  if (
    !fs.existsSync(OFFICIALS_COMPANY_LINKS) ||
    !fs.existsSync(OFFICIALS_INDEX)
  ) {
    return byEik;
  }
  const links = JSON.parse(
    fs.readFileSync(OFFICIALS_COMPANY_LINKS, "utf8"),
  ) as OfficialsCompanyLinks;
  const idx = JSON.parse(
    fs.readFileSync(OFFICIALS_INDEX, "utf8"),
  ) as OfficialsIndex;
  const officialMeta = new Map(idx.entries.map((e) => [e.slug, e]));

  // Per-EIK, dedupe officials by slug — combine multiple TR roles + declared
  // stakes for the same person into one entry's `roles` array.
  const perEik = new Map<string, Map<string, PoliticalOfficialLink>>();
  for (const official of Object.values(links.byOfficial)) {
    const meta = officialMeta.get(official.slug);
    for (const link of official.links) {
      // High-confidence + canonical 9-digit EIK only — same gate the officials
      // skill applies for "declared" links. Skip 13-digit BULSTAT (sub-units)
      // and low-confidence namesake guesses.
      if (link.confidence !== "high") continue;
      if (!/^\d{9}$/.test(link.uic)) continue;
      // For TR roles, also require namesakeCount == 1 to avoid common-name
      // collisions. Declarations are inherently high-confidence (filed by the
      // official themselves) so no namesake gate is needed.
      if (link.source === "tr" && (link.namesakeCount ?? 1) !== 1) continue;

      let byOfficial = perEik.get(link.uic);
      if (!byOfficial) {
        byOfficial = new Map();
        perEik.set(link.uic, byOfficial);
      }
      let entry = byOfficial.get(official.slug);
      if (!entry) {
        entry = {
          slug: official.slug,
          name: official.name,
          category: meta?.category ?? official.role,
          tier: official.tier,
          role: official.role,
          institution: meta?.institution ?? null,
          municipality: official.municipality,
          confidence: link.confidence,
          latestDeclarationYear: meta?.latestDeclarationYear ?? null,
          roles: [],
        };
        byOfficial.set(official.slug, entry);
      }
      entry.roles.push({
        source: link.source,
        trRole: link.trRole ?? null,
        shareSize: link.shareSize ?? null,
        valueEur: link.valueEur ?? null,
      });
    }
  }
  for (const [uic, byOfficial] of perEik) {
    byEik.set(uic, [...byOfficial.values()]);
  }
  return byEik;
};

const buildProcurementByEik = (
  flaggedEiks: Set<string>,
): Map<string, { totalEur: number; contractCount: number }> => {
  const byEik = new Map<string, { totalEur: number; contractCount: number }>();
  if (!fs.existsSync(PROC_TOP_CONTRACTORS)) return byEik;
  const top = JSON.parse(
    fs.readFileSync(PROC_TOP_CONTRACTORS, "utf8"),
  ) as TopContractorsFile;
  // First pass: pick up the easy wins from the top-contractors slim file.
  for (const e of top.entries) {
    if (!flaggedEiks.has(e.eik)) continue;
    byEik.set(e.eik, { totalEur: e.totalEur, contractCount: e.contractCount });
  }
  // Second pass: for any flagged EIK still missing, read its per-contractor
  // file (cheap — flagged set is in the low thousands at most, and each file
  // is a few KB). This is the slow but precise step.
  let missing = 0;
  for (const eik of flaggedEiks) {
    if (byEik.has(eik)) continue;
    const file = path.join(PROC_CONTRACTORS_DIR, `${eik}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      const c = JSON.parse(fs.readFileSync(file, "utf8")) as {
        totalEur?: number;
        contractCount?: number;
      };
      if (typeof c.totalEur === "number") {
        byEik.set(eik, {
          totalEur: c.totalEur,
          contractCount: c.contractCount ?? 0,
        });
      }
    } catch {
      missing += 1;
    }
  }
  if (missing > 0) {
    console.log(
      `  ⚠ ${missing} flagged EIK procurement file(s) failed to parse — set to zero`,
    );
  }
  return byEik;
};

const buildDebarredNames = (): Set<string> => {
  const set = new Set<string>();
  if (!fs.existsSync(PROC_DEBARRED)) return set;
  const file = JSON.parse(
    fs.readFileSync(PROC_DEBARRED, "utf8"),
  ) as DebarredFile;
  for (const e of file.entries) set.add(normalize(e.nameNormalized));
  return set;
};

const computeExposureScore = (e: {
  contractedEur: number;
  mps: PoliticalMpLink[];
  officials: PoliticalOfficialLink[];
  procurementEur: number;
}): number => {
  const log = Math.log1p(e.contractedEur);
  const procBoost = Math.log1p(e.procurementEur) * 0.3;
  const peoplePenalty = Math.log1p(e.mps.length + e.officials.length);
  return round2(log + procBoost + peoplePenalty);
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

// ---- Main ----

export const buildPoliticalLinks = (): {
  index: PoliticalIndex;
  shards: PoliticalShard[];
} => {
  const rows = readBeneficiaries();
  const aggregated = aggregateByEik(rows);
  console.log(
    `  ${aggregated.size} beneficiary EIK(s) (post-aggregation across sub-units)`,
  );

  const mpByEik = buildMpByEik();
  const officialsByEik = buildOfficialsByEik();
  console.log(
    `  ${mpByEik.size} MP-linked EIK(s) · ${officialsByEik.size} official-linked EIK(s)`,
  );

  // The "flagged set" = beneficiaries with at least one MP or official link.
  const flaggedEiks = new Set<string>();
  for (const eik of mpByEik.keys())
    if (aggregated.has(eik)) flaggedEiks.add(eik);
  for (const eik of officialsByEik.keys())
    if (aggregated.has(eik)) flaggedEiks.add(eik);

  const procByEik = buildProcurementByEik(flaggedEiks);
  const debarredNames = buildDebarredNames();

  const entries: PoliticalEntry[] = [];
  let mpOnly = 0;
  let officialOnly = 0;
  let both = 0;
  let debarredFlagged = 0;
  let totalProc = 0;

  for (const eik of flaggedEiks) {
    const b = aggregated.get(eik)!;
    const mps = mpByEik.get(eik) ?? [];
    const officials = officialsByEik.get(eik) ?? [];
    const procRow = procByEik.get(eik);
    const procurementEur = procRow?.totalEur ?? 0;
    const procurementContractCount = procRow?.contractCount ?? 0;
    const debarred = debarredNames.has(normalize(b.name));

    if (mps.length > 0 && officials.length > 0) both += 1;
    else if (mps.length > 0) mpOnly += 1;
    else officialOnly += 1;
    if (debarred) debarredFlagged += 1;
    totalProc += procurementEur;

    const entry: PoliticalEntry = {
      eik,
      name: b.name,
      orgType: b.orgType,
      contractCount: b.contractCount,
      contractedEur: round2(b.contractedEur),
      paidEur: round2(b.paidEur),
      mps,
      officials,
      procurementEur: round2(procurementEur),
      procurementContractCount,
      debarred,
      exposureScore: 0,
    };
    entry.exposureScore = computeExposureScore(entry);
    entries.push(entry);
  }

  entries.sort(
    (a, b) =>
      b.contractedEur - a.contractedEur ||
      b.exposureScore - a.exposureScore ||
      a.eik.localeCompare(b.eik),
  );

  let contractedSum = 0;
  let paidSum = 0;
  for (const e of entries) {
    contractedSum += e.contractedEur;
    paidSum += e.paidEur;
  }

  const generatedAt = new Date().toISOString();
  const index: PoliticalIndex = {
    generatedAt,
    totals: {
      flaggedEiks: entries.length,
      mpOnly,
      officialOnly,
      both,
      debarredFlagged,
      contractedEur: round2(contractedSum),
      paidEur: round2(paidSum),
      procurementEur: round2(totalProc),
    },
    top: entries.slice(0, TOP_N),
    flaggedEiks: entries.map((e) => e.eik),
  };

  const shards: PoliticalShard[] = entries.map((entry) => ({
    eik: entry.eik,
    entry,
  }));

  return { index, shards };
};

export const writePoliticalLinks = (data: {
  index: PoliticalIndex;
  shards: PoliticalShard[];
}): void => {
  fs.mkdirSync(DERIVED_DIR, { recursive: true });
  fs.mkdirSync(POLITICAL_SHARD_DIR, { recursive: true });

  // Slim leaderboard.
  writeJsonIfChanged(POLITICAL_FILE, canonicalJson(data.index));

  // Per-EIK shards. Each is one stable document for /company/{eik} to fetch.
  const wanted = new Set<string>();
  for (const s of data.shards) {
    const file = `${s.eik}.json`;
    wanted.add(file);
    writeJsonIfChanged(
      path.join(POLITICAL_SHARD_DIR, file),
      canonicalJson(s.entry),
    );
  }

  // Manifest of flagged EIKs — lets the per-company page skip the fetch when
  // the EIK isn't flagged (and lets the leaderboard page paginate without
  // re-reading the heavy slim index).
  const manifest = canonicalJson({
    generatedAt: data.index.generatedAt,
    flaggedEiks: data.index.flaggedEiks,
  });
  writeJsonIfChanged(path.join(POLITICAL_SHARD_DIR, "index.json"), manifest);

  // Prune stale shards.
  for (const f of fs.readdirSync(POLITICAL_SHARD_DIR)) {
    if (!f.endsWith(".json")) continue;
    if (f === "index.json") continue;
    if (wanted.has(f)) continue;
    fs.unlinkSync(path.join(POLITICAL_SHARD_DIR, f));
  }
};

// CLI entry — runnable standalone, or imported and called from ingest.ts.
const isMain =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMain) {
  console.log("→ building EU-funds political-economy join layer");
  const data = buildPoliticalLinks();
  writePoliticalLinks(data);
  const t = data.index.totals;
  console.log(
    `✓ political_links.json written — ${t.flaggedEiks} flagged ` +
      `(${t.mpOnly} MP-only, ${t.officialOnly} official-only, ${t.both} both, ` +
      `${t.debarredFlagged} debarred)`,
  );
  console.log(
    `  €${Math.round(t.contractedEur).toLocaleString("en-US")} contracted · ` +
      `€${Math.round(t.paidEur).toLocaleString("en-US")} paid · ` +
      `€${Math.round(t.procurementEur).toLocaleString("en-US")} АОП award overlap`,
  );
}
