// Cross-source duplicate analysis for the contracts corpus — the ONE implementation, shared by
// the read-only measurement harness (measure_cross_source.ts) and the pass that acts on it
// (reconcile_cross_source.ts).
//
// It is shared deliberately. Five earlier key designs failed, and v1 §6 records that the first
// draft's numbers were wrong because a *lookalike* re-implementation of `canonicalEik` was
// measured instead of the real one. Two copies of this logic would reproduce that failure at a
// larger scale: the harness would report a population the pass does not act on, and nothing
// would notice. See docs/plans/procurement-cross-source-dedup-v2.md.
//
// ── The identity ────────────────────────────────────────────────────────────────────────────
//
// E = (unp, contractorEik, round(amountEur), dateSigned, tag).
//
// The four feeds number the same contract differently — `contract_id` disagrees in ~99% of real
// twins (0/46 on aop↔eop, 0/26 on eop↔ocds, 0/6 on aop↔ocds; only aop↔rop agrees, 7/8) — so any
// identity carrying `contract_id` is structurally blind to the population, which is exactly what
// the shipped pass was: 29 candidates found, 29 blocked, 0 evicted, "✓ verification passed".
//
// Two properties make E safe where the failed keys were not:
//   - it CANNOT pool contracts signed on different days. Every failed design could, and the
//     >3-month tail (97 groups / €85.8m, only 22% carrying any framework signal) is exactly the
//     population a date-free key swallows;
//   - dropping the amount gives (unp, contractor, date), which matches every lot of a procedure
//     signed on one day — the over-reach that destroyed 46 legitimate rows / €5.15m.
//
// ── The eviction unit ───────────────────────────────────────────────────────────────────────
//
// The contract-SIDE, not the row. Evicting only the matched row leaves the rest of the losing
// side in place, which is still a cross-source mix and still over-states. A side is evicted only
// when it is wholly redundant, which needs all three preconditions in `analyzeCrossSource`.

import { feedOf, feedRank, type Feed } from "./content_key";
import type { Contract } from "./types";

/** Field separator for the composite keys below. A control character rather than a space or a
 *  colon, because `contract_id` is free text that genuinely contains both — `УРИ 12491оп - 352`
 *  is a real one — so a printable separator lets two different field splits produce the same key.
 *  Written as an escape, never as a literal byte: a raw NUL in the source makes git treat the
 *  file as binary, which costs diffs, blame and review on the one module that deletes rows. */
const SEP = "\u001f";

/** A signing date normalised to `YYYY-MM-DD`. The shards carry ISO dates, but Postgres stores
 *  `date_signed` as text and some feeds append a time, so both sources are truncated the same
 *  way. Returns "" when absent — identity E requires a date, and "" never qualifies. */
export const signingDay = (r: Contract): string =>
  (r.dateSigned ?? "").slice(0, 10);

/** Identity E. `null` when the row cannot carry it — a row with no УНП, no contractor, no
 *  amount or no signing date is not matchable and must never be grouped with one that is. */
export const identityE = (r: Contract): string | null => {
  const day = signingDay(r);
  if (!r.unp || !r.contractorEik || r.amountEur == null || !day) return null;
  return `${r.unp}${SEP}${r.contractorEik}${SEP}${Math.round(r.amountEur)}${SEP}${day}${SEP}${r.tag}`;
};

/** The contract-SIDE a row belongs to: one feed's whole view of one contract. */
export const sideKey = (r: Contract): string =>
  `${r.unp ?? ""}${SEP}${r.contractId ?? ""}${SEP}${r.tag}${SEP}${feedOf(r)}`;

/** Synthetic consortium carriers are minted by 087 INSIDE Postgres from whichever feed's rows
 *  are present, so they inherit a cross-source mix rather than cause one. Excluding them is not
 *  a convenience — evicting one would delete money 087 moved off a member row. */
export const isSyntheticCarrier = (r: Contract): boolean =>
  r.contractorEik.startsWith("obed-");

export interface Side {
  key: string;
  unp: string;
  contractId: string;
  tag: string;
  feed: Feed;
  rank: number;
  rows: Contract[];
  /** Distinct contractor EIKs, sorted — the set the identity precondition compares. */
  eiks: string[];
  eur: number;
}

export interface SidePair {
  winner: Side;
  loser: Side;
  /** Rows of the loser matched at identity E to a row of the winner. */
  matched: number;
  eligible: boolean;
  /** Present exactly when `eligible` is false. */
  blockedReason?: string;
}

export interface Eviction {
  row: Contract;
  /** The identity-E twin on the winning side. Never null: an eviction without a named
   *  survivor is not produced, it is blocked. */
  survivor: Contract;
  pair: SidePair;
}

export interface CrossSourceAnalysis {
  /** Identity-E groups spanning two or more feeds — INCLUDING the ambiguous ones. */
  groups: { id: string; rows: Contract[]; feeds: Feed[] }[];
  /** The subset of `groups` where some feed contributed more than one row, so no 1:1 twin
   *  correspondence exists. Never acted on; reported so the omission is visible rather than
   *  looking like "no duplicate found". */
  ambiguous: { id: string; rows: Contract[]; feeds: Feed[] }[];
  sidePairs: SidePair[];
  /** Exactly one entry per distinct evicted row. */
  evictions: Eviction[];
  blocked: SidePair[];
}

const sideOf = (rows: Contract[]): Map<string, Side> => {
  const m = new Map<string, Side>();
  for (const r of rows) {
    const k = sideKey(r);
    let s = m.get(k);
    if (!s) {
      s = {
        key: k,
        unp: r.unp ?? "",
        contractId: r.contractId ?? "",
        tag: r.tag,
        feed: feedOf(r),
        rank: feedRank(r),
        rows: [],
        eiks: [],
        eur: 0,
      };
      m.set(k, s);
    }
    s.rows.push(r);
    s.eur += r.amountEur ?? 0;
  }
  for (const s of m.values())
    s.eiks = [...new Set(s.rows.map((r) => r.contractorEik))].sort();
  return m;
};

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Analyse a whole corpus for cross-source duplicates.
 *
 * CORPUS-WIDE, never per shard. Shard placement is driven by `date`, and the two feeds date the
 * same contract differently, so a twin pair routinely straddles two month files — a per-shard
 * pass silently cannot pair them, which looks identical to "no duplicate found".
 */
export const analyzeCrossSource = (
  allRows: Contract[],
): CrossSourceAnalysis => {
  const rows = allRows.filter((r) => !isSyntheticCarrier(r));

  // ── identity-E groups spanning >1 feed
  const byId = new Map<string, Contract[]>();
  for (const r of rows) {
    const id = identityE(r);
    if (!id) continue;
    const arr = byId.get(id);
    if (arr) arr.push(r);
    else byId.set(id, [r]);
  }
  const groups: CrossSourceAnalysis["groups"] = [];
  const ambiguous: CrossSourceAnalysis["groups"] = [];
  /** row → its identity-E twins on OTHER feeds. */
  const twins = new Map<Contract, Contract[]>();
  for (const [id, g] of byId) {
    const feeds = [...new Set(g.map(feedOf))];
    if (feeds.length < 2) continue;
    groups.push({ id, rows: g, feeds });

    // ── THE CORRESPONDENCE MUST BE 1:1, OR THERE IS NO CORRESPONDENCE.
    //
    // A group holding TWO rows from one feed means that feed published two DIFFERENT contracts
    // with the same (procedure, supplier, amount, signing date) — four call-offs of one framework
    // signed the same day at the same price is the real shape, e.g. 01071-2020-0009, where ЦАИС
    // has "Договор № 878/879/880/881" against two aop rows. Nothing in the data says which
    // aop contract corresponds to which eop contract, and when the counts differ (7 groups, 24
    // rows, €5,175,583.32 measured 2026-08-04) some of them correspond to nothing at all.
    //
    // The side-level preconditions below CANNOT see this: each of those contracts is its own
    // side, each side holds one row, and each singleton supplier set matches — so an N:M fan
    // passes all three and silently collapses N rows onto M survivors. That is the same class of
    // error as the key that destroyed 46 legitimate rows / €5.15m, and the only honest answer is
    // that a guess was going to be made. So: block the whole group and report it.
    const perFeed = new Map<Feed, number>();
    for (const r of g)
      perFeed.set(feedOf(r), (perFeed.get(feedOf(r)) ?? 0) + 1);
    if ([...perFeed.values()].some((n) => n > 1)) {
      ambiguous.push({ id, rows: g, feeds });
      continue;
    }

    for (const r of g)
      twins.set(
        r,
        g.filter((o) => feedOf(o) !== feedOf(r)),
      );
  }

  // ── lift twins to side-pairs
  const sides = sideOf(rows);
  const pairMatches = new Map<
    string,
    { winner: Side; loser: Side; rows: Set<Contract> }
  >();
  for (const [r, ts] of twins) {
    const a = sides.get(sideKey(r));
    if (!a) continue;
    for (const t of ts) {
      const b = sides.get(sideKey(t));
      if (!b || a.rank === b.rank) continue;
      const [winner, loser] = a.rank < b.rank ? [a, b] : [b, a];
      // Count the LOSER's rows that have a twin on the winner — the row iterated here is on
      // the loser side only when it is the lower-precedence one.
      const lost = a.rank < b.rank ? t : r;
      const k = `${winner.key}${SEP}${loser.key}`;
      let e = pairMatches.get(k);
      if (!e) {
        e = { winner, loser, rows: new Set() };
        pairMatches.set(k, e);
      }
      e.rows.add(lost);
    }
  }

  // ── the three preconditions (§5.2)
  const sidePairs: SidePair[] = [];
  for (const { winner, loser, rows: matchedRows } of pairMatches.values()) {
    const matched = matchedRows.size;
    let blockedReason: string | undefined;
    if (!sameSet(winner.eiks, loser.eiks))
      blockedReason = `supplier sets differ (${winner.feed}: ${winner.eiks.length}, ${loser.feed}: ${loser.eiks.length})`;
    else if (matched !== loser.rows.length)
      blockedReason = `only ${matched} of the loser's ${loser.rows.length} row(s) have a twin`;
    else if (matched !== winner.rows.length)
      blockedReason = `only ${matched} of the winner's ${winner.rows.length} row(s) are matched`;
    sidePairs.push({
      winner,
      loser,
      matched,
      eligible: !blockedReason,
      blockedReason,
    });
  }

  // ── TRANSITIVITY GUARD. A side may legitimately lose one pair and win another (aop loses to
  // ocds while eop loses to aop). Evicting both leaves the eop row's named survivor deleted —
  // a survivor assertion that passes against a row which is itself on the way out. Rather than
  // order the collapse, block the whole chain and report it: a three-feed chain is rare enough
  // (zero identity-E groups span three feeds today) that a silent resolution buys nothing and
  // risks the one class of error this design exists to prevent.
  const losing = new Set(
    sidePairs.filter((p) => p.eligible).map((p) => p.loser.key),
  );
  for (const p of sidePairs) {
    if (!p.eligible) continue;
    if (losing.has(p.winner.key)) {
      p.eligible = false;
      p.blockedReason =
        `transitive chain: the winning side ${p.winner.feed}:${p.winner.contractId} is itself ` +
        `evicted by a higher-precedence feed, so this eviction's survivor would not survive`;
    }
  }

  // ── evictions — ONE PER DISTINCT ROW.
  //
  // A losing side can be eligible against more than one winning side (its rows belonging to
  // different identity-E groups), so iterating pairs and pushing each loser row emits that row
  // once per pair. That is not a cosmetic duplicate: `evictions.length` is the count the delta
  // check compares against, and summing `amountEur` over a list with repeats over-states what is
  // being removed. Measured before this fix: 94 entries for 90 rows, €41,037,504.24 reported
  // against €39,792,488.60 actually removed — a €1.24m error in the headline figure, inside the
  // very verification meant to make the eviction trustworthy.
  const evicted = new Set<Contract>(
    sidePairs.filter((p) => p.eligible).flatMap((p) => p.loser.rows),
  );
  /** row → the pair that evicts it. Deterministic when several qualify: the highest-precedence
   *  winner, so the survivor a row is attributed to never depends on iteration order. */
  const evictedBy = new Map<Contract, SidePair>();
  for (const pair of sidePairs) {
    if (!pair.eligible) continue;
    for (const row of pair.loser.rows) {
      const prev = evictedBy.get(row);
      if (!prev || pair.winner.rank < prev.winner.rank)
        evictedBy.set(row, pair);
    }
  }
  const evictions: Eviction[] = [];
  for (const [row, pair] of evictedBy) {
    const survivor = (twins.get(row) ?? []).find(
      (t) => sideKey(t) === pair.winner.key && !evicted.has(t),
    );
    // Unreachable while the preconditions hold (every loser row is matched, and the winner
    // side is not itself evicted after the transitivity guard). Asserted rather than assumed:
    // a missing survivor here is precisely the orphaning that two earlier attempts shipped.
    if (!survivor)
      throw new Error(
        `internal: ${row.unp}/${row.contractId} (${row.contractorEik}) was selected for ` +
          `eviction with no surviving identity-E twin on ${pair.winner.feed}:` +
          `${pair.winner.contractId}. Refusing to continue.`,
      );
    evictions.push({ row, survivor, pair });
  }

  return {
    groups,
    ambiguous,
    sidePairs,
    evictions,
    blocked: sidePairs.filter((p) => !p.eligible),
  };
};

/** One-line, fully-identified description of a row. Used everywhere a row is reported, because
 *  every failure in this area reported a plausible COUNT while corrupting data — a count is not
 *  evidence, a named row is. */
export const describeRow = (r: Contract): string =>
  `${feedOf(r)}:${r.unp ?? "-"}/${r.contractId ?? "-"} eik=${r.contractorEik} ` +
  `€${(r.amountEur ?? 0).toFixed(2)} signed=${signingDay(r) || "-"} rel=${r.releaseId}`;
