// ИСУН EU-funds beneficiary ingest. Downloads the public "Бенефициенти"
// XLSX export from 2020.eufunds.bg, parses the organisation-level rows
// (contracts signed, funds contracted, funds actually paid — all EUR), and
// writes data/funds/.
//
// CLI:
//   tsx scripts/funds/ingest.ts              # fetch fresh + ingest
//   tsx scripts/funds/ingest.ts --file PATH  # ingest a local export instead
//   tsx scripts/funds/ingest.ts --dry-run    # parse + validate, no writes

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import { fetchBeneficiariesExport, EXPORT_URL } from "./fetch";
import { parseBeneficiaries } from "./parse";
import {
  buildEikLinkageMap,
  buildMpConnected,
  writeMpConnected,
} from "./cross_reference";
import { buildPoliticalLinks, writePoliticalLinks } from "./political_links";
import type {
  FundsBeneficiary,
  FundsBreakdownRow,
  FundsCrossRefSummary,
  FundsIndex,
  FundsTopRow,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FUNDS_DIR = path.resolve(__dirname, "../../data/funds");
const BENEFICIARIES_DIR = path.join(FUNDS_DIR, "beneficiaries");
const BENEFICIARIES_BY_EIK_DIR = path.join(FUNDS_DIR, "beneficiaries-by-eik");
const DERIVED_DIR = path.join(FUNDS_DIR, "derived");
const INDEX_FILE = path.join(FUNDS_DIR, "index.json");
const COMPANIES_INDEX = path.resolve(
  __dirname,
  "../../data/parliament/companies-index.json",
);

const SOURCE_LABEL =
  "ИСУН 2020 — публичен модул, Бенефициенти (2020.eufunds.bg)";
const SOURCE_URL = "https://2020.eufunds.bg/bg/0/0/Beneficiary";
// Floor guard: the full export carries ~52k rows. Anything well below this is
// a truncated / filtered download and must not overwrite the canonical tree.
const MIN_ROWS = 40_000;
// Size of the top-beneficiary list embedded in index.json. Kept small — the
// dashboard renders ~15; the full corpus lives in the beneficiaries shards.
const TOP_N = 25;

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
  mpTiedByEik: Map<string, number[]>,
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
      mpTied: r.eik ? mpTiedByEik.has(r.eik) : false,
      mpIds: (r.eik && mpTiedByEik.get(r.eik)) || [],
    }));

const eur = (n: number): string => `€${Math.round(n).toLocaleString("en-US")}`;

const main = async (args: {
  file?: string;
  dryRun: boolean;
}): Promise<void> => {
  // 1. Acquire the XLSX export.
  let buf: Buffer;
  if (args.file) {
    console.log(`→ reading local export ${args.file}`);
    buf = fs.readFileSync(path.resolve(args.file));
  } else {
    console.log(`→ fetching ${EXPORT_URL}`);
    buf = await fetchBeneficiariesExport();
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

  // 4b. Per-EIK files — one small JSON per beneficiary EIK for O(1) lookup
  // on the /company/{EIK} page (so it does not pull a ~1.5 MB shard to
  // read one row). Gitignored and uploaded to the bucket, same convention
  // as the procurement per-contractor files.
  //
  // ИСУН lists sub-units (райони, териториални поделения, клонове) as
  // separate rows sharing the parent's EIK — e.g. EIK 000471504 has the
  // main "Община Пловдив" row plus 6 separate райони rows. Aggregate by
  // EIK first so the file carries the true per-EIK total. Without this,
  // /company/{eik} reads only whichever sub-unit was written last and
  // displays a fraction of the real funds amount.
  fs.rmSync(BENEFICIARIES_BY_EIK_DIR, { recursive: true, force: true });
  fs.mkdirSync(BENEFICIARIES_BY_EIK_DIR, { recursive: true });
  interface AggregatedByEik {
    eik: string;
    name: string;
    orgType: string;
    orgKind: string;
    orgForm: string;
    contractCount: number;
    contractedEur: number;
    paidEur: number;
    subUnits: string[]; // distinct names that fold into this EIK
  }
  const aggByEik = new Map<string, AggregatedByEik>();
  for (const r of rows) {
    if (!r.eik) continue;
    const prev = aggByEik.get(r.eik);
    if (!prev) {
      aggByEik.set(r.eik, {
        eik: r.eik,
        name: r.name,
        orgType: r.orgType,
        orgKind: r.orgKind,
        orgForm: r.orgForm,
        contractCount: r.contractCount,
        contractedEur: r.contractedEur,
        paidEur: r.paidEur,
        subUnits: [r.name],
      });
      continue;
    }
    // Keep the row with the largest contracted value as the canonical
    // header — that's the parent unit in the vast majority of cases.
    if (r.contractedEur > prev.contractedEur) {
      prev.name = r.name;
      prev.orgType = r.orgType;
      prev.orgKind = r.orgKind;
      prev.orgForm = r.orgForm;
    }
    prev.contractCount += r.contractCount;
    prev.contractedEur += r.contractedEur;
    prev.paidEur += r.paidEur;
    if (!prev.subUnits.includes(r.name)) prev.subUnits.push(r.name);
  }
  for (const agg of aggByEik.values()) {
    // Drop subUnits when there's only the parent — keeps the canonical
    // 1-unit file shape unchanged.
    const out: AggregatedByEik | Omit<AggregatedByEik, "subUnits"> =
      agg.subUnits.length > 1
        ? agg
        : (() => {
            // strip subUnits field
            const rest = { ...agg };
            // @ts-expect-error: dynamic delete on widened type
            delete rest.subUnits;
            return rest;
          })();
    // Round amounts the same way the shards do — keeps the file diff-stable.
    const final = {
      ...out,
      contractedEur: round2(agg.contractedEur),
      paidEur: round2(agg.paidEur),
    };
    fs.writeFileSync(
      path.join(BENEFICIARIES_BY_EIK_DIR, `${agg.eik}.json`),
      canonicalJson(final),
    );
  }
  console.log(`→ wrote ${aggByEik.size} per-EIK beneficiary file(s)`);

  // 5. Cross-reference beneficiaries against the MP-companies graph. Optional:
  // if companies-index.json is absent (fresh clone before /update-connections)
  // the raw beneficiary data still lands; only the MP-tied payload is skipped.
  let crossReference: FundsCrossRefSummary | undefined;
  const mpTiedByEik = new Map<string, number[]>();
  if (fs.existsSync(COMPANIES_INDEX)) {
    console.log(
      `→ cross-referencing beneficiaries against the MP-companies graph`,
    );
    const linkageMap = buildEikLinkageMap(COMPANIES_INDEX);
    console.log(
      `  EIK linkage map: ${linkageMap.byEik.size} EIK(s) from ` +
        `${linkageMap.companiesWithUic}/${linkageMap.totalCompanies} TR-enriched companies`,
    );
    const mpConnected = buildMpConnected(rows, linkageMap);
    writeMpConnected(DERIVED_DIR, mpConnected);
    for (const e of mpConnected.entries) {
      const arr = mpTiedByEik.get(e.beneficiaryEik) ?? [];
      if (!arr.includes(e.mpId)) arr.push(e.mpId);
      mpTiedByEik.set(e.beneficiaryEik, arr);
    }
    crossReference = {
      generatedAt: mpConnected.generatedAt,
      mpCount: mpConnected.mpCount,
      beneficiaryCount: mpConnected.beneficiaryCount,
      pairCount: mpConnected.total,
      contractedEur: mpConnected.contractedEur,
      paidEur: mpConnected.paidEur,
    };
    console.log(
      `  ${mpConnected.total} MP↔beneficiary pair(s) → derived/mp_connected.json ` +
        `(${mpConnected.mpCount} MP(s), ${mpConnected.beneficiaryCount} company(ies), ` +
        `${eur(mpConnected.contractedEur)} contracted)`,
    );
  } else {
    console.log(
      `  companies-index.json missing — skipping cross-reference ` +
        `(run /update-connections to enable the MP-tied payload)`,
    );
  }

  // 5b. Political-economy join layer — fold MP + officials + procurement +
  // debarred into one derived shard set keyed by beneficiary EIK. Cheap
  // (reads already-written files), no external fetch, so always runs after
  // the beneficiary shards land. Skipped if neither MP nor officials links
  // are present (fresh clone before /update-connections or /update-officials).
  if (
    fs.existsSync(COMPANIES_INDEX) ||
    fs.existsSync(
      path.resolve(
        __dirname,
        "../../data/officials/derived/company_links.json",
      ),
    )
  ) {
    console.log(`→ building political-economy join layer`);
    const data = buildPoliticalLinks();
    writePoliticalLinks(data);
    const t = data.index.totals;
    console.log(
      `  ${t.flaggedEiks} flagged EIK(s) (${t.mpOnly} MP-only, ` +
        `${t.officialOnly} official-only, ${t.both} both, ${t.debarredFlagged} debarred) ` +
        `→ derived/political_links.json + ${data.shards.length} per-EIK shard(s)`,
    );
  } else {
    console.log(
      `  officials + companies-index missing — skipping political-economy join`,
    );
  }

  // 6. Index.
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
    topByContracted: topRows(rows, (r) => r.contractedEur, mpTiedByEik),
    ...(crossReference ? { crossReference } : {}),
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
      dryRun: !!args.dryRun,
    }),
});

run(cli, process.argv.slice(2));
