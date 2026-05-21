// ИСУН EU-funds beneficiary ingest. Downloads the public "Бенефициенти"
// XLSX export from 2020.eufunds.bg, parses the organisation-level rows
// (contracts signed, funds contracted, funds actually paid — all EUR), and
// writes data/funds/.
//
// CLI:
//   tsx scripts/funds/ingest.ts                 # fetch + ingest
//   tsx scripts/funds/ingest.ts --refresh-cache # re-download the export
//   tsx scripts/funds/ingest.ts --file PATH     # ingest a local export
//   tsx scripts/funds/ingest.ts --dry-run       # parse + validate, no writes

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import { fetchBeneficiariesExport, EXPORT_URL } from "./fetch";
import { parseBeneficiaries } from "./parse";
import type {
  FundsBeneficiary,
  FundsBreakdownRow,
  FundsIndex,
  FundsTopRow,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FUNDS_DIR = path.resolve(__dirname, "../../data/funds");
const BENEFICIARIES_DIR = path.join(FUNDS_DIR, "beneficiaries");
const INDEX_FILE = path.join(FUNDS_DIR, "index.json");

const SOURCE_LABEL =
  "ИСУН 2020 — публичен модул, Бенефициенти (2020.eufunds.bg)";
const SOURCE_URL = "https://2020.eufunds.bg/bg/0/0/Beneficiary";
// Floor guard: the full export carries ~52k rows. Anything well below this is
// a truncated / filtered download and must not overwrite the canonical tree.
const MIN_ROWS = 40_000;
const TOP_N = 100;

const canonicalJson = (data: unknown): string =>
  JSON.stringify(data, null, 2) + "\n";

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Shard by EIK last digit (uniform) so each beneficiaries/<k>.json stays
// bounded; null-EIK rows land in "_x".
const shardKey = (eik: string | null): string =>
  eik ? eik[eik.length - 1] : "_x";

// Validate the parsed corpus. Fails loud on truncation and on values that
// signal corruption (non-finite amounts, fractional or negative counts).
// Small negative EUR rollups are a benign upstream artifact — net clawbacks
// and cent-level reconciliation residue — so they're surfaced as a warning,
// not a hard fail.
const validate = (rows: FundsBeneficiary[]): void => {
  if (rows.length < MIN_ROWS) {
    throw new Error(
      `ИСУН ingest: only ${rows.length} beneficiary rows parsed ` +
        `(floor ${MIN_ROWS}) — the export looks truncated; aborting before write`,
    );
  }
  for (const r of rows) {
    if (!Number.isInteger(r.contractCount) || r.contractCount < 0) {
      throw new Error(
        `ИСУН ingest: beneficiary "${r.name}" has invalid contractCount=${r.contractCount}`,
      );
    }
    if (!Number.isFinite(r.contractedEur) || !Number.isFinite(r.paidEur)) {
      throw new Error(
        `ИСУН ingest: beneficiary "${r.name}" has non-finite amount ` +
          `(contracted=${r.contractedEur}, paid=${r.paidEur})`,
      );
    }
  }
  const negatives = rows.filter((r) => r.contractedEur < 0 || r.paidEur < 0);
  if (negatives.length > 0) {
    console.log(
      `  ⚠ ${negatives.length} beneficiary row(s) with a negative EUR rollup ` +
        `(net clawback / rounding residue — kept as-is):`,
    );
    for (const r of negatives.slice(0, 10)) {
      console.log(
        `      ${r.eik ?? "—"} ${r.name}: contracted=${r.contractedEur} paid=${r.paidEur}`,
      );
    }
    if (negatives.length > 10) {
      console.log(`      … and ${negatives.length - 10} more`);
    }
  }
};

const buildBreakdown = (
  rows: FundsBeneficiary[],
  keyOf: (r: FundsBeneficiary) => string,
): FundsBreakdownRow[] => {
  const map = new Map<string, FundsBreakdownRow>();
  for (const r of rows) {
    const key = keyOf(r) || "(не е посочено)";
    const agg = map.get(key) ?? {
      key,
      beneficiaries: 0,
      contractCount: 0,
      contractedEur: 0,
      paidEur: 0,
    };
    agg.beneficiaries += 1;
    agg.contractCount += r.contractCount;
    agg.contractedEur += r.contractedEur;
    agg.paidEur += r.paidEur;
    map.set(key, agg);
  }
  return [...map.values()]
    .map((b) => ({
      ...b,
      contractedEur: round2(b.contractedEur),
      paidEur: round2(b.paidEur),
    }))
    .sort((a, b) => b.contractedEur - a.contractedEur);
};

const topRows = (
  rows: FundsBeneficiary[],
  metric: (r: FundsBeneficiary) => number,
): FundsTopRow[] =>
  [...rows]
    .sort((a, b) => metric(b) - metric(a))
    .slice(0, TOP_N)
    .map((r) => ({
      eik: r.eik,
      name: r.name,
      orgType: r.orgType,
      contractCount: r.contractCount,
      contractedEur: r.contractedEur,
      paidEur: r.paidEur,
    }));

const eur = (n: number): string => `€${Math.round(n).toLocaleString("en-US")}`;

const main = async (args: {
  file?: string;
  refreshCache: boolean;
  dryRun: boolean;
}): Promise<void> => {
  // 1. Acquire the XLSX export.
  let buf: Buffer;
  if (args.file) {
    console.log(`→ reading local export ${args.file}`);
    buf = fs.readFileSync(path.resolve(args.file));
  } else {
    console.log(`→ fetching ${EXPORT_URL}`);
    buf = await fetchBeneficiariesExport({ refresh: args.refreshCache });
  }
  console.log(`  ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  // 2. Parse + validate. parseBeneficiaries throws on header-schema drift.
  const rows = parseBeneficiaries(buf);
  console.log(`  parsed ${rows.length} beneficiary row(s)`);
  validate(rows);

  // 3. Aggregate corpus totals.
  let contractCount = 0;
  let contractedEur = 0;
  let paidEur = 0;
  let withEik = 0;
  for (const r of rows) {
    contractCount += r.contractCount;
    contractedEur += r.contractedEur;
    paidEur += r.paidEur;
    if (r.eik) withEik += 1;
  }

  if (args.dryRun) {
    console.log(
      `✓ dry run: ${rows.length} beneficiaries, ${contractCount} contracts, ` +
        `${eur(contractedEur)} contracted — not written`,
    );
    return;
  }

  // 4. Shard beneficiaries by EIK last digit for stable, bounded files.
  fs.mkdirSync(BENEFICIARIES_DIR, { recursive: true });
  const byShard = new Map<string, FundsBeneficiary[]>();
  for (const r of rows) {
    const k = shardKey(r.eik);
    const arr = byShard.get(k) ?? [];
    arr.push(r);
    byShard.set(k, arr);
  }
  const sortRows = (a: FundsBeneficiary, b: FundsBeneficiary): number =>
    (a.eik ?? "").localeCompare(b.eik ?? "") ||
    a.name.localeCompare(b.name, "bg");
  const shards = [...byShard.keys()].sort();
  for (const k of shards) {
    const arr = byShard.get(k)!.sort(sortRows);
    fs.writeFileSync(
      path.join(BENEFICIARIES_DIR, `${k}.json`),
      canonicalJson(arr),
    );
  }
  // Prune shard files no longer produced (defensive — shard set is stable).
  for (const f of fs.readdirSync(BENEFICIARIES_DIR)) {
    const m = f.match(/^(.+)\.json$/);
    if (m && !shards.includes(m[1])) {
      fs.rmSync(path.join(BENEFICIARIES_DIR, f));
    }
  }
  console.log(`→ wrote ${shards.length} beneficiary shard(s)`);

  // 5. Index.
  const now = new Date().toISOString();
  const index: FundsIndex = {
    generatedAt: now,
    lastIngest: now,
    source: { label: SOURCE_LABEL, url: SOURCE_URL },
    totals: {
      beneficiaries: rows.length,
      contractCount,
      contractedEur: round2(contractedEur),
      paidEur: round2(paidEur),
      withEik,
    },
    byOrgType: buildBreakdown(rows, (r) => r.orgType),
    byOrgForm: buildBreakdown(rows, (r) => r.orgForm),
    topByContracted: topRows(rows, (r) => r.contractedEur),
    topByPaid: topRows(rows, (r) => r.paidEur),
    shards,
  };
  fs.writeFileSync(INDEX_FILE, canonicalJson(index));
  console.log(`✓ index.json written`);
  console.log(
    `  ${rows.length} beneficiaries · ${contractCount} contracts · ` +
      `${eur(contractedEur)} contracted · ${eur(paidEur)} paid · ` +
      `${withEik} with EIK (${((withEik / rows.length) * 100).toFixed(1)}%)`,
  );
};

const cli = command({
  name: "funds-ingest",
  args: {
    file: option({
      type: optional(string),
      long: "file",
      description:
        "Ingest a local XLSX export instead of fetching (e.g. a date-filtered one)",
    }),
    refreshCache: flag({
      type: optional(boolean),
      long: "refresh-cache",
      description: "Re-download the export even when a cached copy exists",
      defaultValue: () => false,
    }),
    dryRun: flag({
      type: optional(boolean),
      long: "dry-run",
      description: "Parse + validate but do not write files",
      defaultValue: () => false,
    }),
  },
  handler: (args) =>
    main({
      file: args.file,
      refreshCache: !!args.refreshCache,
      dryRun: !!args.dryRun,
    }),
});

run(cli, process.argv.slice(2));
