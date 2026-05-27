// Build the Phase-6 derived shards from the already-ingested contract corpus:
//   data/funds/derived/sankey.json        — Fund → OP → top-N beneficiaries
//   data/funds/derived/absorption.json    — Per period + per programme
//                                            contracted / paid / absorption %
//   data/funds/taxonomy.json              — Per programme code: period, fund
//                                            type, bucket label (slim lookup)
//
// All reads come from /data/funds/projects/* (already written by the
// projects ingest). No external fetch. Standalone runnable:
//   npx tsx scripts/funds/build_taxonomy_derivatives.ts
// Folded into the funds:ingest-projects chain.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  inferTaxonomy,
  allPeriods,
  type FundsPeriod,
  type FundType,
  type ProgrammeTaxonomy,
} from "./taxonomy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const FUNDS_DIR = path.join(ROOT, "data/funds");
const PROJECTS_INDEX = path.join(FUNDS_DIR, "projects/index.json");
const DERIVED_DIR = path.join(FUNDS_DIR, "derived");
const TAXONOMY_FILE = path.join(FUNDS_DIR, "taxonomy.json");
const SANKEY_FILE = path.join(DERIVED_DIR, "sankey.json");
const ABSORPTION_FILE = path.join(DERIVED_DIR, "absorption.json");

// Sankey-readability budget. d3-sankey divides the available vertical extent
// by the densest column's node count; if leaves overflow, every node height
// collapses to 0. Cap the programme-per-fund count tight — the beneficiary
// tier would explode the leaf column past the readability cliff, so we
// stop at Fund → Programme. The Top-N beneficiaries already render
// elsewhere on the page (TopProgramsTile drills into them).
const TOP_PROGRAMMES_PER_FUND = 6;

interface ProjectsIndex {
  byProgram: Array<{
    programCode: string;
    programName: string;
    rollup: {
      contractCount: number;
      beneficiaryCount: number;
      totalEur: number;
      grantEur: number;
      paidEur: number;
    };
  }>;
}

const canonicalJson = (data: unknown): string =>
  JSON.stringify(data, null, 2) + "\n";
const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface TaxonomyFile {
  generatedAt: string;
  programmes: Array<
    ProgrammeTaxonomy & {
      programCode: string;
      programName: string;
      contractCount: number;
      totalEur: number;
      paidEur: number;
    }
  >;
}

export interface SankeyNode {
  id: string; // unique node id
  kind: "fund" | "programme" | "beneficiary";
  label: string;
  totalEur: number;
  // For programme nodes — short period + fund chip ("ERDF 2014-20").
  bucket?: string;
  // For beneficiary nodes — EIK if available (for the /company link).
  eik?: string | null;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number; // EUR
}

export interface SankeyFile {
  generatedAt: string;
  totalContracted: number;
  topN: number;
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface AbsorptionRow {
  contractedEur: number;
  paidEur: number;
  absorptionPct: number;
  contractCount: number;
}

export interface AbsorptionFile {
  generatedAt: string;
  byPeriod: Record<FundsPeriod, AbsorptionRow>;
  byFundType: Record<FundType, AbsorptionRow>;
  byBucket: Array<{
    bucket: string;
    period: FundsPeriod;
    fundType: FundType;
    contractedEur: number;
    paidEur: number;
    absorptionPct: number;
    contractCount: number;
  }>;
  byProgramme: Array<{
    programCode: string;
    programName: string;
    period: FundsPeriod;
    fundType: FundType;
    contractedEur: number;
    paidEur: number;
    absorptionPct: number;
    contractCount: number;
  }>;
}

const emptyAbsorptionRow = (): AbsorptionRow => ({
  contractedEur: 0,
  paidEur: 0,
  absorptionPct: 0,
  contractCount: 0,
});

const writeIfChanged = (file: string, content: string): boolean => {
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

const finalizePct = (row: AbsorptionRow): void => {
  row.contractedEur = round2(row.contractedEur);
  row.paidEur = round2(row.paidEur);
  row.absorptionPct =
    row.contractedEur > 0 ? round2((row.paidEur / row.contractedEur) * 100) : 0;
};

const buildTaxonomy = (idx: ProjectsIndex): TaxonomyFile => {
  const programmes = idx.byProgram
    .map((p) => {
      const t = inferTaxonomy(p.programCode);
      return {
        ...t,
        programCode: p.programCode,
        programName: p.programName,
        contractCount: p.rollup.contractCount,
        totalEur: round2(p.rollup.totalEur),
        paidEur: round2(p.rollup.paidEur),
      };
    })
    .sort((a, b) => b.totalEur - a.totalEur);
  return {
    generatedAt: new Date().toISOString(),
    programmes,
  };
};

const buildAbsorption = (idx: ProjectsIndex): AbsorptionFile => {
  const byPeriod = Object.fromEntries(
    allPeriods.map((p) => [p, emptyAbsorptionRow()]),
  ) as Record<FundsPeriod, AbsorptionRow>;
  const byFundType = new Map<FundType, AbsorptionRow>();
  const byBucket = new Map<
    string,
    {
      bucket: string;
      period: FundsPeriod;
      fundType: FundType;
      contractedEur: number;
      paidEur: number;
      absorptionPct: number;
      contractCount: number;
    }
  >();
  const byProgramme: AbsorptionFile["byProgramme"] = [];

  for (const p of idx.byProgram) {
    const t = inferTaxonomy(p.programCode);
    const total = p.rollup.totalEur;
    const paid = p.rollup.paidEur;
    const count = p.rollup.contractCount;

    byPeriod[t.period].contractedEur += total;
    byPeriod[t.period].paidEur += paid;
    byPeriod[t.period].contractCount += count;

    const ft = byFundType.get(t.fundType) ?? emptyAbsorptionRow();
    ft.contractedEur += total;
    ft.paidEur += paid;
    ft.contractCount += count;
    byFundType.set(t.fundType, ft);

    const bk = byBucket.get(t.bucket) ?? {
      bucket: t.bucket,
      period: t.period,
      fundType: t.fundType,
      contractedEur: 0,
      paidEur: 0,
      absorptionPct: 0,
      contractCount: 0,
    };
    bk.contractedEur += total;
    bk.paidEur += paid;
    bk.contractCount += count;
    byBucket.set(t.bucket, bk);

    byProgramme.push({
      programCode: p.programCode,
      programName: p.programName,
      period: t.period,
      fundType: t.fundType,
      contractedEur: round2(total),
      paidEur: round2(paid),
      absorptionPct: total > 0 ? round2((paid / total) * 100) : 0,
      contractCount: count,
    });
  }

  for (const row of Object.values(byPeriod)) finalizePct(row);
  const byFundTypeOut = {} as Record<FundType, AbsorptionRow>;
  for (const [k, row] of byFundType) {
    finalizePct(row);
    byFundTypeOut[k] = row;
  }
  const byBucketOut = [...byBucket.values()]
    .map((b) => {
      b.contractedEur = round2(b.contractedEur);
      b.paidEur = round2(b.paidEur);
      b.absorptionPct =
        b.contractedEur > 0 ? round2((b.paidEur / b.contractedEur) * 100) : 0;
      return b;
    })
    .sort((a, b) => b.contractedEur - a.contractedEur);
  byProgramme.sort((a, b) => b.contractedEur - a.contractedEur);

  return {
    generatedAt: new Date().toISOString(),
    byPeriod,
    byFundType: byFundTypeOut,
    byBucket: byBucketOut,
    byProgramme,
  };
};

const buildSankey = (idx: ProjectsIndex): SankeyFile => {
  // Group programmes by fund-type so the Sankey root has one node per
  // structural-fund family.
  const programmesByFund = new Map<
    FundType,
    Array<{
      programCode: string;
      programName: string;
      totalEur: number;
      period: FundsPeriod;
    }>
  >();
  let totalContracted = 0;
  for (const p of idx.byProgram) {
    const t = inferTaxonomy(p.programCode);
    const arr = programmesByFund.get(t.fundType) ?? [];
    arr.push({
      programCode: p.programCode,
      programName: p.programName,
      totalEur: p.rollup.totalEur,
      period: t.period,
    });
    programmesByFund.set(t.fundType, arr);
    totalContracted += p.rollup.totalEur;
  }

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const nodeIds = new Set<string>();
  const addNode = (n: SankeyNode): void => {
    if (nodeIds.has(n.id)) return;
    nodeIds.add(n.id);
    nodes.push(n);
  };

  // Tier 1: fund-family nodes — emit ONLY funds that actually have a
  // top-programme to flow into (avoids dangling fund nodes in the layout).
  const programmeKeptIds = new Map<string, SankeyNode>(); // programCode → node
  const fundTotalsKept = new Map<FundType, number>();

  // Tier 2: top-N programmes per fund. We deliberately drop "(other
  // programmes)" rollups — they were dragging d3-sankey's leaf-column
  // density past the point where node heights stay non-zero.
  for (const [fundType, progs] of programmesByFund) {
    const sorted = [...progs].sort((a, b) => b.totalEur - a.totalEur);
    const keep = sorted.slice(0, TOP_PROGRAMMES_PER_FUND);
    if (keep.length === 0) continue;
    let totalForFund = 0;
    for (const p of keep) totalForFund += p.totalEur;
    fundTotalsKept.set(fundType, totalForFund);

    const fundNode: SankeyNode = {
      id: `fund:${fundType}`,
      kind: "fund",
      label: fundType === "RRP" ? "RRP (ПВУ)" : fundType,
      totalEur: round2(totalForFund),
    };
    addNode(fundNode);

    for (const p of keep) {
      const t = inferTaxonomy(p.programCode);
      const node: SankeyNode = {
        id: `prog:${p.programCode}`,
        kind: "programme",
        label: p.programName,
        totalEur: round2(p.totalEur),
        bucket: t.bucket,
      };
      addNode(node);
      programmeKeptIds.set(p.programCode, node);
      links.push({
        source: fundNode.id,
        target: node.id,
        value: round2(p.totalEur),
      });
    }
  }

  // Tier 3 (beneficiaries) intentionally omitted — see TOP_PROGRAMMES_PER_FUND.
  void programmeKeptIds;

  return {
    generatedAt: new Date().toISOString(),
    totalContracted: round2(totalContracted),
    topN: TOP_PROGRAMMES_PER_FUND,
    nodes,
    links,
  };
};

export const buildAll = (): {
  taxonomy: TaxonomyFile;
  absorption: AbsorptionFile;
  sankey: SankeyFile;
} => {
  if (!fs.existsSync(PROJECTS_INDEX)) {
    throw new Error(
      `Phase-6 derivatives: ${PROJECTS_INDEX} missing — run funds:ingest-projects first`,
    );
  }
  const idx = JSON.parse(
    fs.readFileSync(PROJECTS_INDEX, "utf8"),
  ) as ProjectsIndex;
  const taxonomy = buildTaxonomy(idx);
  const absorption = buildAbsorption(idx);
  const sankey = buildSankey(idx);
  return { taxonomy, absorption, sankey };
};

export const writeAll = (data: {
  taxonomy: TaxonomyFile;
  absorption: AbsorptionFile;
  sankey: SankeyFile;
}): void => {
  fs.mkdirSync(DERIVED_DIR, { recursive: true });
  writeIfChanged(TAXONOMY_FILE, canonicalJson(data.taxonomy));
  writeIfChanged(ABSORPTION_FILE, canonicalJson(data.absorption));
  writeIfChanged(SANKEY_FILE, canonicalJson(data.sankey));
};

const isMain =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMain) {
  console.log(
    "→ building Phase-6 derivatives (taxonomy + absorption + Sankey)",
  );
  const data = buildAll();
  writeAll(data);
  const totals = data.absorption.byPeriod;
  console.log(
    `✓ taxonomy.json  ${data.taxonomy.programmes.length} programme(s)`,
  );
  for (const [p, row] of Object.entries(totals)) {
    if (row.contractCount === 0) continue;
    console.log(
      `  ${p}: ${row.contractCount} contracts · €${Math.round(row.contractedEur).toLocaleString("en-US")} contracted · ${row.absorptionPct.toFixed(1)}% absorbed`,
    );
  }
  console.log(
    `✓ sankey.json    ${data.sankey.nodes.length} node(s), ${data.sankey.links.length} link(s)`,
  );
  console.log(
    `✓ absorption.json ${data.absorption.byProgramme.length} programme rows`,
  );
}
