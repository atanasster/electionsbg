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
  if (r.unp && cn && r.awarderEik && r.contractorEik) {
    keys.push(`p:${r.awarderEik}:${r.unp}:${cn}:${r.contractorEik}:${r.tag}`);
  }
  return keys;
};

// True when a row was sourced from the ЦАИС ЕОП flat договори feed (as opposed
// to the АОП OCDS export or the legacy annual CSVs). The flat feed namespaces
// its synthetic release ids under `eop-` (see normalize_eop.ts).
export const isEopSourced = (r: Contract): boolean =>
  typeof r.releaseId === "string" && r.releaseId.startsWith("eop-");

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
const contractIdentity = (r: Contract): string | null =>
  r.unp && r.contractId
    ? `${r.unp}::${normContractNo(r.contractId)}::${r.tag}`
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
