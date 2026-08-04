// Cross-source content keys for a contract row.
//
// The two procurement feeds namespace their `releaseId`s disjointly (OCDS
// `aop-`/`ocds-` vs ЦАИС ЕОП flat `eop-`), so the same logical contract minted
// from both sources hashes to two DIFFERENT `key`s and can NOT be collapsed by
// the month-shard key merge — only a *content* match can. These keys are that
// content match, shared by every module that has to reconcile the two feeds:
//   - ingest_eop.ts drops flat rows that match an already-ingested contract
//     (the flat feed is a superset of the OCDS обявления export);
//   - ingest.ts evicts an on-disk EOP row when the authoritative OCDS row it was
//     standing in for finally lands (АОП publishes the OCDS export on a multi-week
//     lag behind the live ЦАИС feed).
//
// Keep the two directions symmetric — they MUST use the same key set or an EOP
// row dropped in one direction could survive in the other and double-count.

import type { Contract } from "./types";

// Normalise a free-text contract number for matching: lowercase, strip the
// punctuation/whitespace/№ that the two feeds format inconsistently ("Д-1/2021"
// vs "д 1 2021").
export const normContractNo = (s: string | undefined): string =>
  (s ?? "").toLocaleLowerCase("bg").replace(/[\s".,\-_/№#]/g, "");

// Every content key a row can be matched on. Two rows are the same logical
// contract when ANY key collides. Four independent nets, strongest first:
// (1) procedure УНП + supplier + rounded €, (2) buyer + supplier +
// contract-number + signing date (amount-free, survives the multi-supplier
// split), (3) buyer + supplier + signing date + rounded € (catches rows with
// neither a УНП nor a usable contract number), (4) the fully-identifying tuple
// with NEITHER date NOR amount — see below.
export const contentKeys = (r: Contract): string[] => {
  const keys: string[] = [];
  const amt = r.amountEur != null ? String(Math.round(r.amountEur)) : "";
  if (r.unp && r.contractorEik) {
    keys.push(`u:${r.unp}:${r.contractorEik}:${amt}`);
  }
  const cn = normContractNo(r.contractId);
  if (cn && r.awarderEik && r.contractorEik) {
    keys.push(
      `c:${r.awarderEik}:${r.contractorEik}:${cn}:${r.dateSigned ?? ""}`,
    );
  }
  if (r.awarderEik && r.contractorEik && (r.dateSigned || amt !== "")) {
    keys.push(
      `f:${r.awarderEik}:${r.contractorEik}:${r.dateSigned ?? ""}:${amt}`,
    );
  }
  // (4) `p:` — buyer + procedure + contract + supplier + tag, carrying NEITHER the
  // signing date NOR the amount. The three nets above all embed one or both, and
  // measurement showed each is unreliable ACROSS feeds for the same contract:
  //
  //   - `date_signed` differed on **9 of 9** identical-supplier cross-source pairs, which
  //     is exactly why the amount-free `c:` net never fired on them;
  //   - the amount differs whenever the two feeds see different supplier counts and so
  //     divide the contract value by a different denominator (2 of those 9);
  //   - the buyer EIK, by contrast, agreed on **9 of 9**.
  //
  // So the identifying tuple is (buyer, procedure, contract, supplier) and the volatile
  // fields have to be left out. `tag` is included even though the other nets omit it: this
  // net is the broadest, and without it an EOP `contract` row could content-match an OCDS
  // `contractAmendment` for the same award and be evicted as a twin of its own amendment.
  //
  // BOTH the УНП and the contract number are required. Dropping either widens this to
  // "any row from this buyer to this supplier", which would match unrelated awards — the
  // same over-reach that, applied as a deletion rule, destroyed 46 legitimate rows.
  //
  // The contract number is used RAW here, not normalised. `normContractNo` strips exactly the
  // characters publishers use to disambiguate framework call-offs — `РД-07-9`, `РД-07--9` and
  // `РД-07-9.` all collapse to `рд079` — and because this net carries neither a date nor an
  // amount it has nothing left to tell them apart. Measured: normalising here false-matches
  // 561 groups / 1,044 rows / €70.8m, amounts from €19 to €291,705 under one key. The other
  // three nets keep the normalised form, where an amount or a date still discriminates.
  if (r.unp && r.contractId && r.awarderEik && r.contractorEik) {
    keys.push(
      `p:${r.awarderEik}:${r.unp}:${r.contractId}:${r.contractorEik}:${r.tag}`,
    );
  }
  // THERE IS DELIBERATELY NO IDENTITY-E NET HERE, and it is not an oversight.
  //
  // Identity E — (unp, contractor, rounded €, signing date, tag) — is the key the cross-source
  // reconciliation pass runs on (cross_source.ts). Adding it here would be DEAD CODE: `u:` above
  // is (unp, contractor, rounded €), so identity E is `u:` plus a date, i.e. strictly NARROWER.
  // Two rows agreeing on identity E necessarily agree on `u:` already, and these nets are a
  // union ("the same contract when ANY key collides") — so a narrower net can never add a match.
  // `content_key.test.ts` asserts that containment as a property, so if `u:` is ever tightened
  // the claim fails loudly instead of quietly becoming false.
  //
  // The two live at different layers for a reason. THIS function is the permissive PARSE-TIME
  // matcher, where the OCDS export has no УНП at all; identity E is the strict POST-BACKFILL
  // one used to decide deletions. Permissive matching and safe removal are different jobs — see
  // the survivor precondition below, which exists precisely because they are.
  return keys;
};

// True when a row was sourced from the ЦАИС ЕОП flat договори feed (as opposed
// to the АОП OCDS export or the legacy annual CSVs). The flat feed namespaces
// its synthetic release ids under `eop-` (see normalize_eop.ts).
//
// STILL THE PARSE-TIME PRIMITIVE, no longer the precedence one. `evictSupersededEopTwins`
// below runs inside the ingest and needs exactly this binary question ("may I drop this
// row?"); everything that has to RANK the feeds against each other uses `feedOf`/`feedRank`.
// Conflating the two is what made the corpus blind to `aop`↔`rop` and `aop`↔`ocds` pairs,
// where neither side is `eop-` — see docs/plans/procurement-cross-source-dedup-v2.md §2.
export const isEopSourced = (r: Contract): boolean =>
  typeof r.releaseId === "string" && r.releaseId.startsWith("eop-");

// The FOUR feeds the corpus is built from, distinguished by `releaseId` prefix. `aop` is the
// fallback rather than a prefix test because the legacy CSV is the only generator that has
// ever changed its prefix shape (`aop-legacy-…`), and an unrecognised row belongs with the
// legacy pile rather than in a silent fifth bucket.
export type Feed = "ocds" | "aop" | "eop" | "rop";

export const feedOf = (r: Contract): Feed => {
  const id = typeof r.releaseId === "string" ? r.releaseId : "";
  if (id.startsWith("ocds-")) return "ocds";
  if (id.startsWith("eop-")) return "eop";
  if (id.startsWith("rop-")) return "rop";
  return "aop";
};

// Precedence for cross-source reconciliation: LOWER rank wins, and the loser is the side that
// gets evicted. Order: ocds > aop > eop > rop.
//
// MEASURED ON THE AFFECTED POPULATION, not on corpus-wide averages, and the two disagree.
// Corpus-wide, `eop` looks like the richer feed (100% `procurement_method` against aop's 54%,
// mean title 170 chars against 125, `lot_name` on 40% against 17%) — which argues for
// `eop > aop`. On the 46 `aop`↔`eop` twin pairs this ordering actually decides, `aop` is the
// richer side on every axis that differs (measured 2026-08-04 by measure_cross_source.ts §5.1,
// counting one pair per identity-E group):
//
//   linked procurement_annexes row   aop-only 2    eop-only 0
//   eu_funded populated              aop-only 13   eop-only 0
//   lot_name populated               aop-only 11   eop-only 1
//   longer title                     aop 22        eop 9
//   procurement_method / cpv         tie (both populated on all 46)
//
// So `eop > aop` would break 2 annex links and drop EU-funding attribution on 13 contracts to
// gain nothing. Ranking `aop` above `eop` also keeps the shipped invariant that an `aop`↔`eop`
// pair resolves by dropping the `eop` row, so this is purely additive to existing behaviour.
//
// No `eop`↔`rop` pair exists in the corpus, so that one ordering is unconstrained by evidence;
// it follows the feeds' coverage windows (rop ends 2018-12-31, eop begins 2020-01-07).
const FEED_RANK: Record<Feed, number> = { ocds: 1, aop: 2, eop: 3, rop: 4 };

export const feedRank = (r: Contract): number => FEED_RANK[feedOf(r)];

// Evict EOP-sourced rows superseded by an arriving OCDS row. OCDS is
// authoritative: when the OCDS export finally publishes a contract the flat feed
// already stood in for, the two rows carry different (source-namespaced) `key`s
// and would both survive the month-shard key merge — double-counting. This drops
// the EOP twin by content match. Only `eop-` rows are ever removed; OCDS/legacy
// rows always pass through. Returns the surviving rows and how many were evicted.
//
// Only NON-EOP arrivals supersede — the "OCDS authoritative" contract is enforced
// here, not left to the caller. Were an arriving `eop-` row allowed to contribute
// keys, it would content-match the identical on-disk EOP row and evict it (silent
// row loss). The current writer only passes OCDS rows, so this guard is a
// belt-and-braces on a shared, exported primitive.
// A SURVIVOR PRECONDITION guards every eviction: a row is only dropped when an arriving
// non-EOP row exists for the SAME contract — same (УНП, contract number, tag). Matching and
// removing are deliberately separated, because the nets above are intentionally permissive
// while removal must not be.
//
// The `f:` net is buyer + supplier + signing date + rounded €, with no contract number. Its
// own comment calls it "belt-and-suspenders", and it is: within one procedure a buyer
// routinely signs several contracts with the same supplier on the same day for the same
// amount, so `f:` matches ACROSS contracts. Measured on the corpus, that produced 6 evictions
// whose contract had no surviving row at all — including `02023-2023-0001`/118827 (Нивел
// строй, €4,136,627.87), matched against an OCDS row for contract 118779. The row simply
// disappeared, and the corpus total quietly dropped with it.
//
// This is the check whose absence made three earlier attempts at a precedence rule
// destructive: each reported a plausible eviction count while orphaning contracts. A count is
// not evidence; a named survivor is.
//
// KEYED WITHOUT THE УНП, and that is the whole point. `normalize.ts` never sets `unp` — the
// OCDS export carries none, and backfill_unp.ts writes it onto the shards only afterwards. The
// production caller (`ingest.ts`) passes freshly-parsed OCDS rows as `arriving`, so a
// УНП-keyed precondition is empty for every one of them and silently makes 109,043 EOP rows
// permanently unevictable — €1.475bn of 2026 rows would sit forever waiting for a twin that
// can no longer supersede them. A first draft did exactly that; it looked correct only because
// the validation harness fed it on-disk rows, which HAVE been backfilled.
//
// (buyer, contract number, tag) is computable from an unbackfilled OCDS row and still blocks
// every one of the 6 orphaning evictions this guard exists for. `normContractNo` is used here
// — unlike in the `p:` net — because the two feeds format the number inconsistently and this
// side only needs to confirm the contract EXISTS, not to distinguish call-offs.
const contractIdentity = (r: Contract): string | null =>
  r.awarderEik && r.contractId
    ? `${r.awarderEik}::${normContractNo(r.contractId)}::${r.tag}`
    : null;

export const evictSupersededEopTwins = (
  rows: Contract[],
  arriving: Contract[],
): { kept: Contract[]; evicted: number } => {
  const arrivingKeys = new Set<string>();
  const arrivingContracts = new Set<string>();
  for (const r of arriving)
    if (!isEopSourced(r)) {
      for (const k of contentKeys(r)) arrivingKeys.add(k);
      const id = contractIdentity(r);
      if (id) arrivingContracts.add(id);
    }
  let evicted = 0;
  const kept = rows.filter((r) => {
    if (!isEopSourced(r)) return true;
    if (!contentKeys(r).some((k) => arrivingKeys.has(k))) return true;
    // Verifiable only when the row identifies its own contract. When it cannot (no УНП or no
    // contract number) the precondition is skipped rather than treated as failed, so this is
    // a strict narrowing of the previous behaviour and never blocks an eviction that used to
    // succeed on an identifiable contract.
    const id = contractIdentity(r);
    if (id && !arrivingContracts.has(id)) return true;
    evicted++;
    return false;
  });
  return { kept, evicted };
};
