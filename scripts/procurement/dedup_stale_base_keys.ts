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
// BOTH neighbours are load-bearing, and only one of them is guarded:
//
//   - it must FOLLOW `fix_amount_overrides.ts`, which rewrites `amount` — the input the survivor
//     key derives from. `preflightOrder()` refuses rather than reporting a green zero here.
//   - it must PRECEDE `anexi_current_value.ts --apply`, which flips `amountEur` — part of
//     `identityOf`. The two members of a stale pair need not flip alike (`signingAmountEur` is one
//     of the fields `conflictsOf` reports them disagreeing on), so a late run can see the identity
//     diverge, find no pairs, and exit 0 saying the corpus is clean. NOTHING CATCHES THAT:
//     `preflightOrder` guards the `amount` inputs, which the annex fold does not touch.
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
import { stripOneTimeBlock } from "./lib/retire_one_time";
import type { Contract } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const MONTH_DIR = path.join(ROOT, "data/procurement/contracts");
const BACKUP_DIR = path.join(
  ROOT,
  "data/procurement/.contracts_backup_stale_base_keys",
);
const SKILL_FILE = path.join(
  ROOT,
  ".claude/skills/update-procurement/SKILL.md",
);
// NOT under state/ingest/. That directory is the orchestrator's SKILL-marker
// registry: `readAllIngestStates` keys every file there by its `skill` field,
// so a record without one lands under an `undefined` key, and
// ingest-state.test.ts fails on the missing `skill`/`lastSuccessfulIngest`.
// This is a one-shot script's completion record, not a skill's watermark.
const STATE_FILE = path.join(ROOT, "state/oneoff/proc-stale-base-keys.json");
const ONE_TIME_ID = "stale-base-keys";

/** RETIRE THE STEP. A one-shot against a finite backlog must stop being an instruction once the
 *  backlog is gone, or every future reader of the runbook pays to work out that it no longer
 *  applies — which is precisely why `dedup_legacy_twins.ts` still carries a "re-run normally
 *  unnecessary" caveat nobody has removed.
 *
 *  Two things are deliberately NOT auto-removed. `KNOWN_STALE` in the data gate stays, because
 *  that gate failing is the forcing function that gets it deleted in a reviewed commit — silently
 *  editing a test to make it pass is the one edit a script must never make. And this file stays,
 *  because the dry run remains the way to audit the class. */
/** Strip the block, writing via `.tmp` + rename for the same reason the shard backup does: a
 *  truncate-then-write on a committed runbook can leave it half-written if the process dies. */
const retireSkillBlock = (): boolean => {
  if (!fs.existsSync(SKILL_FILE)) return false;
  const out = stripOneTimeBlock(
    fs.readFileSync(SKILL_FILE, "utf8"),
    ONE_TIME_ID,
  );
  if (!out.removed) return false;
  const tmp = `${SKILL_FILE}.tmp`;
  fs.writeFileSync(tmp, out.text);
  fs.renameSync(tmp, SKILL_FILE);
  return true;
};

const FOLLOW_UPS = [
  "npm run db:load:annexes:pg (+ :cloud) — mandatory; evicted rows orphan their annexes and only this loader re-resolves them",
  "delete KNOWN_STALE from scripts/db/tests/stale_base_keys.data.test.ts",
];

// Both follow-ups are now gated, so forgetting one fails a test rather than degrading a page:
// annex_fold_identity.data.test.ts fails on any orphaned annex, and stale_base_keys.data.test.ts
// fails while KNOWN_STALE names rows the corpus no longer has. Neither fires until `db:load:pg`
// has reloaded the corpus — they read Postgres, and this pass writes shards.
const GATES = "npm run test:data (after db:load:pg) fails if either is skipped";

const retire = (evicted: number, eur: number): void => {
  // The marker lands FIRST. Retirement is otherwise a one-way door: the clean-corpus path returns
  // before `retire()`, so a run interrupted between the write and the strip could never be
  // completed by a later one. With the marker on disk, the no-op path below finishes the job.
  //
  // It also carries the follow-ups, because removing the block deletes the only durable copy of
  // them at the moment they become mandatory — console output does not survive the terminal.
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(
    STATE_FILE,
    `${JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        script: "scripts/procurement/dedup_stale_base_keys.ts",
        summary: `cleared ${evicted} stale-base-key row(s), €${eur.toFixed(2)}`,
        plan: "docs/plans/procurement-same-feed-dedup-v1.md",
        followUps: FOLLOW_UPS,
      },
      null,
      2,
    )}\n`,
  );
  const removed = retireSkillBlock();
  console.log(
    `\n── RETIRED ──\n` +
      `  ${removed ? "removed" : "did NOT find (already retired, or the markers moved)"} ` +
      `the ONE-TIME block in ${path.relative(ROOT, SKILL_FILE)}\n` +
      `  wrote ${path.relative(ROOT, STATE_FILE)} — it carries the follow-ups below\n` +
      `  STILL YOURS TO DO, in this session:\n` +
      FOLLOW_UPS.map((f, i) => `    ${i + 1}. ${f}`).join("\n") +
      `\n       ${GATES}\n` +
      `    ${FOLLOW_UPS.length + 1}. commit this file, the skill and the state marker together`,
  );
};

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
    // Finish an interrupted retirement. The marker means a previous run DID clear the backlog, so
    // a block still sitting in the runbook is leftover, not an instruction. Without this the
    // retirement is a one-way door — this path returns before `retire()` ever runs again.
    if (fs.existsSync(STATE_FILE) && retireSkillBlock())
      console.log(
        `  (removed the leftover ONE-TIME block from ${path.relative(ROOT, SKILL_FILE)} — ` +
          `a previous --apply cleared the backlog but did not finish retiring)`,
      );
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
  // Only after the write LANDED. Retiring on a run that verified but failed to write would remove
  // the instruction while leaving the backlog in place — the one ordering that must not invert.
  retire(pairs.length, evictedEur);
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
