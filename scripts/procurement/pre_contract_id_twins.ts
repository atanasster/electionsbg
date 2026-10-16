// Detection of legacy-CSV rows minted by a parser that did not yet read the contract-number
// column — the pure half, shared by the one-shot sweep (`dedup_pre_contract_id_twins.ts`),
// the `writeMonthShards` self-heal (`evictPreContractIdTwins`, wired into `ingest.ts` and
// `ingest_legacy.ts`) and the standing gate
// (`scripts/db/tests/pre_contract_id_twins.data.test.ts`).
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────
//
// An earlier legacy parse emitted every АОП „Информация за сключен договор" row WITHOUT its
// contract number (`contractId` missing) and with a filler signing date — the publication day,
// or 31 December of the dump year. A later parse read the column, so the same contracts were
// re-ingested carrying their real number and date, and their key moved with them. The month
// merge is a union keyed on `Contract.key`, so the old rows matched nothing and were never
// evicted — the third occurrence of this mechanism after the `…-x` blank-document-id class
// (`dedup_legacy_twins.ts`) and the stale-base-key class (`stale_base_keys.ts`).
//
// Measured 2026-10-17 on the shards: 12,397 such rows, €1,183,983,859 (1.2% of the contracts
// corpus), 2011–2021, every one `tag = 'contract'`, no `procurement_annexes` row on any.
// Validated by re-parsing every raw dump with TODAY's parser: in every group the
// contract-number-less row is NOT produced, and every sibling IS. Plan: docs/plans/procurement-same-feed-dedup-v1.md
// §7; found by the transport audit (docs/plans/transport-hub-v1.md, €107M of its headline).
//
// ── THE RULE ───────────────────────────────────────────────────────────────────────────────
//
// Evict a row iff ALL hold:
//   1. it is an `aop-legacy-` row at `tag = 'contract'` with no `contractId`;
//   2. a SIBLING exists with the same `releaseId` (= document + contractor), native `amount`,
//      `currency` and `title`, and that sibling HAS a `contractId`;
//   3. when a fresh parse is supplied: the row's key is NOT in it, the sibling's IS, AND the
//      parse produces NO contract-number-less row with the same sibling identity. That last
//      clause is not redundant: legacy keys depend on what else is in the batch
//      (`disambiguateContractKeys` uses the amount as tiebreak for number-less rows), so a
//      GENUINE number-less row whose key shifted would otherwise read as "not produced".
//
// Native `amount`, never `amountEur`: `anexi_current_value.ts` flips `amountEur` to the
// post-annex value on rows with annexes, and the orphans carry none — matching on the euro
// figure would miss every pair whose live twin was later amended.
//
// Rule 3 is what makes this a validated eviction rather than a guess, and the sweep REFUSES a
// year whose raw dump is absent rather than falling back to rules 1–2. The standing gate uses
// rules 1–2 alone, which is safe for a GATE (a false hit fails a test, deletes nothing).

import type { Contract } from "./types";
import { conflictsOf } from "./stale_base_keys";

export interface PreCidPair {
  evicted: Contract;
  survivor: Contract;
  /** Non-identity fields that differ. Reported, never used to match. */
  conflicts: string[];
}

export interface PreCidAnalysis {
  pairs: PreCidPair[];
  /** Rule 1–2 candidates the fresh parse did not confirm (the row IS produced, or no sibling
   *  is). Never acted on; reported so the omission is visible. */
  refused: { row: Contract; reason: string }[];
}

export const isPreCidCandidate = (r: Contract): boolean =>
  r.ocid.startsWith("aop-legacy-") &&
  r.tag === "contract" &&
  (r.contractId == null || r.contractId === "");

/** The fields two copies of one contract row agree on — `releaseId` already encodes the
 *  document id and the mint-time contractor. */
export const siblingKey = (r: Contract): string =>
  JSON.stringify([r.releaseId, r.amount ?? null, r.currency ?? null, r.title]);

/**
 * Pair each contract-number-less legacy row with a sibling that carries a number.
 * `fresh` — the keys a parse of the raw dumps produces TODAY; `null` skips rule 3 (gate use).
 * Survivors are chosen deterministically (lowest key among the confirmed siblings), so two runs
 * over one corpus name the same pairs.
 */
export const analyzePreContractIdTwins = (
  all: readonly Contract[],
  fresh: ReadonlySet<string> | null,
  /** siblingKey()s of the NUMBER-LESS rows the fresh parse produces (rule 3, last clause). */
  freshNumberless: ReadonlySet<string> = new Set(),
): PreCidAnalysis => {
  const withId = new Map<string, Contract[]>();
  for (const r of all) {
    if (!r.ocid.startsWith("aop-legacy-") || r.tag !== "contract") continue;
    if (r.contractId == null || r.contractId === "") continue;
    const k = siblingKey(r);
    const a = withId.get(k);
    if (a) a.push(r);
    else withId.set(k, [r]);
  }
  const pairs: PreCidPair[] = [];
  const refused: PreCidAnalysis["refused"] = [];
  for (const r of all) {
    if (!isPreCidCandidate(r)) continue;
    const sibs = withId.get(siblingKey(r));
    if (!sibs?.length) continue; // a lone number-less row is not a duplicate of anything
    if (fresh) {
      if (fresh.has(r.key)) {
        refused.push({ row: r, reason: "a fresh parse produces this row" });
        continue;
      }
      if (freshNumberless.has(siblingKey(r))) {
        refused.push({
          row: r,
          reason:
            "a fresh parse produces a number-less row with this identity (its key may have moved)",
        });
        continue;
      }
      const confirmed = sibs.filter((s) => fresh.has(s.key));
      if (!confirmed.length) {
        refused.push({
          row: r,
          reason: "no sibling is produced by a fresh parse",
        });
        continue;
      }
      const survivor = [...confirmed].sort((a, b) =>
        a.key < b.key ? -1 : 1,
      )[0];
      pairs.push({ evicted: r, survivor, conflicts: conflictsOf(r, survivor) });
    } else {
      const survivor = [...sibs].sort((a, b) => (a.key < b.key ? -1 : 1))[0];
      pairs.push({ evicted: r, survivor, conflicts: conflictsOf(r, survivor) });
    }
  }
  return { pairs, refused };
};

/** The SELF-HEAL for `writeMonthShards`. It sees ONE month shard at a time, so an orphan and
 *  its twin filed under different months are never paired here; the one-shot sweep, which reads
 *  every shard, is what clears that case.  `arriving` is the freshly parsed batch — the role a full
 *  re-parse plays for the sweep — so a row is evicted only when THIS ingest produced its
 *  numbered sibling and did not produce the row itself. An arriving row is never evictable, the
 *  rule `evictStaleBaseKeys` learned the hard way (see its header). An empty `arriving` (a
 *  non-legacy ingest) evicts nothing. */
export const evictPreContractIdTwins = (
  rows: Contract[],
  arriving: readonly Contract[],
): { rows: Contract[]; evicted: PreCidPair[] } => {
  if (!arriving.some((a) => a.ocid.startsWith("aop-legacy-")))
    return { rows, evicted: [] };
  const fresh = new Set(arriving.map((a) => a.key));
  const numberless = new Set(
    arriving.filter(isPreCidCandidate).map(siblingKey),
  );
  const { pairs } = analyzePreContractIdTwins(rows, fresh, numberless);
  if (!pairs.length) return { rows, evicted: [] };
  const gone = new Set(pairs.map((p) => p.evicted));
  return { rows: rows.filter((r) => !gone.has(r)), evicted: pairs };
};
