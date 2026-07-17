// Build the Phase-8 focus / theme derivatives.
//
// For each editorial theme defined in data/funds/themes.json, scan every
// programme shard for contracts that match the theme's keyword filter or
// programme-code filter, then emit a slim per-theme shard with the matching
// totals, top beneficiaries, top contracts, top municipalities, and the
// programme breakdown.
//
// Folded into funds:ingest-projects. Standalone via:
//   npx tsx scripts/funds/themes.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const FUNDS_DIR = path.join(ROOT, "data/funds");
const THEMES_DEF_FILE = path.join(FUNDS_DIR, "themes.json");
const PROJECTS_INDEX = path.join(FUNDS_DIR, "projects/index.json");
const BY_PROGRAM_DIR = path.join(FUNDS_DIR, "projects/by-program");
const THEMES_DIR = path.join(FUNDS_DIR, "derived/themes");

const TOP_BENEFICIARIES = 15;
const TOP_CONTRACTS = 10;
const TOP_MUNIS = 15;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const canonicalJson = (data: unknown): string =>
  JSON.stringify(data, null, 2) + "\n";

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[„""'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ---- Schemas (input) ----

interface ThemeInvestigativeCard {
  outlet: string;
  title: string;
  url: string;
}

interface ThemeDefinition {
  slug: string;
  labelBg: string;
  labelEn: string;
  summaryBg: string;
  summaryEn: string;
  icon: string;
  titleKeywords?: string[];
  programCodes?: string[];
  investigativeCards: ThemeInvestigativeCard[];
}

interface ThemesDefFile {
  description: string;
  themes: ThemeDefinition[];
}

interface ProjectsIndex {
  byProgram: Array<{
    programCode: string;
    programName: string;
  }>;
}

interface ContractRow {
  beneficiaryEik: string | null;
  beneficiaryName: string;
  totalEur: number;
  paidEur: number;
  status: string;
  title: string;
  contractNumber: string;
  programCode: string;
  programName: string;
  location: {
    kind: string;
    raw: string;
    munis?: string[];
    ekatte?: string;
  };
}

interface ProgramShard {
  programCode: string;
  programName: string;
  contracts: ContractRow[];
}

// ---- Output ----

export interface ThemeBeneficiary {
  eik: string | null;
  name: string;
  contractCount: number;
  totalEur: number;
  paidEur: number;
}

export interface ThemeProgramme {
  programCode: string;
  programName: string;
  contractCount: number;
  totalEur: number;
  paidEur: number;
}

export interface ThemeMuni {
  muni: string;
  contractCount: number;
  totalEur: number;
}

export interface ThemeContract {
  contractNumber: string;
  title: string;
  beneficiaryEik: string | null;
  beneficiaryName: string;
  programCode: string;
  programName: string;
  totalEur: number;
  paidEur: number;
  status: string;
  locationRaw: string;
}

export interface ThemeShard {
  slug: string;
  labelBg: string;
  labelEn: string;
  summaryBg: string;
  summaryEn: string;
  icon: string;
  totals: {
    contractCount: number;
    beneficiaryCount: number;
    totalEur: number;
    paidEur: number;
  };
  topBeneficiaries: ThemeBeneficiary[];
  topContracts: ThemeContract[];
  topMunis: ThemeMuni[];
  programmes: ThemeProgramme[];
  investigativeCards: ThemeInvestigativeCard[];
}

export interface ThemesIndex {
  generatedAt: string;
  themes: Array<{
    slug: string;
    labelBg: string;
    labelEn: string;
    summaryBg: string;
    summaryEn: string;
    icon: string;
    contractCount: number;
    totalEur: number;
    paidEur: number;
    beneficiaryCount: number;
  }>;
}

// ---- Helpers ----

const buildKeywordMatcher = (
  keywords: string[],
): ((title: string) => boolean) => {
  if (!keywords || keywords.length === 0) return () => false;
  const normalised = keywords.map((k) => normalize(k));
  return (title: string) => {
    const t = normalize(title);
    return normalised.some((k) => t.includes(k));
  };
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

// ---- Build ----

export const buildThemes = (): {
  index: ThemesIndex;
  shards: ThemeShard[];
} => {
  if (!fs.existsSync(THEMES_DEF_FILE)) {
    throw new Error(`themes: ${THEMES_DEF_FILE} missing`);
  }
  if (!fs.existsSync(PROJECTS_INDEX)) {
    throw new Error(
      `themes: ${PROJECTS_INDEX} missing — run funds:ingest-projects first`,
    );
  }

  const def = JSON.parse(
    fs.readFileSync(THEMES_DEF_FILE, "utf8"),
  ) as ThemesDefFile;
  const projects = JSON.parse(
    fs.readFileSync(PROJECTS_INDEX, "utf8"),
  ) as ProjectsIndex;

  // Pre-build matchers + bucket maps per theme.
  interface ThemeBucket {
    def: ThemeDefinition;
    matchKeyword: (title: string) => boolean;
    programCodeSet: Set<string>;
    contracts: ContractRow[];
  }
  const buckets: ThemeBucket[] = def.themes.map((d) => ({
    def: d,
    matchKeyword: buildKeywordMatcher(d.titleKeywords ?? []),
    programCodeSet: new Set(d.programCodes ?? []),
    contracts: [],
  }));

  // Single pass over every per-program shard — for each contract row, append
  // to every theme bucket it matches.
  for (const p of projects.byProgram) {
    const file = path.join(BY_PROGRAM_DIR, `${p.programCode}.json`);
    if (!fs.existsSync(file)) continue;
    let shard: ProgramShard;
    try {
      shard = JSON.parse(fs.readFileSync(file, "utf8")) as ProgramShard;
    } catch {
      continue;
    }
    for (const c of shard.contracts ?? []) {
      for (const b of buckets) {
        const byCode = b.programCodeSet.has(c.programCode);
        const byKeyword = b.matchKeyword(c.title);
        if (!byCode && !byKeyword) continue;
        b.contracts.push(c);
      }
    }
  }

  const shards: ThemeShard[] = [];
  for (const b of buckets) {
    shards.push(buildThemeShard(b.def, b.contracts));
  }

  const index: ThemesIndex = {
    generatedAt: new Date().toISOString(),
    themes: shards.map((s) => ({
      slug: s.slug,
      labelBg: s.labelBg,
      labelEn: s.labelEn,
      summaryBg: s.summaryBg,
      summaryEn: s.summaryEn,
      icon: s.icon,
      contractCount: s.totals.contractCount,
      totalEur: s.totals.totalEur,
      paidEur: s.totals.paidEur,
      beneficiaryCount: s.totals.beneficiaryCount,
    })),
  };

  return { index, shards };
};

const buildThemeShard = (
  def: ThemeDefinition,
  contracts: ContractRow[],
): ThemeShard => {
  let totalEur = 0;
  let paidEur = 0;
  const byEik = new Map<
    string,
    {
      eik: string | null;
      name: string;
      contractCount: number;
      totalEur: number;
      paidEur: number;
    }
  >();
  const byProgramme = new Map<
    string,
    {
      programCode: string;
      programName: string;
      contractCount: number;
      totalEur: number;
      paidEur: number;
    }
  >();
  const byMuni = new Map<
    string,
    { muni: string; contractCount: number; totalEur: number }
  >();

  for (const c of contracts) {
    totalEur += c.totalEur;
    paidEur += c.paidEur;

    const eikKey =
      c.beneficiaryEik ?? `__null__:${normalize(c.beneficiaryName)}`;
    const prev = byEik.get(eikKey);
    if (!prev) {
      byEik.set(eikKey, {
        eik: c.beneficiaryEik,
        name: c.beneficiaryName,
        contractCount: 1,
        totalEur: c.totalEur,
        paidEur: c.paidEur,
      });
    } else {
      prev.contractCount += 1;
      prev.totalEur += c.totalEur;
      prev.paidEur += c.paidEur;
    }

    const progPrev = byProgramme.get(c.programCode);
    if (!progPrev) {
      byProgramme.set(c.programCode, {
        programCode: c.programCode,
        programName: c.programName,
        contractCount: 1,
        totalEur: c.totalEur,
        paidEur: c.paidEur,
      });
    } else {
      progPrev.contractCount += 1;
      progPrev.totalEur += c.totalEur;
      progPrev.paidEur += c.paidEur;
    }

    if (c.location?.munis && c.location.munis.length > 0) {
      // A row naming N муни is listed under each but carries only 1/N of its
      // money — the shared even split (see muniShare). Full value per муни
      // would invent spend.
      const shareEur = c.totalEur * muniShare(c);
      for (const muni of new Set(c.location.munis)) {
        const m = byMuni.get(muni);
        if (!m) {
          byMuni.set(muni, { muni, contractCount: 1, totalEur: shareEur });
        } else {
          m.contractCount += 1;
          m.totalEur += shareEur;
        }
      }
    }
  }

  const topBeneficiaries: ThemeBeneficiary[] = [...byEik.values()]
    .map((b) => ({
      ...b,
      totalEur: round2(b.totalEur),
      paidEur: round2(b.paidEur),
    }))
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, TOP_BENEFICIARIES);

  const programmes: ThemeProgramme[] = [...byProgramme.values()]
    .map((p) => ({
      ...p,
      totalEur: round2(p.totalEur),
      paidEur: round2(p.paidEur),
    }))
    .sort((a, b) => b.totalEur - a.totalEur);

  const topMunis: ThemeMuni[] = [...byMuni.values()]
    .map((m) => ({ ...m, totalEur: round2(m.totalEur) }))
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, TOP_MUNIS);

  const topContracts: ThemeContract[] = [...contracts]
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, TOP_CONTRACTS)
    .map((c) => ({
      contractNumber: c.contractNumber,
      title: c.title,
      beneficiaryEik: c.beneficiaryEik,
      beneficiaryName: c.beneficiaryName,
      programCode: c.programCode,
      programName: c.programName,
      totalEur: round2(c.totalEur),
      paidEur: round2(c.paidEur),
      status: c.status,
      locationRaw: c.location?.raw ?? "",
    }));

  return {
    slug: def.slug,
    labelBg: def.labelBg,
    labelEn: def.labelEn,
    summaryBg: def.summaryBg,
    summaryEn: def.summaryEn,
    icon: def.icon,
    totals: {
      contractCount: contracts.length,
      beneficiaryCount: byEik.size,
      totalEur: round2(totalEur),
      paidEur: round2(paidEur),
    },
    topBeneficiaries,
    topContracts,
    topMunis,
    programmes,
    investigativeCards: def.investigativeCards ?? [],
  };
};

export const writeThemes = (data: {
  index: ThemesIndex;
  shards: ThemeShard[];
}): void => {
  fs.mkdirSync(THEMES_DIR, { recursive: true });
  writeJsonIfChanged(
    path.join(THEMES_DIR, "index.json"),
    canonicalJson(data.index),
  );

  const wanted = new Set<string>();
  for (const s of data.shards) {
    const f = `${s.slug}.json`;
    wanted.add(f);
    writeJsonIfChanged(path.join(THEMES_DIR, f), canonicalJson(s));
  }
  for (const f of fs.readdirSync(THEMES_DIR)) {
    if (!f.endsWith(".json")) continue;
    if (f === "index.json") continue;
    if (wanted.has(f)) continue;
    fs.unlinkSync(path.join(THEMES_DIR, f));
  }
};

const isMain =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMain) {
  console.log("→ building EU-funds focus themes");
  const data = buildThemes();
  writeThemes(data);
  for (const s of data.shards) {
    console.log(
      `  ${s.slug}: ${s.totals.contractCount} contracts · €${Math.round(s.totals.totalEur).toLocaleString("en-US")} contracted · ${s.totals.beneficiaryCount} beneficiaries`,
    );
  }
}
