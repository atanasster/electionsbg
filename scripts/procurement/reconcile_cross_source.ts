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
import { evictSupersededEopTwins, isEopSourced } from "./content_key";
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

// Contract identity for the verification stage — post-backfill both feeds carry a УНП.
const contractOf = (r: Contract): string =>
  `${r.unp ?? ""}::${r.contractId ?? ""}::${r.tag}`;

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
// Out of order this pass does not fail, it destroys: with `unp` absent, `contractOf` degrades to
// (contractId, tag), which is effectively the (buyer, contract number, tag) key that removed 46
// legitimate rows / €5.15m in an earlier attempt. Simulated on this corpus: 26 evictions,
// €184,136,811.83, all 26 against a DIFFERENT procedure — and stage 3 stayed green, because its
// checks cannot see a wrong-but-consistent eviction.
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

const main = (): void => {
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

  // ── STAGE 2 — cross-source eviction, now that both sides share a supplier identity.
  //
  // CORPUS-WIDE, not per shard. Shard placement is driven by `date`, and the two feeds date the
  // same contract differently — `date_signed` differed on 9 of 9 identical-supplier pairs — so a
  // twin pair routinely straddles two month files. 05397-2020-0006/103 is the worked example:
  // the OCDS row sits in 2020-11.json (2020-11-20) and its EOP twin in 2020-12.json
  // (2020-12-18), same supplier EIK 130545438 and same buyer. A per-shard pass silently cannot
  // pair them, which looks identical to "no duplicate found".
  const allRows = [...shards.values()].flat();
  const eop = allRows.filter(isEopSourced);
  const auth = allRows.filter((r) => !isEopSourced(r));
  const { kept } = evictSupersededEopTwins(eop, auth);
  const keptSet = new Set(kept);
  const evictions: Array<{ row: Contract; survivors: Contract[] }> = [];
  // Survivors are looked up by contract identity across the whole corpus, for the same reason.
  const authByContract = new Map<string, Contract[]>();
  for (const a of auth) {
    const c = contractOf(a);
    const arr = authByContract.get(c);
    if (arr) arr.push(a);
    else authByContract.set(c, [a]);
  }
  // A STRICTER survivor check than the library's, and this is the right place for it. The
  // precondition inside evictSupersededEopTwins is deliberately УНП-free so it stays computable
  // at parse time, where the OCDS export has no УНП. Corpus-wide that is too permissive: buyers
  // reuse contract numbers across procedures, so (buyer, contract number, tag) finds a
  // "survivor" belonging to a different award, and the `f:` net — buyer + supplier + date +
  // amount, no contract number — then supplies a bogus match. Measured: 29 evictions whose own
  // contract had no row left, including 01379-2020-0146/0032-МЕР at €7.66m.
  //
  // Here, post-backfill, both feeds carry the УНП, so the full contract identity is available
  // and is used. Candidates without a same-contract survivor are simply not evicted rather than
  // aborting the run — a permissive matcher proposing a bad candidate is expected; acting on it
  // is what must not happen.
  const blockedRows: Contract[] = [];
  for (const r of eop) {
    if (keptSet.has(r)) continue;
    const survivors = authByContract.get(contractOf(r)) ?? [];
    if (!survivors.length) {
      blockedRows.push(r);
      continue;
    }
    evictions.push({ row: r, survivors });
  }
  const blocked = blockedRows.length;
  if (blocked) {
    console.log(
      `stage 2 — ${blocked} candidate(s) BLOCKED: matched a row from another contract`,
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
  // while corrupting data, so the checks are on pairs and totals, and any violation aborts.
  const orphans = evictions.filter((e) => e.survivors.length === 0);
  const afterRows = [...shards.values()].reduce((s, r) => s + r.length, 0);
  const afterEur = [...shards.values()]
    .flat()
    .reduce((s, r) => s + (r.amountEur ?? 0), 0);
  const evictedEur = evictions.reduce((s, e) => s + (e.row.amountEur ?? 0), 0);

  console.log(`stage 1 — bridged ${bridged} row(s) via ${bridge.size} entries`);
  console.log(
    `stage 2 — evicted ${evictions.length} row(s), €${evictedEur.toFixed(2)}`,
  );
  for (const e of evictions.slice(0, 20)) {
    console.log(
      `   ${e.row.unp}/${e.row.contractId} ${(e.row.contractorName ?? "").slice(0, 24)} ` +
        `€${(e.row.amountEur ?? 0).toFixed(2)} → survivor: ` +
        `${(e.survivors[0]?.contractorName ?? "NONE").slice(0, 24)}`,
    );
  }
  if (evictions.length > 20) console.log(`   … ${evictions.length - 20} more`);

  const problems: string[] = [];
  // NOT the `orphans` filter over `evictions` — that is provably empty, because a candidate
  // without a survivor is `continue`d above and never pushed. A first draft asserted exactly
  // that and was therefore a dead check that could never fail. The real post-condition is over
  // the WRITTEN corpus: every contract that lost a row must still have one.
  if (orphans.length)
    problems.push(
      `internal: ${orphans.length} eviction(s) recorded with no survivor — unreachable, ` +
        `the candidate filter should have blocked them`,
    );
  const survivingContracts = new Set(
    [...shards.values()].flat().map(contractOf),
  );
  const emptied = [...new Set(evictions.map((e) => contractOf(e.row)))].filter(
    (c) => !survivingContracts.has(c),
  );
  if (emptied.length)
    problems.push(
      `${emptied.length} contract(s) have NO row left after eviction: ` +
        `${emptied.slice(0, 5).join(", ")}`,
    );
  if (afterRows !== beforeRows - evictions.length)
    problems.push(
      `row count moved by ${afterRows - beforeRows}, expected ${-evictions.length}`,
    );
  if (Math.abs(beforeEur - afterEur - evictedEur) > 0.01)
    problems.push(
      `€ delta ${(beforeEur - afterEur).toFixed(2)} ≠ Σ evicted ${evictedEur.toFixed(2)}`,
    );

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

  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to write");
    return;
  }
  for (const [p, rows] of shards) {
    fs.writeFileSync(p, JSON.stringify(rows, null, 2) + "\n");
  }
  console.log(`applied — wrote ${shards.size} shard(s)`);
  console.log(
    "Next: npx tsx scripts/procurement/rebuild_from_cache.ts && npm run db:load:pg",
  );
};

main();
