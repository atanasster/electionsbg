// One-shot: evict legacy-CSV rows minted before the parser read the contract-number column,
// then point the operator at the standard rebuild. No network calls — works from
// data/procurement/ and the cached raw dumps in raw_data/procurement/legacy/.
//
//   npm run proc:dedup-pre-cid              # dry run (default)
//   npm run proc:dedup-pre-cid -- --apply   # write onto the shards
//
// Deliberately NO `:apply` twin — the reason dedup_stale_base_keys.ts gives: this is a one-shot
// against a backlog that should end at zero, and an `:apply` script is one edit away from being
// chained into db:refresh, deleting from a gitignored tree with nobody reading the pairs.
//
// The DETECTION is `pre_contract_id_twins.ts` (unit-tested beside it); this file is the runner —
// the fresh re-parse that validates each eviction, I/O, verification, backup, write. The ingest
// self-heal (`evictPreContractIdTwins` in writeMonthShards) keeps the class from coming back but
// does NOT clear rows already on disk: `legacy_ingested.json` suppresses already-ingested years,
// so nothing re-parses them on a schedule.
//
// ── VALIDATION ──────────────────────────────────────────────────────────────────────────────
//
// Every eviction is confirmed against a parse of the RAW dump with today's parser: the evicted
// row's key must NOT be produced and its survivor's MUST be. A dump that is missing locally
// means its candidates are REFUSED, never matched on rules 1–2 alone — those are safe for the
// standing gate (which deletes nothing) and not for a delete.
//
// ── ORDERING ────────────────────────────────────────────────────────────────────────────────
//
//   ingest → fix_amount_overrides → dedup_stale_base_keys → THIS → anexi_current_value
//          → backfill_unp → reconcile_cross_source → rebuild_from_cache → db:load:pg
//          → db:load:annexes:pg
//
// The rule matches on NATIVE `amount`, so it is robust to the annex fold (which flips
// `amountEur`) and may also run after it. It is NOT robust to fix_amount_overrides on one twin
// only — such a pair simply does not match and is left alone.
//
// Measured 2026-10-17: 12,397 evictions, €1,183,983,859.08 (shard `amountEur`), of a
// €104.5bn shard corpus.
// Plan: docs/plans/procurement-same-feed-dedup-v1.md §7.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { rawJson, findDuplicateKeys } from "./validate";
import { describeRow } from "./cross_source";
import { LEGACY_DATASETS, parseLegacyCsv } from "./legacy_csv";
import {
  analyzePreContractIdTwins,
  isPreCidCandidate,
  siblingKey,
} from "./pre_contract_id_twins";
import type { Contract } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
// `--shards <dir>` re-runs the DRY RUN against another tree (e.g. the pre-sweep backup, to
// re-validate a rule change against the rows it already removed). Refused with --apply.
const shardsArg = process.argv.indexOf("--shards");
const MONTH_DIR =
  shardsArg > -1
    ? path.resolve(process.argv[shardsArg + 1] ?? "")
    : path.join(ROOT, "data/procurement/contracts");
const RAW_DIR = path.join(ROOT, "raw_data/procurement/legacy");
const BACKUP_DIR = path.join(
  ROOT,
  "data/procurement/.contracts_backup_pre_contract_id",
);

const APPLY = process.argv.includes("--apply");
const unknown = process.argv
  .slice(2)
  .filter((a, i, all) => a !== "--apply" && a !== "--shards" && all[i - 1] !== "--shards"); // prettier-ignore
if (unknown.length) {
  console.error(
    `unknown argument(s): ${unknown.join(" ")}\nknown: --apply (omit for a dry run), --shards <dir> (dry run only)`,
  );
  process.exit(2);
}
if (APPLY && shardsArg > -1) {
  console.error(
    "--shards is for dry runs only; refusing to --apply to another tree",
  );
  process.exit(2);
}

const isYearDir = (n: string): boolean => /^\d{4}$/.test(n);

/** Keys today's parser produces, per raw dump — plus the dumps that could not be read, whose
 *  candidates must be refused. The bundle uuid on a row names its dump. */
const freshParse = (): {
  keys: Set<string>;
  numberless: Set<string>;
  parsedBundles: Set<string>;
  missing: string[];
} => {
  const keys = new Set<string>();
  const numberless = new Set<string>();
  const parsedBundles = new Set<string>();
  const missing: string[] = [];
  for (const ds of LEGACY_DATASETS) {
    const f = path.join(RAW_DIR, `${ds.year}.csv.gz`);
    if (!fs.existsSync(f)) {
      missing.push(ds.year);
      continue;
    }
    const text = zlib.gunzipSync(fs.readFileSync(f)).toString("utf8");
    const { rows } = parseLegacyCsv(text, ds);
    for (const r of rows) {
      keys.add(r.key);
      if (isPreCidCandidate(r)) numberless.add(siblingKey(r));
    }
    parsedBundles.add(ds.datasetUuid);
    console.log(`  parsed ${ds.year}: ${rows.length} row(s)`);
  }
  return { keys, numberless, parsedBundles, missing };
};

const reportAnnexImpact = async (evictedKeys: string[]): Promise<void> => {
  if (!evictedKeys.length) return;
  try {
    const { allRows, end } = await import("../db/lib/pg");
    const rows = await allRows<{ n: string }>(
      "SELECT count(*) AS n FROM procurement_annexes WHERE contract_key = ANY($1)",
      [evictedKeys],
    );
    await end();
    const n = Number(rows[0]?.n ?? 0);
    console.log(
      `\nannex impact — ${n} procurement_annexes row(s) reference an evicted key.` +
        (n ? `\n  → \`npm run db:load:annexes:pg\` after the reload re-resolves them.` : ""), // prettier-ignore
    );
  } catch {
    // „Could not check" is not a zero, and saying so is the point.
    console.log(
      `\nannex impact — Postgres unreachable, NOT checked (this is not a zero).`,
    );
  }
};

const main = async (): Promise<void> => {
  const shards = new Map<string, Contract[]>();
  const all: Contract[] = [];
  for (const y of fs.readdirSync(MONTH_DIR).filter(isYearDir)) {
    const dir = path.join(MONTH_DIR, y);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const p = path.join(dir, f);
      const rows = JSON.parse(fs.readFileSync(p, "utf8")) as Contract[];
      if (!Array.isArray(rows)) continue;
      shards.set(p, rows);
      all.push(...rows);
    }
  }
  const sum = (rows: Contract[]): number =>
    rows.reduce((s, r) => s + (r.amountEur ?? 0), 0);
  const beforeRows = all.length;
  const beforeEur = sum(all);
  console.log(
    `corpus: ${beforeRows} rows / €${beforeEur.toFixed(2)}  (${shards.size} shards)`,
  );

  console.log("re-parsing the raw legacy dumps with today's parser…");
  const { keys: fresh, numberless, parsedBundles, missing } = freshParse();
  if (missing.length)
    console.log(
      `  ⚠ raw dump(s) absent: ${missing.join(", ")} — their candidates are REFUSED`,
    );

  // Rows from a dump we could not parse are excluded from the analysis outright, so a missing
  // dump can never make its rows look "not produced by a fresh parse".
  const analysable = all.filter(
    (r) => !isPreCidCandidate(r) || parsedBundles.has(r.bundleUuid ?? ""),
  );
  const skippedNoDump = all.filter(
    (r) => isPreCidCandidate(r) && !parsedBundles.has(r.bundleUuid ?? ""),
  );
  const { pairs, refused } = analyzePreContractIdTwins(
    analysable,
    fresh,
    numberless,
  );
  const evicted = new Set(pairs.map((p) => p.evicted));

  // PAIRS, NEVER COUNTS.
  console.log(
    `\n${pairs.length} contract-number-less twin(s), €${sum([...evicted]).toFixed(2)} — evicted → survivor`,
  );
  for (const p of pairs)
    console.log(
      `  ${p.evicted.key} → ${p.survivor.key}  ${describeRow(p.evicted)}` +
        (p.conflicts.length ? `\n      conflict: ${p.conflicts.join("; ")}` : ""), // prettier-ignore
    );
  const conflicting = pairs.filter((p) => p.conflicts.length);
  if (conflicting.length)
    console.log(
      `\n  ${conflicting.length} pair(s) disagree on a NON-identity field. The survivor's value ` +
        `wins — it is what\n  a fresh parse produces today. numberOfTenderers feeds the ` +
        `published single-bidder flag.`,
    );
  if (refused.length) {
    console.log(`\n${refused.length} candidate(s) REFUSED:`);
    for (const r of refused)
      console.log(`  ${r.row.key} — ${r.reason}  ${describeRow(r.row)}`);
  }
  if (skippedNoDump.length)
    console.log(
      `\n${skippedNoDump.length} candidate(s) from a dump that could not be parsed — not examined.`,
    );

  // ── VERIFICATION. Everything runs BEFORE anything is written; any failure exits non-zero.
  const problems: string[] = [];
  if (evicted.size !== pairs.length)
    problems.push(
      `${pairs.length} pair(s) name only ${evicted.size} distinct rows`,
    );
  const nextShards = new Map<string, Contract[]>();
  const after: Contract[] = [];
  for (const [p, rows] of shards) {
    const kept = rows.filter((r) => !evicted.has(r));
    nextShards.set(p, kept);
    after.push(...kept);
  }
  // Survivor present BY KEY.
  const afterKeys = new Set(after.map((r) => r.key));
  const orphaned = pairs.filter((p) => !afterKeys.has(p.survivor.key));
  if (orphaned.length)
    problems.push(
      `${orphaned.length} eviction(s) name a survivor absent after the write`,
    );
  if (pairs.some((p) => evicted.has(p.survivor)))
    problems.push("an eviction names a survivor that is itself evicted");
  // No procedure loses its last row, over the whole corpus.
  const procedureKey = (r: Contract): string => `${r.ocid}${r.tag}`;
  const afterProcedures = new Set(after.map(procedureKey));
  const vanished = [...new Set(all.map(procedureKey))].filter(
    (k) => !afterProcedures.has(k),
  );
  if (vanished.length)
    problems.push(
      `${vanished.length} procedure(s) lose their last row: ${vanished.slice(0, 5).join(", ")}`,
    );
  if (after.length !== beforeRows - pairs.length)
    problems.push(
      `row count moved by ${after.length - beforeRows}, expected ${-pairs.length}`,
    );
  const afterEur = sum(after);
  const delta = beforeEur - afterEur;
  const evictedEur = sum([...evicted]);
  const tolerance = Math.max(0.01, Math.abs(beforeEur) * 1e-9);
  if (Math.abs(delta - evictedEur) > tolerance)
    problems.push(
      `€ delta ${delta.toFixed(2)} ≠ Σ evicted ${evictedEur.toFixed(2)}`,
    );
  const dupeKeys = findDuplicateKeys(after);
  if (dupeKeys.length)
    problems.push(`${dupeKeys.length} duplicate key(s) remain after eviction`);

  console.log(
    `\nrows ${beforeRows} → ${after.length}; € ${beforeEur.toFixed(2)} → ${afterEur.toFixed(2)}`,
  );
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error("aborting; nothing written");
    process.exitCode = 1;
    return;
  }
  console.log("✓ verification passed");
  await reportAnnexImpact(pairs.map((p) => p.evicted.key));

  if (!pairs.length) {
    console.log("nothing to do — corpus is already clean");
    return;
  }
  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to write");
    return;
  }

  // The shard tree is gitignored and NOT recoverable from git: a backup is a precondition.
  const tmp = `${BACKUP_DIR}.tmp`;
  for (const p of [BACKUP_DIR, tmp])
    if (fs.existsSync(p)) {
      console.error(
        `✗ backup path already exists: ${p}\n  move or remove it first — refusing to overwrite a prior backup`,
      );
      process.exitCode = 1;
      return;
    }
  console.log(`→ backing up ${MONTH_DIR} → ${BACKUP_DIR}`);
  fs.cpSync(MONTH_DIR, tmp, { recursive: true });
  fs.renameSync(tmp, BACKUP_DIR);

  let written = 0;
  for (const [p, rows] of nextShards) {
    // rawJson, NOT canonicalJson: month shards keep full-precision amountEur (writeMonthShards
    // writes them with rawJson); canonicalJson rounds money keys and would rewrite every shard.
    const next = rawJson(rows);
    if (next === fs.readFileSync(p, "utf8")) continue;
    fs.writeFileSync(p, next);
    written++;
  }
  console.log(`applied — wrote ${written} shard(s); backup at ${BACKUP_DIR}`);
  console.log(
    "Next: npm run proc:backfill-unp:apply && npm run proc:reconcile:apply && npm run proc:rebuild-derived && npm run db:load:pg && npm run db:load:annexes:pg",
  );
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
