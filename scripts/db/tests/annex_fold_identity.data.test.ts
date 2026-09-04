// The annex linkage must be trustworthy in three independent ways: an annex must carry the RIGHT
// contract's value (the fold identity, below), it must still be ATTACHED to a contract at all (the
// orphan gate), and the TWO CONSUMERS of lib/annexResolve.ts must attach the same annexes (the
// divergence gate, at the foot of this file). The second is the cheaper failure and the one that
// recurs — every eviction pass orphans the annexes of the rows it removes, and only
// `db:load:annexes:pg` re-resolves them. The third went unnoticed for months precisely because
// this file compared CONTRACTS and never annex RECORDS.
//
// ── THE FOLD IDENTITY ───────────────────────────────────────────────────────────────────────
//
// The annex fold must never assign a contract another contract's value.
//
// WHY: the УНП+supplier (K2) join key is lot-agnostic, so one supplier holding
// several contracts under one procedure used to merge their annexes into one
// accumulator — anchoring on contract A's earliest annex while serving contract
// B's latest value, past every guard (a perfect continuity match). On УНП
// 00536-2023-0049 that folded Дансон трейдинг's №4354/15.04.2024 from
// €352,343.97 to €158,991.32: a fabricated −€193,352.65 from two zero-diff
// annexes. resolveAnnexKey now refuses a provably multi-contract key
// (annexResolve.ts, guard 4); this gate holds the OUTCOME in Postgres, where
// the fold and the annexes loader meet.
//
// THE INVARIANT: a single-supplier contract whose annexes the loader attached
// via the contract-precise key (match_via='contract_no') must carry ONE of its
// own latest-date annex values — within a cent, either as amount_eur (the fold
// flipped it) or as amount_eur == signing when the annex moved nothing. The SQL
// mirrors the fold's semantics deliberately: the ordering key is
// coalesce(publication_date, contract_date, '') (the fold's `pub`), ties on
// that key are accepted if ANY tied value matches (the fold's tie-break is
// first-in-file-order, which SQL cannot reconstruct), and a NULL amount_eur on
// a matched contract counts as a violation, not an exemption. Consortium rows
// are excluded — their amount_eur is a per-supplier split of the full annex
// value — via the row-count proxy `(unp, contract_id) has one contract row`;
// see the failure message for the one shape the proxy cannot see.
//
// Skips only when Postgres itself is down; an unloaded annexes table is an
// ASSERTION, not a skip (the kzk_decisions.data.test.ts convention) — an empty
// linkage corpus is this gate's greenest and most useless state.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, dbReachable, withClient, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import {
  buildAnnexIndex,
  consortiumGroupKey,
  membersByConsortiumGroup,
  resolveAnnexKey,
  type ContractBasis,
} from "../../procurement/lib/annexResolve";
import type { Contract } from "../../procurement/types";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

// The general invariant. `sibs` counts sibling rows with a window over
// (unp, contract_id) — identical NULL-grouping semantics to an
// IS-NOT-DISTINCT-FROM self-join, but hashable: the join form re-ran the 405k
// row aggregate once per candidate (4.2s idle, worse the redder it gets); this
// shape is one pass (~0.9s measured). A contract is flagged when NO latest-date
// annex value matches its amount_eur (bool_or over the ties), including a NULL
// amount_eur on a matched contract.
const GENERAL_SQL = `
  WITH own AS (
    SELECT contract_key,
           max(coalesce(publication_date, contract_date, '')) AS pub
    FROM procurement_annexes
    WHERE match_via = 'contract_no'
    GROUP BY 1
  ),
  latest AS (
    SELECT o.contract_key, a.current_value_eur
    FROM own o
    JOIN procurement_annexes a
      ON a.contract_key = o.contract_key
     AND a.match_via = 'contract_no'
     AND coalesce(a.publication_date, a.contract_date, '') = o.pub
  ),
  sibs AS (
    SELECT key, unp, contract_id, contractor_name, amount_eur,
           count(*) OVER (PARTITION BY unp, contract_id) AS n
    FROM contracts
    WHERE tag = 'contract'
  )
  SELECT c.key, c.unp, c.contract_id, c.contractor_name,
         c.amount_eur::text AS amount_eur,
         string_agg(DISTINCT l.current_value_eur::text, ' | ') AS own_annex
  FROM sibs c
  JOIN latest l ON l.contract_key = c.key
  WHERE c.n = 1
  GROUP BY c.key, c.unp, c.contract_id, c.contractor_name, c.amount_eur
  HAVING NOT bool_or(
    c.amount_eur IS NOT NULL
    AND abs(c.amount_eur - l.current_value_eur) <= 0.01
  )
`;

interface ViolationRow {
  key: string;
  unp: string | null;
  contract_id: string | null;
  contractor_name: string | null;
  amount_eur: string | null;
  own_annex: string;
}

// The orphan query, hoisted so the gate and the discrimination proof below run the SAME SQL —
// a proof against a lookalike query proves nothing about the gate.
const ORPHAN_SQL = `
  SELECT a.contract_key, count(*)::text AS n,
         string_agg(DISTINCT a.notice_id::text, ',' ORDER BY a.notice_id::text) AS notice_ids
    FROM procurement_annexes a
   WHERE NOT EXISTS (SELECT 1 FROM contracts c WHERE c.key = a.contract_key)
   GROUP BY a.contract_key
   ORDER BY count(*) DESC
`;

interface OrphanRow {
  contract_key: string;
  n: string;
  notice_ids: string;
}

const formatViolations = (rows: ViolationRow[]): string[] =>
  rows.map(
    (r) =>
      `${r.key} ${r.unp ?? ""}/${r.contract_id ?? ""} ${r.contractor_name ?? ""}: ` +
      `amount ${r.amount_eur ?? "NULL"} ∉ own annex {${r.own_annex}}`,
  );

test.skipIf(skip)(
  "the annexes linkage corpus is populated — the gate is not vacuous",
  async () => {
    const [t] = await allRows<{ present: boolean }>(
      "SELECT to_regclass('public.procurement_annexes') IS NOT NULL AS present",
    );
    assert.ok(
      t.present,
      "procurement_annexes is ABSENT — run `npm run db:load:annexes:pg` " +
        "(applies migration 114; needs the raw_data/procurement/anexi cache).",
    );
    const [cov] = await allRows<{ n: string }>(
      "SELECT count(DISTINCT contract_key)::text AS n FROM procurement_annexes " +
        "WHERE match_via = 'contract_no'",
    );
    assert.ok(
      Number(cov.n) > 0,
      "procurement_annexes has no contract_no-matched rows — the general " +
        "invariant below is vacuously green. Run `npm run db:load:annexes:pg` " +
        "(needs the raw_data/procurement/anexi cache).",
    );
  },
);

test.skipIf(skip)(
  "every annex still points at a live contract (re-resolution was not skipped)",
  async () => {
    // REFERENTIAL half of this file's job: the fold above asks whether an annex carries the RIGHT
    // value, this asks whether it is attached to anything at all.
    //
    // `contract_key` is copied straight off `contracts.key` by `load_annexes_pg.ts`, which
    // TRUNCATEs and rebuilds — so immediately after a load orphans are zero BY CONSTRUCTION. A
    // non-zero count therefore has exactly one meaning: contract rows were removed after the last
    // annexes load and the loader was not re-run.
    //
    // Which happens on a schedule. Every eviction pass orphans the annexes of the rows it removes
    // — `reconcile_cross_source` did it to 16 rows across 9 contract keys on the 2026-08-04 run,
    // and `dedup_stale_base_keys` will do it to 3 more — and CLAUDE.md has long said
    // `db:load:annexes:pg` is mandatory afterwards. Nothing enforced it until now: the orphaned
    // rows simply stopped appearing in the per-annex breakdown and the чл.116 ал.2/ал.3 labelling
    // on `/contract/:key`, with every row count still reconciling and no error anywhere.
    //
    // Zero is the only correct answer, so there is no allowlist. Measured 2026-08-05: 0 of 24,063
    // on local and 0 of 24,063 on Cloud SQL.
    const orphans = await allRows<OrphanRow>(ORPHAN_SQL);
    const rows = orphans.reduce((s, o) => s + Number(o.n), 0);
    assert.equal(
      orphans.length,
      0,
      `${rows} procurement_annexes row(s) across ${orphans.length} contract key(s) reference a ` +
        `contract that no longer exists.\n` +
        `  HOW BAD depends on why the row went. A RE-KEY eviction (a superseded key formula) ` +
        `loses nothing — the surviving twin carries the same annexes under its own key, which is ` +
        `the measured case for both evictions that produce orphans today.\n` +
        `  A row removed WITHOUT a twin does lose them: \`contract_annexes(p_key)\` is the only ` +
        `consumer, so they vanish from the per-annex breakdown and the чл.116 ал.2 vs ал.3 ` +
        `labelling on /contract/:key with nothing failing.\n` +
        `  CAUSE: a pass removed contract rows and \`db:load:annexes:pg\` was not re-run. It ` +
        `re-resolves against the reloaded corpus and is the only thing that does.\n` +
        `  FIX: \`npm run db:load:annexes:pg\` here, and \`npm run db:load:annexes:pg:cloud\` on ` +
        `prod — the cloud side has no automatic path.\n` +
        orphans
          .slice(0, 8)
          .map(
            (o) =>
              `    ${o.contract_key} — ${o.n} annex row(s), notice ${o.notice_ids}`,
          )
          .join("\n"),
    );
  },
);

test.skipIf(skip)(
  "the orphan query still discriminates — an evicted contract is caught",
  async () => {
    // Prove the red path (the person_connections.data.test.ts precedent). A gate whose expected
    // answer is zero is also green when it has stopped looking, and this one runs against a
    // table that is zero by construction after every load — so "0 orphans" on its own is no
    // evidence at all. Delete a contract that HAS annexes, inside a rolled-back transaction, and
    // assert its annexes surface.
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const { rows: victim } = await c.query<{
          contract_key: string;
          n: string;
        }>(
          `SELECT a.contract_key, count(*)::text AS n
             FROM procurement_annexes a
             JOIN contracts c ON c.key = a.contract_key
            GROUP BY a.contract_key
            ORDER BY count(*) DESC
            LIMIT 1`,
        );
        assert.equal(
          victim.length,
          1,
          "no contract carries an annex — the orphan gate is vacuous, not green",
        );
        const { contract_key: key, n } = victim[0];
        await c.query("DELETE FROM contracts WHERE key = $1", [key]);
        const { rows } = await c.query<OrphanRow>(ORPHAN_SQL);
        const hit = rows.find((r) => r.contract_key === key);
        assert.ok(
          hit,
          `deleting contract ${key} orphaned ${n} annex row(s) and the query did NOT flag it — ` +
            "the orphan gate is decorative",
        );
        assert.equal(
          hit.n,
          n,
          "the orphan row count disagrees with the annexes deleted",
        );
      } finally {
        await c.query("ROLLBACK");
      }
    });
  },
);

test.skipIf(skip)(
  "no single-supplier contract contradicts its own contract_no-matched annex",
  async () => {
    const rows = await allRows<ViolationRow>(GENERAL_SQL);
    assert.deepEqual(
      formatViolations(rows),
      [],
      "contract(s) serving a value that matches NONE of their own " +
        "precisely-matched latest annex values — the multi-contract key " +
        "collision shape. Re-run `anexi_current_value --apply` → " +
        "`rebuild_from_cache` → `db:load:pg` → `db:load:annexes:pg`; if it " +
        "persists, the resolver's ambiguity refusal regressed (annexResolve.ts " +
        "guard 4). ONE benign shape the single-supplier proxy cannot see: if " +
        "amount ≈ own annex / N for a small integer N, the annex FEED's " +
        "supplier list had N members while our corpus holds one row — a " +
        "per-supplier split of a full annex value (see 114's CONTRACT-TOTAL " +
        "warning), not a collision.",
    );
  },
);

test.skipIf(skip)(
  "the general query still discriminates — the original collision, replayed, is caught",
  async () => {
    // Prove the red path (the person_connections.data.test.ts precedent):
    // re-create the −€193,352.65 misfold inside a rolled-back transaction —
    // №4354 (the larger Дансон contract) is given its sibling's value — and
    // assert the general query flags exactly that row.
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const { rows: dan } = await c.query<{
          key: string;
          amount_eur: string;
        }>(
          `SELECT key, amount_eur::text FROM contracts
           WHERE unp = '00536-2023-0049' AND contractor_eik = '206534575'
             AND tag = 'contract'
           ORDER BY amount_eur DESC`,
        );
        assert.equal(
          dan.length,
          2,
          `expected the two Дансон contracts under 00536-2023-0049, got ${dan.length}`,
        );
        const [big, small] = dan;
        await c.query("UPDATE contracts SET amount_eur = $1 WHERE key = $2", [
          small.amount_eur,
          big.key,
        ]);
        const { rows } = await c.query<ViolationRow>(GENERAL_SQL);
        assert.ok(
          rows.some((r) => r.key === big.key),
          `the replayed collision on ${big.key} was NOT flagged — the general ` +
            "query no longer discriminates and this gate is decorative",
        );
      } finally {
        await c.query("ROLLBACK");
      }
    });
  },
);

test.skipIf(skip)(
  "УНП 00536-2023-0049: Дансон's №4354 carries its own value, not its sibling's",
  async () => {
    // The original defect, pinned by shape rather than by row key (keys shift
    // when a feed re-parses): under this УНП the supplier holds two contracts
    // whose annexes both published zero-diff values, so each contract's
    // amount_eur must equal ITS OWN annex value and the two must differ.
    const rows = await allRows<{ contract_id: string; amount_eur: string }>(
      `SELECT contract_id, amount_eur::text
       FROM contracts
       WHERE unp = '00536-2023-0049'
         AND contractor_eik = '206534575'
         AND tag = 'contract'
       ORDER BY contract_id`,
    );
    assert.equal(
      rows.length,
      2,
      `expected the two Дансон contracts under 00536-2023-0049, got ${rows.length}`,
    );
    const amounts = rows.map((r) => Number(r.amount_eur)).sort((a, b) => a - b);
    // Two invariants with different remediations, asserted separately so a
    // failure routes the operator correctly.
    assert.notEqual(
      amounts[0],
      amounts[1],
      "the two Дансон contracts share one value — the −€193,352.65 fold " +
        "collision shipping again (annexResolve.ts ambiguity refusal regressed)",
    );
    assert.deepEqual(
      amounts,
      [158991.32, 352343.97],
      "the Дансон values moved but stayed DISTINCT — likely a NEW legitimate " +
        "annex, not the collision. Verify on ЦАИС ЕОП for УНП 00536-2023-0049, " +
        "then update this pin (and confirm the general invariant stayed green).",
    );
  },
);

// ── THE TWO CONSUMERS MUST NOT DISAGREE ─────────────────────────────────────────────────────
//
// `anexi_current_value.ts` (the value fold, over the month shards) and `db:load:annexes:pg`
// (this table, over Postgres) resolve the SAME annex cache with the SAME resolver. Nothing made
// them agree, and for months they did not: the loader read post-087 rows through a divisor
// written for the shard convention, so every consortium carrier was refused on the ±12%
// continuity guard by exactly its member count. Both exit 0, every row count reconciles, and the
// only reader-facing trace is a /contract/:key page that says the value moved and then lists no
// modification that moved it. Plan: docs/plans/annex-linkage-consortium-basis-v1.md.
//
// ⚠️ THE FIRST ARM COMPARES ANNEX RECORDS, NOT CONTRACTS, and that is the whole point. The
// divergence survived this file for months because every gate in it is contract-shaped: an annex
// no contract claims is absent from both consumers with nothing to count it. Measured
// 2026-09-04, before the per-row basis: 1,063 records linked by the fold and missing from this
// table. After: 13.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONTH_DIR = path.resolve(
  __dirname,
  "../../../data/procurement/contracts",
);

/** The resolver's inputs, from whichever corpus. `basis` and `members` are per row, exactly as
 *  each consumer computes them — see load_annexes_pg.ts and lib/annexResolve.ts. */
interface ResolvableRow {
  unp?: string;
  awarderEik?: string;
  contractorEik?: string;
  contractId?: string;
  signed: number | null;
  basis: ContractBasis;
  members?: readonly string[];
}

/** The month shards, read the way anexi_current_value.ts reads them: the signing baseline is
 *  `signingAmountEur ?? amountEur` (what makes the fold idempotent), and every shard row is on
 *  the split basis with no consortium promotion. */
const loadShardRows = (): ResolvableRow[] => {
  const out: ResolvableRow[] = [];
  if (!fs.existsSync(MONTH_DIR)) return out;
  for (const y of fs.readdirSync(MONTH_DIR).filter((n) => /^\d{4}$/.test(n))) {
    const dir = path.join(MONTH_DIR, y);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const rows = JSON.parse(
        fs.readFileSync(path.join(dir, f), "utf8"),
      ) as Contract[];
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        if (r.tag !== "contract") continue;
        out.push({
          unp: r.unp,
          awarderEik: r.awarderEik,
          contractorEik: r.contractorEik,
          contractId: r.contractId,
          signed: r.signingAmountEur ?? r.amountEur ?? null,
          basis: "split",
        });
      }
    }
  }
  return out;
};

/** Postgres, read the way load_annexes_pg.ts reads it: per-row basis from 087's
 *  `consortium_role`, and the member set keyed on 087's group identity. */
const loadPgRows = async (): Promise<ResolvableRow[]> => {
  const rows = await allRows<{
    unp: string | null;
    awarder_eik: string | null;
    contractor_eik: string | null;
    contract_id: string | null;
    signed: number | null;
    consortium_role: string | null;
    ocid: string | null;
  }>(
    `SELECT unp, awarder_eik, contractor_eik, contract_id,
            COALESCE(signing_amount_eur, amount_eur) AS signed,
            consortium_role, ocid
       FROM contracts WHERE tag = 'contract'`,
  );
  const gr = (r: (typeof rows)[number]) => ({
    ocid: r.ocid,
    contractId: r.contract_id,
    contractorEik: r.contractor_eik,
    consortiumRole: r.consortium_role,
  });
  const byGroup = membersByConsortiumGroup(rows.map(gr));
  return rows.map((r) => ({
    unp: r.unp ?? undefined,
    awarderEik: r.awarder_eik ?? undefined,
    contractorEik: r.contractor_eik ?? undefined,
    contractId: r.contract_id ?? undefined,
    signed: r.signed,
    basis: (r.consortium_role === "carrier"
      ? "full"
      : "split") as ContractBasis,
    members:
      r.consortium_role === "carrier"
        ? byGroup.get(consortiumGroupKey(gr(r)))
        : undefined,
  }));
};

/** The set of annex RECORDS a corpus reaches — the modifications the register published, not the
 *  index keys that address them.
 *
 *  ⚠️ Keys are the WRONG unit and read as a huge false divergence. One annex record is indexed
 *  under EVERY supplier it lists, so on the shards each of a consortium's N members claims its
 *  own `<унп>|<member>` key while in Postgres only the carrier claims one — measured, comparing
 *  keys reports 1,121 fold-only against a true 13. A record is what a reader sees on
 *  /contract/:key, and it is what the loader emits rows from. */
const reachedRecords = (
  rows: ResolvableRow[],
  idx: ReturnType<typeof buildAnnexIndex>["idx"],
): Set<string> => {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.signed == null || r.signed <= 0) continue;
    const hit = resolveAnnexKey(idx, r as unknown as Contract, r.signed, {
      basis: r.basis,
      members: r.members,
    });
    if (!hit) continue;
    const recs =
      (hit.via === "unp"
        ? idx.recordsByUnpSupplier?.get(hit.key)
        : idx.recordsByContractNo?.get(hit.key)) ?? [];
    // The loader's own dedupe identity, minus the contract: a notice id when the feed publishes
    // one, otherwise the (date, value) pair that distinguishes two null-id modifications.
    for (const rec of recs)
      out.add(
        `${rec.noticeId ?? ""}|${rec.lotIdentifier ?? ""}|` +
          `${rec.publicationDate ?? ""}|${rec.currentValueEur ?? ""}`,
      );
  }
  return out;
};

const { idx: annexIdx, records: annexRecords } = haveDb
  ? buildAnnexIndex({ retainRecords: true })
  : { idx: undefined, records: 0 };

// Distinct skip reasons. Neither absence may read as "the consumers agree".
const divergenceSkip = skip
  ? skip
  : annexRecords === 0
    ? "no annex cache on disk (raw_data/procurement/anexi)"
    : !fs.existsSync(MONTH_DIR)
      ? "no contract shards on disk (data/procurement/contracts)"
      : false;
reportSkip(import.meta.url, divergenceSkip);

// A CEILING, not zero: the two corpora are not the same row set. Postgres additionally holds the
// synthetic `obed-` carriers, which have no shard row at all, and the shards hold rows an
// eviction pass has since removed. Measured 2026-09-04 after the per-row basis and the member-set
// probe: 13 fold-only and 90 pg-only records against a union of ~25.6k, i.e. ~0.4%. Before them
// it was 1,063 fold-only. 3% leaves room for ordinary corpus drift and is an order of magnitude
// under the defect.
const MAX_ONE_SIDED_RECORD_PCT = 3;

test.skipIf(divergenceSkip)(
  "the value fold and the annexes table reach the same annex records",
  async () => {
    const foldRecs = reachedRecords(loadShardRows(), annexIdx!);
    const pgRecs = reachedRecords(await loadPgRows(), annexIdx!);
    assert.ok(
      foldRecs.size > 1000 && pgRecs.size > 1000,
      `too few reached records to compare (fold ${foldRecs.size}, pg ${pgRecs.size}) — this ` +
        `arm is vacuous, not green. Load the contracts corpus first.`,
    );
    const foldOnly = [...foldRecs].filter((k) => !pgRecs.has(k));
    const pgOnly = [...pgRecs].filter((k) => !foldRecs.has(k));
    const union = new Set([...foldRecs, ...pgRecs]).size;
    const pct = (100 * (foldOnly.length + pgOnly.length)) / union;
    assert.ok(
      pct <= MAX_ONE_SIDED_RECORD_PCT,
      `the two consumers of lib/annexResolve.ts have diverged: ${foldOnly.length} annex ` +
        `record(s) reached only by the value fold and ${pgOnly.length} only by the annexes ` +
        `table, ${pct.toFixed(2)}% of ${union}.\n` +
        `Fold-only records are modifications folded into contracts.amount_eur that ` +
        `/contract/:key cannot show; pg-only records are the reverse. Both are one resolver ` +
        `reading two conventions — see docs/plans/annex-linkage-consortium-basis-v1.md and ` +
        `check the per-row basis / member set in load_annexes_pg.ts.\n` +
        `fold-only: ${foldOnly.slice(0, 5).join(" · ")}\n` +
        `pg-only:   ${pgOnly.slice(0, 5).join(" · ")}`,
    );
  },
);

// ── the served-state symptom, PER ROW CLASS ─────────────────────────────────────────────────
//
// ⚠️ ASSERTED PER `consortium_role`, never in aggregate. Carriers are 4,040 of 407k contracts, so
// a TOTAL carrier regression is 4.53% of the flipped population — inside any ceiling loose enough
// to tolerate ordinary drift. Per class it reads 100%, which is what the failure message needs to
// say.
//
// ⚠️ And note what the predicate means on a CARRIER. 087 recomputes `signing_amount_eur` and
// `amount_eur` as NULL-skipping `sum()`s over the group, so on a carrier "signing <> current" is
// evidence that the fold moved SOME member's value, not that this row's own annex chain accounts
// for the difference. 20 of the 288 pre-fix carriers did not match their annex anchor to the
// cent. The arm is therefore a PRESENCE test — "this contract can show a modification" — and the
// value-identity question is the general gate at the top of this file.

const FLIPPED_PREDICATE = `
  c.tag = 'contract'
  AND c.signing_amount_eur IS NOT NULL
  AND c.signing_amount_eur <> c.amount_eur
`;

const FLIPPED_BY_ROLE_SQL = `
  SELECT coalesce(c.consortium_role, '(plain)') AS role,
         count(*)::text AS flipped,
         count(*) FILTER (
           WHERE NOT EXISTS (
             SELECT 1 FROM procurement_annexes a WHERE a.contract_key = c.key)
         )::text AS without_annex
    FROM contracts c
   WHERE ${FLIPPED_PREDICATE}
   GROUP BY 1 ORDER BY 2 DESC
`;

interface RoleRow {
  role: string;
  flipped: string;
  without_annex: string;
}

// Per class. 0% measured for every class after the fix; 100% for `carrier` before it.
const MAX_FLIPPED_WITHOUT_ANNEX_PCT = 5;
// The flip population is ~6.3k. A floor of 4,000 catches an unloaded or half-loaded corpus
// without tolerating the 84% collapse a floor of 1,000 would have allowed.
const MIN_FLIPPED = 4000;

test.skipIf(skip)(
  "a contract whose value the fold moved can show a modification — per row class",
  async () => {
    const rows = await allRows<RoleRow>(FLIPPED_BY_ROLE_SQL);
    const total = rows.reduce((n, r) => n + Number(r.flipped), 0);
    assert.ok(
      total >= MIN_FLIPPED,
      `only ${total} contracts carry a fold flip (expected ≥ ${MIN_FLIPPED}) — this arm is ` +
        `vacuous, not green. Run \`npm run db:load:pg\` then \`npm run db:load:annexes:pg\`.`,
    );
    const bad = rows.filter(
      (r) =>
        (100 * Number(r.without_annex)) / Number(r.flipped) >
        MAX_FLIPPED_WITHOUT_ANNEX_PCT,
    );
    assert.deepEqual(
      bad.map((r) => r.role),
      [],
      `row class(es) whose flipped contracts cannot show the modification that flipped them:\n` +
        rows
          .map(
            (r) =>
              `  ${r.role}: ${r.without_annex} of ${r.flipped} ` +
              `(${((100 * Number(r.without_annex)) / Number(r.flipped)).toFixed(2)}%)`,
          )
          .join("\n") +
        `\nA failing 'carrier' class means load_annexes_pg.ts has stopped passing the per-row ` +
        `basis or the member set (docs/plans/annex-linkage-consortium-basis-v1.md); a failing ` +
        `'(plain)' class usually means procurement_annexes is simply stale — re-run ` +
        `\`npm run db:load:annexes:pg\`.`,
    );
  },
);

test.skipIf(skip)(
  "the per-class query still discriminates — a stripped carrier is caught",
  async () => {
    // Same convention as the orphan proof above: procurement_annexes is TRUNCATEd and rebuilt,
    // so "0 without an annex" is the state immediately after every load and proves nothing on
    // its own. Delete one class's annex rows inside a rolled-back transaction and require the
    // query to flag exactly that class.
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const { rows: victims } = await c.query<{ key: string }>(
          `SELECT c.key FROM contracts c
            WHERE ${FLIPPED_PREDICATE} AND c.consortium_role = 'carrier'
              AND EXISTS (SELECT 1 FROM procurement_annexes a WHERE a.contract_key = c.key)
            LIMIT 50`,
        );
        assert.ok(
          victims.length > 0,
          "no flipped carrier carries an annex — the per-class gate is vacuous, not green",
        );
        await c.query(
          `DELETE FROM procurement_annexes WHERE contract_key = ANY($1::text[])`,
          [victims.map((v) => v.key)],
        );
        const { rows: after } = await c.query<RoleRow>(FLIPPED_BY_ROLE_SQL);
        const carrier = after.find((r) => r.role === "carrier");
        assert.ok(
          carrier,
          "the carrier class vanished from the per-class query",
        );
        assert.equal(
          Number(carrier.without_annex),
          victims.length,
          `stripping ${victims.length} carriers' annexes was not reflected in the query ` +
            `(${carrier.without_annex}) — the per-class gate is decorative`,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    });
  },
);
