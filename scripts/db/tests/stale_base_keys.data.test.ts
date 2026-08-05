// Tier 3 (Postgres-native) — the standing gate against stale-base-key orphans in the legacy corpus.
//
// ── WHAT IT CATCHES, AND WHY A GATE RATHER THAN A ONE-SHOT ──────────────────────────────────
//
// `legacy_csv.ts` mints `key = hashKey("legacy::${datasetUuid}::${documentId}::${contractorEik}")`
// and `disambiguateContractKeys` re-keys colliding rows to `hashKey("${base}::${contractId}::${amount}")`.
// The month-shard merge is a UNION KEYED ON `Contract.key`, so when that formula changed, the rows
// carrying the OLD key matched nothing on re-ingest and were never evicted — they are still there,
// identity-identical to their own re-keyed selves, double-counting.
//
// That is the SECOND time this exact mechanism has bitten: `dedup_legacy_twins.ts` documents the
// first (the `…-x` blank-document-id class, ~34k pairs / ~€11bn), and each occurrence has needed
// its own bespoke one-shot found by hand, years late. The general defect is that a key-formula
// change has no orphan sweep, and nothing fails when one leaks. This gate is that missing alarm:
// the NEXT change to a contract-key formula fails here instead of silently inflating the corpus.
//
// It imports `analyzeStaleBaseKeys` from `scripts/procurement/stale_base_keys.ts` — the SAME
// detection `dedup_stale_base_keys.ts` removes rows with, never a re-implementation. A lookalike is
// how this plan family's numbers went wrong before (v1 §6), and here it would be worse than wrong:
// the gate would police a population the sweep does not act on.
//
// ── WHY THERE IS AN ALLOWLIST ───────────────────────────────────────────────────────────────
//
// The sweep is written and verified but NOT YET APPLIED — it deletes from a gitignored tree that is
// not recoverable from git and needs a corpus reload behind it, so running it is an operator action
// (`npm run proc:dedup-stale-keys`, then the same command with `-- --apply`). Until then the corpus
// legitimately carries the 30 known orphans, and a gate demanding zero would ship red and be
// ignored, which is worse than no gate.
//
// So BOTH allowlists are asserted EXHAUSTIVE **and** MINIMAL, the same contract
// `single_source_per_contract.data.test.ts` uses: a NEW orphan fails immediately, and once the
// sweep runs the minimality tests fail until the entries are deleted. Neither can rot.
//
// ── THE HOLE THAT ONLY OPENS LATER, AND WHY preflightOrder() IS ASSERTED ────────────────────
//
// A detection gate whose expected answer is "none" passes just as happily when the detector has
// stopped working. Today that is masked: `KNOWN_STALE` is non-empty, so a detector returning
// nothing fails the minimality test. The header above tells you to delete those entries after the
// sweep — and from that moment the mask is gone, and an empty `contracts` table or a corpus run
// after `fix_amount_overrides.ts` (which rewrites `amount`, the input `currentKeyOf` derives from)
// yields zero pairs and a green gate for ever.
//
// `preflightOrder()` is the same self-check the sweep runs before it will delete anything, and
// asserting it here closes both cases in one call: it fails on an empty legacy corpus and on one
// whose keys no longer reproduce. Keep it even after the allowlists empty — especially then.
//
//   npm run test:data
//
// Requires the Postgres store; auto-skips when Postgres is unreachable or the contracts table is
// absent, like invariants_pg.data.test.ts.
//
// Plan: docs/plans/procurement-same-feed-dedup-v1.md §5.3 (this gate), §5.2 (the sweep).

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import {
  analyzeStaleBaseKeys,
  preflightOrder,
  type StaleAnalysis,
} from "../../procurement/stale_base_keys";
import type { Contract, ContractTag } from "../../procurement/types";

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.contracts') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / contracts table absent";

afterAll(async () => {
  await end();
});

// The 30 orphans `dedup_stale_base_keys.ts` is written to remove, by evicted key. Every one is a
// row whose key is the bare base key and whose identity-identical twin carries the current formula.
// Measured 2026-08-04: €2,068,182.74, all in the 2020 shards.
//
// DELETE THESE ENTRIES once `npm run proc:dedup-stale-keys -- --apply` has run and the corpus is
// reloaded. The "every allowlisted orphan still exists" test fails until you do.
const KNOWN_STALE = new Set([
  "8aec19ee3e23",
  "5c9041b54402",
  "6aa560193173",
  "43dc6f4fbedf",
  "230481e49c02",
  "ead302ce1ecd",
  "324f9f3ea727",
  "aa5a147a9fd2",
  "1e248d9a044f",
  "567c647af11f",
  "7cd3408882c8",
  "0c81d658c736",
  "2550f8083144",
  "d4fd3279db7d",
  "57e0f58a6eb2",
  "a17f37e4da86",
  "e0373edec6b4",
  "5ad6bb8dffd3",
  "5607442c0929",
  "c402c857b2e2",
  "08f5d01debe3",
  "47c828de4f2a",
  "f5d608992acc",
  "43ba8200da44",
  "a6fc92d6d693",
  "8bb38bd1514d",
  "80171dc238db",
  "049a25a3f6da",
  "462248956628",
  "1f11afd6a17e",
]);

// The two 2022/2023 groups where NO member carries the bare base key, so the sweep's rule cannot
// name a survivor: their second key matches neither formula and its mint-time derivation could not
// be reconstructed. Reported by the sweep, never evicted, and pinned here — exhaustively AND
// minimally — so the pair neither grows nor outlives its triage. Plan §5.2.
const KNOWN_UNACTED = new Set([
  "1812010648c3|fdbe720a5d00",
  "ad7a788c3cc2|c20e187ed315",
]);

interface PgRow {
  key: string;
  ocid: string;
  release_id: string;
  contract_id: string | null;
  tag: string;
  date: string;
  date_signed: string | null;
  awarder_eik: string;
  awarder_name: string;
  contractor_eik: string;
  contractor_eik_full: string | null;
  contractor_name: string;
  amount: number | null;
  currency: string | null;
  amount_eur: number | null;
  title: string;
  cpv: string | null;
  unp: string | null;
  bundle_uuid: string;
  number_of_tenderers: number | null;
  procurement_method: string | null;
  category: string | null;
  eu_funded: number | null;
  eu_program: string | null;
  signing_amount_eur: number | null;
}

// Only the legacy feed can carry this defect — the base-key formula is `legacy_csv.ts`'s alone.
//
// `obed-` rows are EXCLUDED for the same reason `pg_roundtrip.data.test.ts` excludes them: they are
// synthetic consortium carriers minted by 087 INSIDE Postgres, so they exist here and on no shard.
// Three of them carry legacy ocids and land in real base groups. It changes no verdict today
// (30/0/2 either way), but without this the gate's population differs from the sweep's, and a gate
// policing a different set from the pass it guards is exactly the drift this file argues against.
const LEGACY_SQL = `
  SELECT key, ocid, release_id, contract_id, tag, date, date_signed, awarder_eik, awarder_name,
         contractor_eik, contractor_eik_full, contractor_name, amount, currency, amount_eur,
         title, cpv, unp, bundle_uuid, number_of_tenderers, procurement_method, category,
         eu_funded, eu_program, signing_amount_eur
    FROM contracts
   WHERE ocid LIKE 'aop-legacy-%'
     AND contractor_eik NOT LIKE 'obed-%'`;

const toContract = (r: PgRow): Contract =>
  ({
    key: r.key,
    ocid: r.ocid,
    releaseId: r.release_id,
    contractId: r.contract_id ?? undefined,
    tag: r.tag as ContractTag,
    date: r.date,
    dateSigned: r.date_signed ?? undefined,
    awarderEik: r.awarder_eik,
    awarderName: r.awarder_name,
    contractorEik: r.contractor_eik,
    contractorEikFull: r.contractor_eik_full ?? undefined,
    contractorName: r.contractor_name,
    amount: r.amount ?? undefined,
    currency: r.currency ?? undefined,
    amountEur: r.amount_eur ?? undefined,
    title: r.title,
    cpv: r.cpv ?? undefined,
    unp: r.unp ?? undefined,
    bundleUuid: r.bundle_uuid,
    numberOfTenderers: r.number_of_tenderers ?? undefined,
    procurementMethod: r.procurement_method ?? undefined,
    category: r.category ?? undefined,
    euFunded: r.eu_funded == null ? undefined : !!r.eu_funded,
    euProgram: r.eu_program ?? undefined,
    signingAmountEur: r.signing_amount_eur ?? undefined,
    // Not selected: `identityOf` excludes it by name and no key derivation reads it. The field is
    // non-optional on Contract, so a placeholder is required rather than chosen.
    sourceUrl: "",
  }) as Contract;

// Loaded and analysed ONCE. Besides the cost (~245k rows, ~3 s per pass), running it per test would
// derive the exhaustive and the minimal assertions from three different MVCC snapshots — so a
// corpus reload mid-run could let both pass against states that never coexisted.
let cached: { rows: Contract[]; analysis: StaleAnalysis } | null = null;
const analyzed = async (): Promise<{
  rows: Contract[];
  analysis: StaleAnalysis;
}> => {
  if (!cached) {
    const rows = (await allRows<PgRow>(LEGACY_SQL)).map(toContract);
    cached = { rows, analysis: analyzeStaleBaseKeys(rows) };
  }
  return cached;
};

const pairKey = (rows: Contract[]): string =>
  rows
    .map((r) => r.key)
    .sort()
    .join("|");

test.skipIf(skip)(
  "the detector can still see — keys reproduce and the legacy corpus is present",
  async () => {
    // THE ANTI-VACUOUS-PASS CHECK. Every other assertion here expects "none", which is also what a
    // broken detector returns. See the header: this is the one test that must survive the
    // allowlists being emptied.
    const { rows } = await analyzed();
    assert.equal(
      preflightOrder(rows),
      null,
      `stale-base-key detection cannot run against this corpus, so every "no orphans" result ` +
        `below would be vacuous.\n  Either the legacy corpus is absent, or the key inputs have ` +
        `been rewritten since minting — \`fix_amount_overrides.ts\` rewrites \`amount\`, which ` +
        `is what \`currentKeyOf\` derives from.\n  See docs/plans/procurement-same-feed-dedup-v1.md §5.3.`,
    );
  },
);

test.skipIf(skip)(
  "no NEW legacy row carries a superseded bare base key",
  async () => {
    const { analysis } = await analyzed();
    const fresh = analysis.pairs.filter((p) => !KNOWN_STALE.has(p.evicted.key));
    const eur = fresh.reduce((s, p) => s + (p.evicted.amountEur ?? 0), 0);
    assert.equal(
      fresh.length,
      0,
      `${fresh.length} legacy row(s) carry a key from a SUPERSEDED formula while an ` +
        `identity-identical twin carries the current one — double-counting €${eur.toFixed(2)}.\n` +
        `This is the shard merge keying on \`Contract.key\`: a key-formula change leaves the ` +
        `old-keyed row behind for ever, and no other pass can see it (dedup_contract_keys.ts ` +
        `groups by the STORED key, so a stale-keyed row is a singleton group and is skipped).\n` +
        fresh
          .slice(0, 8)
          .map(
            (p) =>
              `  ${p.evicted.key} → ${p.survivor.key}  ${p.evicted.ocid} ` +
              `${p.evicted.contractId ?? "-"} €${(p.evicted.amountEur ?? 0).toFixed(2)}`,
          )
          .join("\n") +
        `\n  Inspect with \`npm run proc:dedup-stale-keys\` (dry run), then the same command ` +
        `with \`-- --apply\`.\n  Do NOT add these to KNOWN_STALE — that list is the pre-existing ` +
        `backlog, not a suppression.\n  See docs/plans/procurement-same-feed-dedup-v1.md §3.2.`,
    );
  },
);

test.skipIf(skip)(
  "every allowlisted orphan still exists (KNOWN_STALE stays minimal)",
  async () => {
    // Once the sweep runs, these rows are gone and their entries must go with them — otherwise the
    // list silently licenses a future regression on those exact keys. Same exhaustive-AND-minimal
    // contract as single_source_per_contract's ACCEPTED_CONFLICTS, and it fires in the good
    // direction: the fix makes it red.
    const { analysis } = await analyzed();
    const live = new Set(analysis.pairs.map((p) => p.evicted.key));
    const gone = [...KNOWN_STALE].filter((k) => !live.has(k));
    assert.deepEqual(
      gone,
      [],
      `KNOWN_STALE lists ${gone.length} orphan(s) absent from THIS database: ${gone.join(", ")}.\n` +
        `  If the sweep has been applied and the corpus reloaded — good, that is the intended ` +
        `end state: delete those entries.\n` +
        `  If this database simply predates them, load the current corpus; do not edit the list.`,
    );
  },
);

test.skipIf(skip)(
  "no bare-key row sits in a group the sweep would refuse",
  async () => {
    // `unresolved` is a bare-key orphan whose identity-identical twin is NOT re-derivable, so no
    // survivor can be named and the sweep declines it. There are none today, and one appearing
    // means a duplicate nothing can clean up automatically — worth failing on, not just printing.
    const { analysis } = await analyzed();
    assert.equal(
      analysis.unresolved.length,
      0,
      `${analysis.unresolved.length} bare-key group(s) have no re-derivable survivor:\n` +
        analysis.unresolved
          .slice(0, 8)
          .map((u) => `  base=${u.base} — ${u.reason}`)
          .join("\n") +
        `\n  Triage by hand against the raw CSV — plan §5.2. Never delete one of these by key.`,
    );
  },
);

test.skipIf(skip)(
  "the un-actionable duplicate groups are exactly the known two",
  async () => {
    // Identity-identical legacy duplicates where NO member carries the bare base key, so no
    // survivor is re-derivable and the sweep refuses them. Asserted BOTH ways: a new one is a
    // regression, and a vanished one means the list outlived its triage.
    const { analysis } = await analyzed();
    const live = new Set(analysis.unactedDuplicates.map(pairKey));
    const fresh = analysis.unactedDuplicates.filter(
      (rs) => !KNOWN_UNACTED.has(pairKey(rs)),
    );
    assert.equal(
      fresh.length,
      0,
      `${fresh.length} identity-identical legacy duplicate group(s) appeared that no rule can ` +
        `resolve — no member carries the bare base key, so no survivor can be named.\n` +
        fresh
          .slice(0, 8)
          .map(
            (rs) =>
              `  ${rs.map((r) => r.key).join(" + ")}  ${rs[0].ocid} ` +
              `${rs[0].contractId ?? "-"} €${(rs[0].amountEur ?? 0).toFixed(2)}`,
          )
          .join("\n") +
        `\n  These need hand triage against the raw CSV before anything touches them — plan §5.2.`,
    );
    const gone = [...KNOWN_UNACTED].filter((k) => !live.has(k));
    assert.deepEqual(
      gone,
      [],
      `KNOWN_UNACTED lists ${gone.length} group(s) absent from THIS database: ${gone.join(", ")}.\n` +
        `  If they have been triaged and resolved, delete the entries — a stale one licenses a ` +
        `future regression on those keys.`,
    );
  },
);
