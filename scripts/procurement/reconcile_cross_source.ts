// Post-backfill cross-source reconciliation for the contracts corpus.
//
// WHY THIS IS A SEPARATE PASS. Four attempts to reconcile the two procurement feeds inside the
// ingest failed on one constraint, which is a law of this pipeline rather than a bug:
//
//   The УНП does not exist at parse time. `normalize.ts` never sets `unp` — the АОП OCDS export
//   carries none — and `backfill_unp.ts` writes it onto the shards afterwards by resolving the
//   ocid through the tender shards.
//
// Identifying the same CONTRACT across the feeds needs the УНП, because the ocid is
// feed-namespaced (`eop-…` vs `ocds-e82gsb-…`) and buyers reuse contract numbers across
// procedures. So a cross-source rule placed in the parse-time eviction is either inert (the
// `p:` content net, and a survivor precondition keyed on `unp`) or wrong (a precondition keyed
// on buyer+contract-number destroyed 46 legitimate rows). See
// docs/plans/procurement-foreign-consortium-members-v1.md §9–§10.
//
// It runs on the SHARDS, not in SQL: `pg_roundtrip.data.test.ts` asserts Postgres is a lossless
// capture of the shards, so deleting rows in PG that exist on disk fails that gate — the same
// reasoning backfill_unp.ts records for resolving УНП on disk rather than at load time.
//
// PIPELINE POSITION (both predecessors are mandatory):
//   ingest → anexi_current_value.ts --apply → backfill_unp.ts --apply → THIS → rebuild_from_cache
//
//   npx tsx scripts/procurement/reconcile_cross_source.ts            # dry run
//   npx tsx scripts/procurement/reconcile_cross_source.ts --apply

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { hashKey } from "./contract_key";
import { feedOf } from "./content_key";
import {
  analyzeCrossSource,
  describeRow,
  signingDay,
  verifyEviction,
} from "./cross_source";
import type { Contract } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const MONTH_DIR = path.join(ROOT, "data/procurement/contracts");
const BRIDGE_FILE = path.join(ROOT, "data/procurement/person_eik_bridge.json");

const APPLY = process.argv.includes("--apply");

interface BridgeEntry {
  eik: string;
  name: string;
  why: string;
}

const loadBridge = (): Map<string, BridgeEntry> => {
  const raw = JSON.parse(fs.readFileSync(BRIDGE_FILE, "utf8")) as {
    bridges: Record<string, BridgeEntry>;
  };
  const m = new Map(Object.entries(raw.bridges));
  // The map is curated, so its own integrity is asserted here rather than trusted: two np-
  // keys pointing at one БУЛСТАТ would merge two people's public money.
  const targets = new Set<string>();
  for (const [k, v] of m) {
    if (!/^np-[0-9a-f]{12}$/.test(k))
      throw new Error(`bridge: '${k}' is not an np- key`);
    if (!/^\d{9}$/.test(v.eik))
      throw new Error(`bridge: ${k} → '${v.eik}' is not a 9-digit EIK`);
    if (/^0{6,}\d{1,3}$/.test(v.eik))
      throw new Error(`bridge: ${k} → '${v.eik}' is a placeholder EIK`);
    if (targets.has(v.eik))
      throw new Error(`bridge: EIK ${v.eik} is the target of two np- keys`);
    targets.add(v.eik);
  }
  return m;
};

/** Report how many `procurement_annexes` ROWS the eviction set orphans. Counts annex rows, not
 *  evictions: one contract amended several times carries several, and it is the rows that lose
 *  their target. Best-effort — a missing database reports "could not check", never "zero". */
const reportAnnexImpact = async (evictedKeys: string[]): Promise<void> => {
  if (!evictedKeys.length) return;
  try {
    const { allRows, end } = await import("../db/lib/pg");
    const [r] = await allRows<{ n: string; k: string }>(
      `SELECT count(*)::text AS n, count(DISTINCT contract_key)::text AS k
         FROM procurement_annexes WHERE contract_key = ANY($1)`,
      [evictedKeys],
    );
    await end();
    const n = Number(r?.n ?? 0);
    if (n)
      console.log(
        `annexes — ${n} procurement_annexes row(s) across ${r.k} contract key(s) lose their ` +
          `target. Re-resolve them:  npm run db:load:annexes:pg   (…:cloud on the served side)`,
      );
    else
      console.log(
        "annexes — no procurement_annexes row targets an evicted row",
      );
  } catch {
    console.log(
      "annexes — could not check (no database reachable). Run `npm run db:load:annexes:pg` " +
        "after the reload regardless; it re-resolves against contracts.",
    );
  }
};

// Re-mint a row's key for a new contractor id, using the formula that ACTUALLY produced its
// current key rather than assuming one.
//
// The three feeds mint keys differently — ЦАИС/OCDS/РОП use
// `releaseId::contractId::eik::tag` while legacy CSV uses
// `legacy::datasetUuid::documentId::eik` — and a previous in-place fix
// (__encode_personal_ids_inplace.ts) shipped the ЦАИС formula onto legacy rows before catching
// it. The wrinkle here is that some legacy rows ALREADY carry a ЦАИС-formula key from that
// episode, so the formula cannot be inferred from `releaseId` either: 4 of the 45 bridged rows
// are `aop-legacy-…` yet hash correctly under the 4-part form.
//
// So: try each candidate formula against the row's EXISTING key, and reuse whichever reproduces
// it. That preserves URL identity by construction and is self-correcting for rows of either
// vintage. If none matches (a key minted by a generator this does not know, or already
// disambiguated by disambiguateContractKeys) the key is left ALONE — a stale-but-stable URL is
// better than a silently re-pointed one, and the row's contractorEik still gets bridged.
const rekey = (r: Contract, eik: string): string => {
  const four = (e: string): string =>
    hashKey(`${r.releaseId}::${r.contractId ?? ""}::${e}::${r.tag}`);
  if (four(r.contractorEik) === r.key) return four(eik);
  const legacy = /^aop-legacy-(.+)-([^-]+)$/.exec(r.releaseId ?? "");
  if (legacy) {
    const asLegacy = (e: string): string =>
      hashKey(`legacy::${legacy[1]}::${e}`);
    if (asLegacy(r.contractorEik) === r.key) return asLegacy(eik);
  }
  return r.key;
};

const isYearDir = (n: string): boolean => /^\d{4}$/.test(n);

// PREFLIGHT — refuse to run before backfill_unp.ts.
//
// The DESTRUCTIVE failure this originally guarded is gone: identity E requires a `unp`, so an
// unbackfilled corpus now yields 0 groups and 0 evictions rather than the 26 wrong evictions
// (€184,136,811.83, all against a DIFFERENT procedure) the old contract-number-keyed identity
// produced. Re-measured after the identity change, not assumed.
//
// It is still load-bearing, for the opposite reason: a pre-backfill run is a SILENT no-op. It
// evicts nothing, proposes nothing, and every check in stage 3 passes — so without this
// preflight the pass would report success on a corpus it never had the keys to reconcile, and
// the operator would move on believing the step had run.
//
// Empirically the corpus sits at ~71% УНП coverage after backfill_unp (289,449 of 405,711); the
// floor is set well below that but far above the near-zero of an unbackfilled tree.
const UNP_COVERAGE_FLOOR = 0.4;

const preflight = (rows: Contract[]): void => {
  const withUnp = rows.filter((r) => r.unp).length;
  const share = rows.length ? withUnp / rows.length : 0;
  if (share < UNP_COVERAGE_FLOOR) {
    throw new Error(
      `refusing to run: only ${(share * 100).toFixed(1)}% of ${rows.length} rows carry a УНП ` +
        `(floor ${(UNP_COVERAGE_FLOOR * 100).toFixed(0)}%). This pass MUST run after ` +
        `scripts/procurement/backfill_unp.ts --apply — without the УНП its contract identity ` +
        `collapses to (contract number, tag) and it evicts across unrelated procedures.`,
    );
  }
  console.log(
    `preflight — УНП coverage ${(share * 100).toFixed(1)}% (${withUnp}/${rows.length})`,
  );
};

const main = async (): Promise<void> => {
  const bridge = loadBridge();
  const shards = new Map<string, Contract[]>();
  for (const y of fs.readdirSync(MONTH_DIR).filter(isYearDir)) {
    const dir = path.join(MONTH_DIR, y);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const p = path.join(dir, f);
      const rows = JSON.parse(fs.readFileSync(p, "utf8")) as Contract[];
      if (Array.isArray(rows)) shards.set(p, rows);
    }
  }

  const beforeRows = [...shards.values()].reduce((s, r) => s + r.length, 0);
  const beforeEur = [...shards.values()]
    .flat()
    .reduce((s, r) => s + (r.amountEur ?? 0), 0);
  preflight([...shards.values()].flat());

  // ── STAGE 1 — apply the identity bridge.
  // Rewrites contractorEik and RE-MINTS the row key, which is derived from it. Verified to
  // create no key collision, either against an existing row or between two bridged rows, so no
  // collapse is needed; the assertion below keeps that true.
  let bridged = 0;
  const allKeys = new Set<string>();
  for (const rows of shards.values()) for (const r of rows) allKeys.add(r.key);
  for (const rows of shards.values()) {
    for (const r of rows) {
      const b = bridge.get(r.contractorEik);
      if (!b) continue;
      const next = rekey(r, b.eik);
      if (next !== r.key && allKeys.has(next)) {
        throw new Error(
          `bridge would collide: ${r.key} → ${next} (${r.contractorEik} → ${b.eik}). ` +
            `Resolve by hand; do not collapse silently.`,
        );
      }
      allKeys.delete(r.key);
      allKeys.add(next);
      r.contractorEik = b.eik;
      r.key = next;
      bridged++;
    }
  }

  // ── STAGE 2 — cross-source eviction on identity E, now that both sides share a supplier
  // identity AND (post-backfill) a УНП.
  //
  // WHAT CHANGED, AND WHY THE OLD SHAPE FOUND NOTHING. This stage used to run
  // `evictSupersededEopTwins` over an eop-vs-everything-else split and then check for a survivor
  // on (УНП, contract number, tag). Both halves were wrong:
  //
  //   - The two-feed split cannot express `aop`↔`rop` or `aop`↔`ocds` at all, because neither
  //     side is `eop-`. That is 11 of the 73 resolvable side-pairs.
  //   - `contract_id` DIFFERS across feeds on ~99% of real twins, so the survivor check blocked
  //     essentially everything: measured 29 candidates, 29 blocked, 0 evicted — and it printed
  //     "✓ verification passed" over the no-op, because the checks could not tell "nothing to do"
  //     from "everything blocked". The non-zero-work assertion in stage 3 now closes that.
  //
  // The analysis itself lives in cross_source.ts, shared with the read-only harness so the two
  // can never report different populations. CORPUS-WIDE, not per shard: shard placement is driven
  // by `date`, and the feeds date the same contract differently, so a twin pair routinely
  // straddles two month files — a per-shard pass silently cannot pair them, which looks identical
  // to "no duplicate found".
  const allRows = [...shards.values()].flat();
  const analysis = analyzeCrossSource(allRows);
  const { evictions } = analysis;

  // BLOCKED WORK IS PRINTED IN FULL, ALWAYS — never summarised to a count. Each of these is a
  // human-triage item, and a count tells nobody which.
  if (analysis.ambiguous.length) {
    console.log(
      `stage 2 — ${analysis.ambiguous.length} AMBIGUOUS group(s): a feed contributed >1 row, so ` +
        `no 1:1 twin exists. Left in place.`,
    );
    for (const g of analysis.ambiguous) {
      const shape = [...new Set(g.rows.map(feedOf))]
        .map((f) => `${f}×${g.rows.filter((r) => feedOf(r) === f).length}`)
        .join(" ");
      console.log(
        `   ${g.rows[0].unp}  ${shape}  eik=${g.rows[0].contractorEik} ` +
          `€${(g.rows[0].amountEur ?? 0).toFixed(2)} signed=${signingDay(g.rows[0])}`,
      );
    }
  }
  if (analysis.blocked.length) {
    console.log(
      `stage 2 — ${analysis.blocked.length} side-pair(s) BLOCKED by a precondition:`,
    );
    for (const p of analysis.blocked)
      console.log(
        `   ${p.winner.unp}  keep ${p.winner.feed}:${p.winner.contractId} ` +
          `(${p.winner.rows.length} row(s), €${p.winner.eur.toFixed(2)})  vs  ` +
          `${p.loser.feed}:${p.loser.contractId} (${p.loser.rows.length} row(s), ` +
          `€${p.loser.eur.toFixed(2)})  matched=${p.matched} — ${p.blockedReason}`,
      );
  }

  if (evictions.length) {
    const dropped = new Set(evictions.map((e) => e.row));
    for (const [p, rows] of shards) {
      if (!rows.some((r) => dropped.has(r))) continue;
      shards.set(
        p,
        rows.filter((r) => !dropped.has(r)),
      );
    }
  }

  // ── STAGE 3 — verify BEFORE writing. Every failure in this area reported a plausible count
  // while corrupting data, so the checks are on named pairs and totals, and any violation aborts.
  const afterAll = [...shards.values()].flat();
  const afterRows = afterAll.length;
  const afterEur = afterAll.reduce((s, r) => s + (r.amountEur ?? 0), 0);
  const evictedEur = evictions.reduce((s, e) => s + (e.row.amountEur ?? 0), 0);

  console.log(`stage 1 — bridged ${bridged} row(s) via ${bridge.size} entries`);
  console.log(
    `stage 2 — evicted ${evictions.length} row(s), €${evictedEur.toFixed(2)} ` +
      `from ${analysis.sidePairs.filter((p) => p.eligible).length} eligible side-pair(s)`,
  );
  // (1) PAIRS, NEVER COUNTS. Both sides fully identified, so an eviction can be checked against
  // the source by hand rather than taken on trust.
  for (const e of evictions.slice(0, 20))
    console.log(`   ${describeRow(e.row)}\n     → ${describeRow(e.survivor)}`);
  if (evictions.length > 20) console.log(`   … ${evictions.length - 20} more`);

  // THE VALIDATION PROTOCOL, extracted to cross_source.ts so the checks themselves are
  // unit-tested. "The pass may not write without it" only means something if each check is
  // proven to fire — see cross_source.test.ts, which restores each defect and asserts the
  // corresponding problem is reported.
  //
  // It covers plan §T3 items 1-5 and 7 (pairs not counts, named surviving twin, no procedure
  // lost, € delta, row-count delta, eligible-work-actually-done) plus the annex report (8)
  // below. Item 6 — reconciling per-contract totals against the PUBLISHED contract value — is
  // NOT implemented here and is the one external cross-check missing: everything above is an
  // internal consistency check on the analysis, so a mis-attribution both halves agree on would
  // pass. The published value lives in the tender corpus, which this pass does not load;
  // `invariants_pg.data.test.ts` and the amount_overrides canary cover it post-load instead.
  const problems = verifyEviction({
    before: allRows,
    after: afterAll,
    analysis,
  });

  console.log(
    `stage 3 — rows ${beforeRows} → ${afterRows}; € ${beforeEur.toFixed(2)} → ${afterEur.toFixed(2)}`,
  );
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error("aborting; nothing written");
    process.exitCode = 1;
    return;
  }
  console.log("✓ verification passed");

  // (8) ANNEX ACCOUNTING — a required, visible consequence rather than a failure.
  // `procurement_annexes.contract_key` points at `contracts.key`, so an evicted row orphans its
  // annexes until `db:load:annexes:pg` re-resolves them against the reloaded corpus. Nothing
  // runs that automatically on the cloud side, and a skipped reload silently drops those annexes
  // from the per-annex breakdown and the чл.116 ал.2/ал.3 labelling on the contract page.
  //
  // Postgres-only and best-effort: on a machine with no database this reports that it could not
  // check, which is different from reporting zero.
  await reportAnnexImpact(evictions.map((e) => e.row.key));

  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to write");
    return;
  }
  for (const [p, rows] of shards) {
    fs.writeFileSync(p, JSON.stringify(rows, null, 2) + "\n");
  }
  console.log(`applied — wrote ${shards.size} shard(s)`);
  console.log(
    "Next: npm run proc:rebuild-derived && npm run db:load:pg && npm run db:load:annexes:pg",
  );
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
