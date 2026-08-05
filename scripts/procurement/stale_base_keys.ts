// Detection of legacy-CSV rows still carrying a key from a SUPERSEDED keying scheme — the pure
// half, shared by THREE callers: the `writeMonthShards` self-heal (`evictStaleBaseKeys`, wired
// into `ingest.ts` + `ingest_legacy.ts`), the one-shot sweep (`dedup_stale_base_keys.ts`) and the
// standing gate (`scripts/db/tests/stale_base_keys.data.test.ts`).
//
// Shared deliberately, for the reason `cross_source.ts` says at the top of its own file: a
// lookalike re-implementation is how this plan family's numbers went wrong before. The gate must
// fail on exactly the population the sweep removes, or one of them is lying.
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────
//
// `legacy_csv.ts` mints `key = hashKey("legacy::${datasetUuid}::${documentId}::${contractorEik}")`.
// That tuple omits the per-contract id, so two lots (обособени позиции) under one document number
// collided; `disambiguateContractKeys` re-keys colliding rows to
// `hashKey("${baseKey}::${contractId}::${amount}")`.
//
// The month-shard merge (`ingest.ts` writeMonthShards) is a UNION KEYED ON `Contract.key`. So when
// the key formula changed, re-ingested rows arrived under NEW keys while the rows carrying the OLD
// bare key matched nothing and were never evicted. They are still on the shards, content-identical
// to their own re-keyed selves, double-counting.
//
// Worked case — `aop-legacy-2020-65860`, МЗ vaccine framework. The raw CSV
// (`raw_data/procurement/legacy/2020.csv.gz`, rows 1444/1445) carries TWO lots for contract
// `Договор №РД-11-485`; the corpus carries THREE:
//
//   base = hashKey("legacy::c5404069-…::65860::203283623")   = ead302ce1ecd  ← STALE
//   hashKey(base + "::Договор №РД-11-485::3492000")          = 3c5d7dffb956  ← current
//   hashKey(base + "::Договор №РД-11-485::1371600")          = cb415fc29f5b  ← current
//
// Plan: docs/plans/procurement-same-feed-dedup-v1.md §3.2 / §5.2.

import { hashKey } from "./contract_key";
import type { Contract } from "./types";

/** The contractor EIK AS IT WAS AT KEY-MINT TIME, recovered from `releaseId`.
 *
 *  NOT `row.contractorEik`: `__encode_personal_ids_inplace.ts` rewrites that field in place (ЕГН
 *  encoding), so on a large minority of legacy rows it no longer reproduces the hash. `releaseId`
 *  is `${ocid}-${contractorEik}` and is never rewritten, so its suffix is the mint-time value.
 *  Returns null when the row is not that shape, making it unclassifiable rather than mis-hashed. */
export const mintTimeEik = (r: Contract): string | null =>
  r.releaseId.startsWith(`${r.ocid}-`)
    ? r.releaseId.slice(r.ocid.length + 1)
    : null;

/** `ocid` is `aop-legacy-${year}-${documentId}`; the year token may carry an `-RL` suffix. */
export const documentId = (ocid: string): string =>
  ocid.replace(/^aop-legacy-\d{4}(-RL)?-/, "");

export const baseKeyOf = (r: Contract): string | null => {
  const eik = mintTimeEik(r);
  if (eik === null) return null;
  return hashKey(`legacy::${r.bundleUuid}::${documentId(r.ocid)}::${eik}`);
};

/** The key a fresh ingest mints for this row TODAY: `disambiguateContractKeys` over the base key
 *  with `legacyKeyDiscriminator` = `${contractId}::${amount}`.
 *
 *  It reads `amount` (native), not `amountEur`. That is why `fix_amount_overrides.ts` — which
 *  rewrites `amount` — must run BEFORE this detection: afterwards the survivor no longer carries
 *  the key this reproduces, and the pass degrades to a silent no-op. `preflightOrder()` below is
 *  what stops that being invisible. */
export const currentKeyOf = (r: Contract, base: string): string =>
  hashKey(`${base}::${r.contractId ?? ""}::${r.amount ?? ""}`);

/** The IDENTITY of a contract row — the fields that determine WHICH contract it is. Two rows
 *  agreeing here are the same contract, so one of them is redundant.
 *
 *  Deliberately excluded, and the distinction is the safety argument:
 *
 *  - `key` — the thing that differs, and the whole point.
 *  - `bundleUuid` / `sourceUrl` — inputs to the base key, already equal across a base group.
 *  - `awarderName` / `contractorName` — DISPLAY LABELS for the EIKs beside them, and exactly what
 *    later passes rewrite in place. The orphans predate `normaliseOrgName`, so the worked case
 *    still reads `Министерство на здравеопазването` where its live twin reads
 *    `МИНИСТЕРСТВО НА ЗДРАВЕОПАЗВАНЕТО` — same ministry, pure case drift (measured: 27 of 30 pairs
 *    differ on awarderName, 17 on contractorName, all case-only). Comparing them matched 1 of 30
 *    real pairs and silently refused the rest — a check so strict it does nothing, which is this
 *    family's other failure mode.
 *  - Everything NOT listed here is compared separately by `conflictsOf` and REPORTED rather than
 *    used to match, so a field that differs is never resolved invisibly.
 *
 *  `contractorEikFull` IS included: the 13-digit branch EIK is an identity, not a label. */
export const identityOf = (r: Contract): string =>
  JSON.stringify([
    r.ocid,
    r.releaseId,
    r.contractId ?? null,
    r.tag,
    r.date,
    r.dateSigned ?? null,
    r.awarderEik,
    r.contractorEik,
    r.contractorEikFull ?? null,
    r.amount ?? null,
    r.currency ?? null,
    r.amountEur ?? null,
    r.title,
    r.cpv ?? null,
    r.unp ?? null,
  ]);

/** NON-identity fields on which an evicted row and its survivor disagree.
 *
 *  These do not stop the eviction — the rows are provably the same contract, and the survivor is
 *  the one a fresh ingest produces today, so its value is the current source value. But they must
 *  be VISIBLE: `numberOfTenderers` differs on 2 of the 30 pairs (1 on the orphan, 2 on the
 *  survivor), and that field is the published single-bidder red flag — `db_routes.js` serves the
 *  single-bid share from it and the risk scorer flips `weakCompetition` on 1 vs 2. Resolving a
 *  competition signal silently is exactly what this file family exists not to do. */
export const conflictsOf = (
  evicted: Contract,
  survivor: Contract,
): string[] => {
  const fields: [string, unknown, unknown][] = [
    ["awarderName", evicted.awarderName, survivor.awarderName],
    ["contractorName", evicted.contractorName, survivor.contractorName],
    [
      "numberOfTenderers",
      evicted.numberOfTenderers,
      survivor.numberOfTenderers,
    ],
    [
      "procurementMethod",
      evicted.procurementMethod,
      survivor.procurementMethod,
    ],
    ["category", evicted.category, survivor.category],
    ["euFunded", evicted.euFunded, survivor.euFunded],
    ["euProgram", evicted.euProgram, survivor.euProgram],
    ["signingAmountEur", evicted.signingAmountEur, survivor.signingAmountEur],
  ];
  return fields
    .filter(
      ([, a, b]) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null),
    )
    .map(([n, a, b]) => `${n}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
};

export interface StalePair {
  evicted: Contract;
  survivor: Contract;
  /** Non-identity fields that differ. Reported, never used to match. */
  conflicts: string[];
}

export interface StaleUnresolved {
  base: string;
  reason: string;
  rows: Contract[];
}

export interface StaleAnalysis {
  pairs: StalePair[];
  /** A bare-key row sitting beside an identity-identical twin that is NOT re-derivable — so no
   *  survivor can be named. Never acted on; reported so the omission is visible. */
  unresolved: StaleUnresolved[];
  /** Identity-identical legacy duplicates where NO member carries the bare base key, so this rule
   *  cannot name a survivor at all. The two known 2022/2023 groups land here. */
  unactedDuplicates: Contract[][];
}

/** `fix_amount_overrides.ts` rewrites `amount`, which `currentKeyOf` depends on — run after it and
 *  every survivor stops being re-derivable, so this pass finds nothing and exits green. Returns a
 *  human-readable warning when the corpus looks like that has happened, so an out-of-order run is
 *  loud rather than a silent no-op.
 *
 *  The signal: essentially no legacy row reproduces EITHER key form. On a healthy corpus a large
 *  share do (measured 2026-08-04: 13.6% bare + 13.6% disambiguated of 244,968 legacy rows). */
export const preflightOrder = (all: Contract[]): string | null => {
  let legacy = 0;
  let reproducible = 0;
  for (const r of all) {
    if (!r.ocid.startsWith("aop-legacy-")) continue;
    legacy += 1;
    const base = baseKeyOf(r);
    if (base === null) continue;
    if (r.key === base || r.key === currentKeyOf(r, base)) reproducible += 1;
  }
  if (legacy === 0)
    return "no aop-legacy- rows found — is the shard tree populated?";
  const share = reproducible / legacy;
  if (share >= 0.02) return null;
  return (
    `only ${reproducible}/${legacy} (${(100 * share).toFixed(2)}%) legacy rows reproduce either ` +
    `key form — the key inputs have been rewritten since minting (fix_amount_overrides.ts ` +
    `rewrites \`amount\`). Detection here would be a silent no-op; run this BEFORE that pass.`
  );
};

/** The SELF-HEAL, wired into both `writeMonthShards` paths (`ingest.ts`, `ingest_legacy.ts`).
 *
 *  Same shape and same reasoning as `dropSyntheticLegacyTwins` (`validate.ts`), which fixed the
 *  previous occurrence of this mechanism — the `…-x` blank-document-id class, ~34k pairs / ~€11bn.
 *
 *  PER-SHARD EVICTION IS SUFFICIENT, and by construction rather than by luck: `identityOf`
 *  includes `date`, and `writeMonthShards` shards on `date.slice(0, 7)` — so a stale row and the
 *  twin that supersedes it always land in the same month file, and a partial ingest sees both
 *  members or neither (the shard is loaded whole). An untouched month is under-cleaned, never
 *  mis-cleaned.
 *
 *  ── `arriving` IS NOT OPTIONAL, AND THE REASON IS A REAL BUG THIS SHIPPED WITH ──────────────
 *
 *  A first version argued it could never evict a row the ingest just wrote, because "a fresh row
 *  carries the disambiguated key, so it is never the bare-key member". THAT IS FALSE:
 *  `disambiguateContractKeys` leaves a base key BARE when it is unique in the batch. So when a
 *  republished CSV DE-COLLIDES a group — АОП restates the dump, a lot is dropped, an amount is
 *  corrected — the arriving row is the bare-key member and the STALE row carries the
 *  disambiguated key. The pair inverts, and the pass evicts the new row in favour of the old one,
 *  silently reverting `numberOfTenderers` (the published single-bidder red flag) to its
 *  superseded value. It also never converges: it re-fires on every subsequent re-ingest.
 *
 *  So an arriving row is never evictable, exactly as `evictSupersededEopTwins(rows, arriving)`
 *  already requires one line above in the same merge. Passing an empty `arriving` is legitimate
 *  only for a caller that is not ingesting (the audit runner).
 *
 *  Returns the pairs, not a count — the caller logs them BEFORE writing, because a count is what
 *  every earlier failure in this area reported while corrupting data. */
export const evictStaleBaseKeys = (
  rows: Contract[],
  arriving: readonly Contract[],
): { rows: Contract[]; evicted: StalePair[] } => {
  const { pairs } = analyzeStaleBaseKeys(rows);
  if (!pairs.length) return { rows, evicted: [] };
  const fresh = new Set(arriving);
  const safe = pairs.filter((p) => !fresh.has(p.evicted));
  if (!safe.length) return { rows, evicted: [] };
  const gone = new Set(safe.map((p) => p.evicted));
  return { rows: rows.filter((r) => !gone.has(r)), evicted: safe };
};

export const analyzeStaleBaseKeys = (all: Contract[]): StaleAnalysis => {
  const byBase = new Map<string, Contract[]>();
  const legacy: Contract[] = [];
  for (const r of all) {
    if (!r.ocid.startsWith("aop-legacy-")) continue;
    legacy.push(r);
    const base = baseKeyOf(r);
    if (base === null) continue;
    const a = byBase.get(base);
    if (a) a.push(r);
    else byBase.set(base, [r]);
  }

  const pairs: StalePair[] = [];
  const unresolved: StaleUnresolved[] = [];
  const acted = new Set<Contract>();

  for (const [base, members] of byBase) {
    if (members.length < 2) continue; // a lone bare key is a NON-colliding row: correct as-is
    for (const b of members) {
      if (b.key !== base) continue;
      // A bare key is NOT by itself a defect — it is also what a non-colliding row correctly
      // keeps. Only a bare key beside an identity-identical twin is a duplicate, so a group
      // without one is passed over in silence rather than reported as refused: there is nothing
      // there to refuse, and 5,924 such lines buried the 30 real pairs.
      const id = identityOf(b);
      const same = members.filter((m) => m !== b && identityOf(m) === id);
      if (!same.length) continue;
      // The survivor must be re-derivable by TODAY's formula, not merely identity-identical —
      // that is what makes the eviction a validated key rather than a guess.
      const twins = same.filter((m) => m.key === currentKeyOf(m, base));
      if (twins.length === 1) {
        pairs.push({
          evicted: b,
          survivor: twins[0],
          conflicts: conflictsOf(b, twins[0]),
        });
        acted.add(b);
        acted.add(twins[0]);
      } else {
        unresolved.push({
          base,
          reason:
            twins.length === 0
              ? `${same.length} identity-identical sibling(s), none carrying the current key formula`
              : `${twins.length} identity-identical siblings carry the current key — ambiguous`,
          rows: members,
        });
        for (const m of [b, ...same]) acted.add(m);
      }
    }
  }

  // Identity-identical duplicates this rule cannot reach, because no member carries the bare base
  // key. Reported so "30 found" is never mistaken for "30 is all there is".
  const byIdentity = new Map<string, Contract[]>();
  for (const r of legacy) {
    if (acted.has(r)) continue;
    const k = identityOf(r);
    const a = byIdentity.get(k);
    if (a) a.push(r);
    else byIdentity.set(k, [r]);
  }
  const unactedDuplicates = [...byIdentity.values()].filter(
    (rs) => rs.length > 1,
  );

  return { pairs, unresolved, unactedDuplicates };
};
