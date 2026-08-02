// Build the ИСУН **procedure** grain — the level between a programme and a
// single contract.
//
// A contract number is `{procedure}-{NNNN}[-C{NN}]`, e.g.
// `BG16RFOP002-2.089-3686-C01` belongs to procedure `BG16RFOP002-2.089` under
// programme `2014BG16RFOP002`. ИСУН publishes no procedure register of its own,
// so the grain is derived from the contract numbers we already hold.
//
// It matters because it is the grain people actually search. Every beneficiary
// of an ОПИК scheme must publish a mandated-publicity page naming its procedure
// code, so the search tail for `BG16RFOP002-2.089` is thousands of pages deep
// and we had no page on it at all — only the €2.23bn programme above it, which
// answers a question nobody asked.
//
// The shards are a BUILD artifact, not a fetchable path: the funds tree is
// PG-only (bucket:sync excludes ^funds/.*), so they reach a page through
// `fund_payloads(kind='procedure')` via scripts/db/load_funds_pg.ts. The
// prerender reads them straight off disk.
//
// Each shard caps its lists (see TOP_* below) because it backs the prerendered
// body, not the interactive one. A paginated full beneficiary list — 23,621 on
// BG16RFOP002-2.073 — must come from the per-contract `fund_projects` table
// filtered on the procedure prefix, never from here.
//
// Folded into funds:ingest-projects. Standalone (reads the committed programme
// shards, no re-fetch) via:
//   npm run funds:procedures

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  canonicalJson,
  loadOblastByMuni,
  resetDir,
  rollupTopMunis,
  round2,
  statusBucket,
} from "./projects_share";
import type {
  FundsProjectsProcedureSummary,
  FundsProjectsProceduresIndex,
  ProcedureAttributable,
} from "./projects_types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const BY_PROGRAM_DIR = path.join(ROOT, "data/funds/projects/by-program");
const BY_PROCEDURE_DIR = path.join(ROOT, "data/funds/projects/by-procedure");

const TOP_BENEFICIARIES = 100;
const TOP_CONTRACTS = 25;
const TOP_MUNIS = 15;

// A procedure earns an entry in index.json — and therefore a prerendered page
// and a sitemap URL — only once it has this many contracts. 1,152 of the 2,137
// procedures fall below it, and a page for one or two contracts says nothing the
// contract page doesn't. The shard is still written for every procedure, so the
// SPA route resolves for all of them.
export const MIN_INDEXABLE_CONTRACTS = 3;

// Procedures whose contracts overwhelmingly share one title are the mass
// support schemes (BG16RFOP002-2.073 and -2.089 are both at 100%), and that
// shared title IS the scheme's name. Below this share the titles are per-project
// and no name can be honestly derived, so the page falls back to the code.
const MODAL_TITLE_MIN_SHARE = 0.6;

/**
 * Derive the procedure code from a contract number.
 *
 * `BG16RFOP002-2.089-3686-C01` → `BG16RFOP002-2.089`
 * `BG-RRP-1.015-0042`          → `BG-RRP-1.015`
 * `BG16RFOP002-2.073-19464`    → `BG16RFOP002-2.073`
 *
 * The ordinal is `\d{4,}`, not `\d{4}`: the mass COVID schemes ran past 9,999
 * projects, so 2.073 alone numbers up to five digits. Requiring exactly four
 * silently dropped 14,510 rows — 17.7% of the corpus, concentrated in the
 * single most-searched procedure on the site.
 *
 * `programCode` is optional and strips a trailing co-financing programme
 * suffix (`BG05M9OP001-2.018-0024-2014BG05M2OP001`), which 67 ESF rows carry.
 *
 * Returns null when the number carries no project ordinal at all — those rows
 * are left out of the grain rather than being given an invented procedure of
 * their own.
 */
export const procedureCodeOf = (
  contractNumber: string,
  programCode?: string,
): string | null => {
  let n = contractNumber.trim();
  if (programCode && n.endsWith(`-${programCode}`)) {
    n = n.slice(0, -(programCode.length + 1));
  }
  // The `-` before the ordinal is what makes the lazy prefix safe: it can only
  // cut at a real segment boundary, so a procedure code that itself ends in
  // digits (`…-2.073`) is never split mid-token.
  const m = /^(.+?)-(\d{4,})(?:-C\d+)?$/.exec(n);
  if (!m) return null;
  // Whitespace inside an ИСУН code is always an export typo, never meaningful:
  // 17 rows are published as `BGJUSTICE -1.001-0001` for programme `BGJUSTICE`.
  // Removing it recovers them; dropping them on the charset check below would
  // lose real contracts to a stray space.
  const code = m[1].replace(/\s+/g, "");
  // The code becomes a filename and a URL path segment. ИСУН numbers are
  // [-.0-9A-Z] by construction (verified at ingest for the by-contract shards),
  // but a malformed row must never escape into a path.
  return /^[A-Za-z0-9.-]+$/.test(code) ? code : null;
};

/** The most common contract title, when it dominates enough to be the scheme's
 *  name. Null otherwise — see MODAL_TITLE_MIN_SHARE. */
const modalTitle = (contracts: ProcedureAttributable[]): string | null => {
  const counts = new Map<string, number>();
  for (const c of contracts) {
    const t = (c.title ?? "").trim();
    if (!t) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best = "";
  let bestN = 0;
  for (const [t, n] of counts) {
    // Ties broken by title text so the output is deterministic regardless of
    // the order the shards were read in.
    if (n > bestN || (n === bestN && t < best)) {
      best = t;
      bestN = n;
    }
  }
  return bestN / contracts.length >= MODAL_TITLE_MIN_SHARE ? best : null;
};

const buildSummary = (
  procedureCode: string,
  contracts: ProcedureAttributable[],
  oblastOfMuni: (muni: string) => string | null,
): FundsProjectsProcedureSummary => {
  const sorted = [...contracts].sort(
    (a, b) =>
      b.totalEur - a.totalEur ||
      a.contractNumber.localeCompare(b.contractNumber),
  );

  // ── rollup ──────────────────────────────────────────────────────────────
  const beneficiaries = new Set<string>();
  let totalEur = 0;
  let grantEur = 0;
  let paidEur = 0;
  for (const c of sorted) {
    beneficiaries.add(c.beneficiaryEik ?? `name:${c.beneficiaryName}`);
    totalEur += c.totalEur;
    grantEur += c.grantEur ?? 0;
    paidEur += c.paidEur;
  }

  // ── status mix ──────────────────────────────────────────────────────────
  const statusBuckets = new Map<
    string,
    { n: number; total: number; grant: number; paid: number; eiks: Set<string> }
  >();
  for (const c of sorted) {
    const key = statusBucket(c.status);
    const b = statusBuckets.get(key) ?? {
      n: 0,
      total: 0,
      grant: 0,
      paid: 0,
      eiks: new Set<string>(),
    };
    b.n += 1;
    b.total += c.totalEur;
    b.grant += c.grantEur ?? 0;
    b.paid += c.paidEur;
    b.eiks.add(c.beneficiaryEik ?? `name:${c.beneficiaryName}`);
    statusBuckets.set(key, b);
  }

  // ── beneficiaries ───────────────────────────────────────────────────────
  const byKey = new Map<
    string,
    FundsProjectsProcedureSummary["topBeneficiaries"][number]
  >();
  for (const c of sorted) {
    const key = c.beneficiaryEik ?? `name:${c.beneficiaryName}`;
    const e = byKey.get(key) ?? {
      beneficiaryEik: c.beneficiaryEik,
      beneficiaryName: c.beneficiaryName,
      orgType: c.orgType ?? "",
      contractCount: 0,
      totalEur: 0,
      paidEur: 0,
    };
    e.contractCount += 1;
    e.totalEur += c.totalEur;
    e.paidEur += c.paidEur;
    byKey.set(key, e);
  }

  // ── parent programme ────────────────────────────────────────────────────
  // The modal programme by contract count, NOT the programme of the largest
  // contract. Two procedures are genuinely co-financed and publish as two
  // complementary legs (BG05M9OP001-2.018 and -2.056, 47+47 and 20+20 rows);
  // keying on `sorted[0]` made the label depend on which leg happened to hold
  // the biggest single contract, so a €1 change silently reparented the page.
  const progCounts = new Map<string, { name: string; n: number }>();
  for (const c of sorted) {
    const e = progCounts.get(c.programCode) ?? { name: c.programName, n: 0 };
    e.n += 1;
    progCounts.set(c.programCode, e);
  }
  const [programCode, programEntry] = [...progCounts.entries()].sort(
    (a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]),
  )[0];

  return {
    procedureCode,
    procedureName: modalTitle(sorted),
    programCode,
    programName: programEntry.name,
    rollup: {
      contractCount: sorted.length,
      beneficiaryCount: beneficiaries.size,
      totalEur: round2(totalEur),
      grantEur: round2(grantEur),
      paidEur: round2(paidEur),
    },
    statusBreakdown: [...statusBuckets.entries()]
      .map(([status, b]) => ({
        status,
        rollup: {
          contractCount: b.n,
          beneficiaryCount: b.eiks.size,
          totalEur: round2(b.total),
          grantEur: round2(b.grant),
          paidEur: round2(b.paid),
        },
      }))
      .sort((a, b) => b.rollup.totalEur - a.rollup.totalEur),
    topBeneficiaries: [...byKey.values()]
      .map((e) => ({
        ...e,
        totalEur: round2(e.totalEur),
        paidEur: round2(e.paidEur),
      }))
      .sort(
        (a, b) =>
          b.totalEur - a.totalEur ||
          a.beneficiaryName.localeCompare(b.beneficiaryName),
      )
      .slice(0, TOP_BENEFICIARIES),
    topContracts: sorted.slice(0, TOP_CONTRACTS).map((c) => ({
      contractNumber: c.contractNumber,
      title: c.title,
      totalEur: round2(c.totalEur),
      paidEur: round2(c.paidEur),
      status: c.status,
      beneficiaryEik: c.beneficiaryEik,
      beneficiaryName: c.beneficiaryName,
      locationRaw: c.locationRaw ?? "",
      locationMunis: c.location?.munis ?? null,
    })),
    topMunis: rollupTopMunis(sorted, TOP_MUNIS, oblastOfMuni),
  };
};

export interface ProceduresBuild {
  index: FundsProjectsProceduresIndex;
  shards: FundsProjectsProcedureSummary[];
}

/**
 * Group a resolved contract corpus by procedure and summarise each one.
 *
 * `oblastByMuni` is the муни → област dictionary. It defaults to reading
 * data/settlements.json, and is injectable so the unit tests stay pure.
 */
export const buildProcedures = (
  contracts: ProcedureAttributable[],
  generatedAt: string,
  oblastByMuni: Map<string, string> = loadOblastByMuni(),
): ProceduresBuild => {
  const oblastOfMuni = (m: string): string | null =>
    oblastByMuni.get(m) ?? null;

  const byProcedure = new Map<string, ProcedureAttributable[]>();
  for (const c of contracts) {
    const code = procedureCodeOf(c.contractNumber, c.programCode);
    if (!code) continue;
    const arr = byProcedure.get(code);
    if (arr) arr.push(c);
    else byProcedure.set(code, [c]);
  }

  const shards = [...byProcedure.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, rows]) => buildSummary(code, rows, oblastOfMuni));

  const indexable = shards
    .filter((s) => s.rollup.contractCount >= MIN_INDEXABLE_CONTRACTS)
    .sort(
      (a, b) =>
        b.rollup.totalEur - a.rollup.totalEur ||
        a.procedureCode.localeCompare(b.procedureCode),
    );

  return {
    index: {
      generatedAt,
      // Every procedure has a shard; only these carry a page in the sitemap.
      procedureCount: shards.length,
      minIndexableContracts: MIN_INDEXABLE_CONTRACTS,
      procedures: indexable.map((s) => ({
        procedureCode: s.procedureCode,
        procedureName: s.procedureName,
        programCode: s.programCode,
        programName: s.programName,
        contractCount: s.rollup.contractCount,
        beneficiaryCount: s.rollup.beneficiaryCount,
        totalEur: s.rollup.totalEur,
        paidEur: s.rollup.paidEur,
      })),
    },
    shards,
  };
};

export const writeProcedures = (data: ProceduresBuild): void => {
  // Two ways a code that passed the charset check can still destroy a shard on
  // write, neither of which occurs in the corpus today. Both fail loudly rather
  // than silently losing a procedure.
  const seen = new Map<string, string>();
  for (const s of data.shards) {
    const lower = s.procedureCode.toLowerCase();
    if (lower === "index") {
      throw new Error(
        `procedure code "${s.procedureCode}" collides with the catalogue file index.json`,
      );
    }
    const prev = seen.get(lower);
    if (prev !== undefined) {
      throw new Error(
        `case-insensitive shard collision on the dev filesystem: ${prev} vs ${s.procedureCode}`,
      );
    }
    seen.set(lower, s.procedureCode);
  }

  resetDir(BY_PROCEDURE_DIR);
  for (const s of data.shards) {
    fs.writeFileSync(
      path.join(BY_PROCEDURE_DIR, `${s.procedureCode}.json`),
      canonicalJson(s),
    );
  }
  fs.writeFileSync(
    path.join(BY_PROCEDURE_DIR, "index.json"),
    canonicalJson(data.index),
  );
};

// ── standalone entrypoint ────────────────────────────────────────────────────
// Reads the full per-programme shards back off disk, so the procedure grain can
// be rebuilt without re-downloading the ~80k-row ИСУН export. Same pattern as
// themes.ts.
const loadFromProgramShards = (): ProcedureAttributable[] => {
  if (!fs.existsSync(BY_PROGRAM_DIR)) {
    throw new Error(
      `${BY_PROGRAM_DIR} is missing — run \`npm run funds:ingest-projects\` first.`,
    );
  }
  const rows: ProcedureAttributable[] = [];
  for (const f of fs.readdirSync(BY_PROGRAM_DIR).sort()) {
    if (!f.endsWith(".json") || f.endsWith("-summary.json")) continue;
    const shard = JSON.parse(
      fs.readFileSync(path.join(BY_PROGRAM_DIR, f), "utf8"),
    ) as { contracts?: ProcedureAttributable[] };
    for (const c of shard.contracts ?? []) rows.push(c);
  }
  return rows;
};

const isMain =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMain) {
  console.log("→ building ИСУН procedure shards");
  const contracts = loadFromProgramShards();
  const data = buildProcedures(contracts, new Date().toISOString());
  writeProcedures(data);
  console.log(
    `→ wrote ${data.shards.length} procedure shard(s); ` +
      `${data.index.procedures.length} indexable (>= ${MIN_INDEXABLE_CONTRACTS} contracts)`,
  );
  for (const p of data.index.procedures.slice(0, 5)) {
    console.log(
      `  ${p.procedureCode}: ${p.contractCount} contracts · ` +
        `€${Math.round(p.totalEur).toLocaleString("en-US")} contracted` +
        (p.procedureName ? ` · ${p.procedureName.slice(0, 60)}` : ""),
    );
  }
}
