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
// contract when ANY key collides. Three independent nets, strongest first:
// (1) procedure УНП + supplier + rounded €, (2) buyer + supplier +
// contract-number + signing date (amount-free, survives the multi-supplier
// split), (3) buyer + supplier + signing date + rounded € (catches rows with
// neither a УНП nor a usable contract number).
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
export const evictSupersededEopTwins = (
  rows: Contract[],
  arriving: Contract[],
): { kept: Contract[]; evicted: number } => {
  const arrivingKeys = new Set<string>();
  for (const r of arriving) for (const k of contentKeys(r)) arrivingKeys.add(k);
  let evicted = 0;
  const kept = rows.filter((r) => {
    if (!isEopSourced(r)) return true;
    const superseded = contentKeys(r).some((k) => arrivingKeys.has(k));
    if (superseded) evicted++;
    return !superseded;
  });
  return { kept, evicted };
};
