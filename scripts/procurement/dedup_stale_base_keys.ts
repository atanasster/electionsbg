// One-shot: evict legacy-CSV rows still carrying a key from a SUPERSEDED keying scheme, then point
// the operator at the standard rebuild. No network calls — works purely from data/procurement/ on
// disk.
//
//   npm run proc:dedup-stale-keys              # dry run (default)
//   npm run proc:dedup-stale-keys -- --apply   # write onto the shards
//
// There is deliberately NO `proc:dedup-stale-keys:apply` twin, unlike `proc:reconcile:apply`. That
// asymmetry is the point: `proc:reconcile:apply` is in `db:refresh` because it is idempotent and
// re-runs on every ingest, whereas this is a one-shot against a backlog that should end at zero. A
// `:apply` script is one edit away from being chained into `db:refresh`, where it would delete from
// a gitignored tree on every refresh with nobody reading the pairs it prints. Type the flag.
//
// The DETECTION lives in `stale_base_keys.ts` and is unit-tested there (`stale_base_keys.test.ts`);
// this file is the runner — I/O, verification, backup, write. Splitting them is what lets the
// standing corpus gate and the ingest self-heal import the SAME detection rather than a lookalike.
//
// ── THIS IS STILL THE ONLY THING THAT CLEARS THE BACKLOG ────────────────────────────────────
//
// `evictStaleBaseKeys` is now also wired into both `writeMonthShards` paths, so a future ingest
// cannot re-introduce this class — the same treatment `dropSyntheticLegacyTwins` got for `…-x`.
// But that wiring does NOT clear the 30 rows already on disk, and it is important not to read it
// as if it did:
//
//   - `ingest.ts` is the OCDS ingest and emits no `aop-legacy-` rows at all. It only ever sees a
//     legacy row when a month shard it opens happens to hold both feeds. Measured 2026-08-05:
//     0 of 188 shards do — `ocds-` spans 2026-01…06, all 30 stale rows are 2020-08…12. So on
//     today's corpus that path can never fire on the backlog.
//   - `ingest_legacy.ts` WOULD heal it, but only for a year it actually re-parses, and
//     `legacy_ingested.json` suppresses already-ingested years by default.
//
// So the backlog is cleared by running this script with `--apply`, or by a deliberate
// `ingest_legacy --year 2020 --rediscover`. Nothing clears it on a schedule.
//
// ── WHY NO EXISTING PASS FINDS THEM ─────────────────────────────────────────────────────────
//
// `dedup_contract_keys.ts` groups rows by their STORED key and re-keys any group holding ≥2
// distinct discriminators. It re-keys in place, asserts uniqueness, and is correctly idempotent —
// but a row already carrying a stale key no longer shares a stored key with its twin, so it forms
// a SINGLETON group and is skipped. Re-running it can never help. Everything else is scoped
// elsewhere: `evictSupersededEopTwins` only removes `eop-` rows; `reconcile_cross_source.ts` and
// `single_source_per_contract.data.test.ts` both require >1 feed by construction;
// `dropSyntheticLegacyTwins` keys on the `…-x` ocid fallback only.
//
// This is the same failure `dedup_legacy_twins.ts` documents for that `…-x` class (~34k pairs /
// ~€11bn), one key-formula change later.
//
// ── ORDERING ────────────────────────────────────────────────────────────────────────────────
//
//   ingest → fix_amount_overrides → THIS → anexi_current_value → backfill_unp
//          → reconcile_cross_source → rebuild_from_cache → db:load:pg → db:load:annexes:pg
//
// It must precede nothing in particular, but it must FOLLOW `fix_amount_overrides.ts` — that pass
// rewrites `amount`, which the survivor key is derived from. `preflightOrder()` refuses rather than
// reporting a green zero when the corpus looks like the inputs have already moved.
//
// Measured 2026-08-04: 30 evictions, €2,068,182.74, against a 405,720-row / €99.26bn shard corpus.
//
// Plan: docs/plans/procurement-same-feed-dedup-v1.md §5.2.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { canonicalJson, findDuplicateKeys } from "./validate";
import { describeRow } from "./cross_source";
import { analyzeStaleBaseKeys, preflightOrder } from "./stale_base_keys";
import type { Contract } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const MONTH_DIR = path.join(ROOT, "data/procurement/contracts");
const BACKUP_DIR = path.join(
  ROOT,
  "data/procurement/.contracts_backup_stale_base_keys",
);

const APPLY = process.argv.includes("--apply");

const KNOWN = new Set(["--apply"]);
const unknown = process.argv.slice(2).filter((a) => !KNOWN.has(a));
if (unknown.length) {
  console.error(
    `unknown argument(s): ${unknown.join(" ")}\nknown: --apply (omit for a dry run)`,
  );
  process.exit(2);
}

const isYearDir = (n: string): boolean => /^\d{4}$/.test(n);

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
        (n
          ? `\n  → run \`npm run db:load:annexes:pg\` after the reload; it re-resolves against contracts.`
          : ""),
    );
  } catch {
    // Postgres-only and best-effort. "Could not check" is different from "zero", and saying so is
    // the point — a silent zero here would read as "no annexes affected".
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

  const orderProblem = preflightOrder(all);
  if (orderProblem) {
    console.error(`✗ preflight — ${orderProblem}`);
    console.error("aborting; nothing written");
    process.exitCode = 1;
    return;
  }

  const { pairs, unresolved, unactedDuplicates } = analyzeStaleBaseKeys(all);
  const evicted = new Set(pairs.map((p) => p.evicted));

  // PAIRS, NEVER COUNTS. Every failure in this area reported a plausible count while corrupting
  // data, so the evidence is the named row and its named survivor.
  console.log(
    `\n${pairs.length} stale-base-key row(s), €${sum([...evicted]).toFixed(2)} — evicted → survivor`,
  );
  for (const p of pairs)
    console.log(
      `  ${p.evicted.key} → ${p.survivor.key}  ${describeRow(p.evicted)}` +
        (p.conflicts.length
          ? `\n      conflict: ${p.conflicts.join("; ")}`
          : ""),
    );

  const conflicting = pairs.filter((p) => p.conflicts.length);
  if (conflicting.length)
    console.log(
      `\n  ${conflicting.length} pair(s) disagree on a NON-identity field. The survivor's value ` +
        `wins, because it\n  is what a fresh ingest produces today — but note ` +
        `numberOfTenderers feeds the published\n  single-bidder red flag, so a 1 → 2 change ` +
        `moves a competition signal.`,
    );

  if (unresolved.length) {
    console.log(
      `\n${unresolved.length} bare-key group(s) REFUSED (no single re-derivable survivor):`,
    );
    for (const u of unresolved)
      console.log(
        `  base=${u.base} — ${u.reason}\n    ${u.rows.map((r) => r.key).join(" + ")}`,
      );
  }

  if (unactedDuplicates.length) {
    const eur = unactedDuplicates.reduce((s, rs) => {
      const t = sum(rs);
      return s + (t - t / rs.length);
    }, 0);
    console.log(
      `\nNOT ACTED ON — ${unactedDuplicates.length} identity-identical group(s), €${eur.toFixed(2)} surplus.`,
    );
    console.log(
      `  NO member carries the bare base key, so this rule cannot name a survivor. Their second ` +
        `key\n  matches neither formula and its mint-time derivation could not be reconstructed, ` +
        `so which of\n  the pair is the orphan is unknown. Triage by hand — plan §5.2.`,
    );
    for (const rs of unactedDuplicates)
      console.log(
        `  ${rs.map((r) => r.key).join(" + ")}  ${describeRow(rs[0])}`,
      );
  }

  // ── VERIFICATION. Every check runs BEFORE anything is written; any failure exits non-zero.
  const problems: string[] = [];

  if (evicted.size !== pairs.length)
    problems.push(
      `${pairs.length} pair(s) name only ${evicted.size} distinct rows — every total is inflated`,
    );

  const after: Contract[] = [];
  const nextShards = new Map<string, Contract[]>();
  for (const [p, rows] of shards) {
    const kept = rows.filter((r) => !evicted.has(r));
    nextShards.set(p, kept);
    after.push(...kept);
  }

  // SURVIVOR PRESENT BY KEY, not by value. A later pass can rewrite amounts, and a value-based
  // check turned that into a false orphan report in the v2 audit.
  const afterKeys = new Set(after.map((r) => r.key));
  const orphaned = pairs.filter((p) => !afterKeys.has(p.survivor.key));
  if (orphaned.length)
    problems.push(
      `${orphaned.length} eviction(s) name a survivor absent from the written corpus: ` +
        orphaned
          .slice(0, 3)
          .map((p) => `${p.evicted.key} → ${p.survivor.key}`)
          .join(" | "),
    );

  const cannibal = pairs.filter((p) => evicted.has(p.survivor));
  if (cannibal.length)
    problems.push(
      `${cannibal.length} eviction(s) name a survivor that is ITSELF evicted`,
    );

  // NO PROCEDURE LOSES ITS LAST ROW — over the WHOLE corpus, so it also catches over-deletion from
  // a shard-write bug this pass never selected. Keyed (УНП, tag): identity-level, never contract
  // number, since a correct eviction may empty a contract number.
  const SEP = "";
  const procedureKey = (r: Contract): string => `${r.unp ?? ""}${SEP}${r.tag}`;
  const afterProcedures = new Set(after.map(procedureKey));
  const vanished = [...new Set(all.map(procedureKey))].filter(
    (k) => !afterProcedures.has(k),
  );
  if (vanished.length)
    problems.push(
      `${vanished.length} procedure(s) present before are GONE after: ` +
        vanished
          .slice(0, 5)
          .map((k) => k.replace(SEP, "/"))
          .join(", "),
    );

  if (after.length !== beforeRows - pairs.length)
    problems.push(
      `row count moved by ${after.length - beforeRows}, expected ${-pairs.length}`,
    );

  // € DELTA == Σ EVICTED, EXACTLY. Tolerance scales with the corpus rather than sitting at a flat
  // cent, matching verifyEviction: a naive left-to-right sum of ~406k doubles totalling ~€99.24bn
  // carries ~€0.007 of float drift on its own.
  const afterEur = sum(after);
  const delta = beforeEur - afterEur;
  const evictedEur = sum([...evicted]);
  const tolerance = Math.max(0.01, Math.abs(beforeEur) * 1e-9);
  if (Math.abs(delta - evictedEur) > tolerance)
    problems.push(
      `€ delta ${delta.toFixed(2)} ≠ Σ evicted ${evictedEur.toFixed(2)} ` +
        `(tolerance ${tolerance.toFixed(4)})`,
    );

  // KEY UNIQUENESS, as every sibling pass asserts. Removing rows cannot introduce a collision, so
  // this fires only if the corpus was already broken — which is worth knowing before writing.
  const dupeKeys = findDuplicateKeys(after);
  if (dupeKeys.length)
    problems.push(
      `${dupeKeys.length} duplicate key(s) remain after eviction: ${dupeKeys.slice(0, 5).join(", ")}`,
    );

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

  // `procurement_annexes.contract_key` points at `contracts.key`, so an evicted row orphans its
  // annexes until `db:load:annexes:pg` re-resolves them. A required, visible consequence.
  await reportAnnexImpact(pairs.map((p) => p.evicted.key));

  if (!pairs.length) {
    console.log("nothing to do — corpus is already clean");
    return;
  }
  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to write");
    return;
  }

  // The shard tree is gitignored and NOT recoverable from git, so a backup is a PRECONDITION of
  // writing rather than a suggestion. Written to a `.tmp` path and renamed only once the copy
  // completes, so an interrupted copy cannot be mistaken for a good backup by a later run.
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
    const next = canonicalJson(rows);
    if (next === fs.readFileSync(p, "utf8")) continue;
    fs.writeFileSync(p, next);
    written++;
  }
  console.log(`applied — wrote ${written} shard(s); backup at ${BACKUP_DIR}`);
  console.log(
    "Next: npm run proc:rebuild-derived && npm run db:load:pg && npm run db:load:annexes:pg",
  );
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
