// Regression lock for the cross-source content matcher and the OCDS-authoritative
// EOP-twin eviction. The two procurement feeds (АОП OCDS `aop-`/`ocds-` and ЦАИС
// ЕОП flat `eop-`) namespace their `key`s disjointly, so the same contract from
// both sources can only be reconciled on a content key. `ingest_eop.ts` uses it
// to drop flat rows already covered by OCDS; `ingest.ts` uses it in reverse to
// evict an EOP row when its authoritative OCDS twin finally lands. Both MUST use
// the identical key set or a twin survives in one direction and double-counts.
//
//   npx vitest run scripts/procurement/content_key.test.ts

import { test } from "vitest";
import assert from "node:assert/strict";
import {
  contentKeys,
  normContractNo,
  isEopSourced,
  evictSupersededEopTwins,
} from "./content_key";
import type { Contract } from "./types";

const row = (over: Partial<Contract>): Contract =>
  ({
    key: "k",
    releaseId: "eop-x",
    contractId: "",
    unp: "",
    awarderEik: "111",
    contractorEik: "222",
    dateSigned: "2026-07-01",
    amountEur: 1000,
    ...over,
  }) as Contract;

test("normContractNo strips the punctuation the two feeds format differently", () => {
  assert.equal(normContractNo("Д-1/2021"), normContractNo("д 1 2021"));
  assert.equal(normContractNo("№12.34"), "1234");
  assert.equal(normContractNo(undefined), "");
});

test("contentKeys: an OCDS row and its EOP twin share the УНП key", () => {
  const eop = row({
    releaseId: "eop-abc",
    unp: "00594-2026-0030",
    amountEur: 5_000_000,
  });
  const ocds = row({
    releaseId: "aop-abc",
    unp: "00594-2026-0030",
    amountEur: 5_000_000,
  });
  const shared = contentKeys(eop).filter((k) => contentKeys(ocds).includes(k));
  assert.ok(shared.includes("u:00594-2026-0030:222:5000000"));
});

test("contentKeys: rounded euro tolerates sub-euro drift", () => {
  const a = row({ unp: "U", amountEur: 1000.4 });
  const b = row({ unp: "U", amountEur: 1000.49 });
  assert.deepEqual(contentKeys(a), contentKeys(b));
});

test("contentKeys: matches only via the c: (contract-number) net", () => {
  // No УНП and DIFFERENT amounts, so neither the u: nor the f: net can fire;
  // the punctuation-normalised contract number is the sole bridge.
  const eop = row({
    releaseId: "eop-1",
    unp: "",
    contractId: "Д-1/2021",
    amountEur: 100,
  });
  const ocds = row({
    releaseId: "aop-1",
    unp: "",
    contractId: "д 1 2021",
    amountEur: 200,
  });
  const shared = contentKeys(eop).filter((k) => contentKeys(ocds).includes(k));
  assert.equal(shared.length, 1);
  assert.ok(shared[0].startsWith("c:"), shared[0]);
});

test("contentKeys: matches only via the f: (buyer+supplier+date+amount) net", () => {
  // No УНП and no contract number → the amount-and-date net is the only one left.
  const eop = row({
    releaseId: "eop-1",
    unp: "",
    contractId: "",
    amountEur: 500,
  });
  const ocds = row({
    releaseId: "aop-1",
    unp: "",
    contractId: "",
    amountEur: 500,
  });
  const shared = contentKeys(eop).filter((k) => contentKeys(ocds).includes(k));
  assert.equal(shared.length, 1);
  assert.ok(shared[0].startsWith("f:"), shared[0]);
});

// ── the `p:` net — buyer + procedure + contract + supplier + tag, no date, no amount.
// Measured on the cross-source pairs it exists for: date_signed differed on 9 of 9,
// the amount on 2 of 9, and the buyer EIK on 0 of 9.

test("contentKeys: the p: net matches across a differing date AND amount", () => {
  // The real shape of an identical-supplier cross-source pair: same buyer, procedure,
  // contract and supplier, but the feeds disagree on the signing date and split the value
  // by different supplier counts. The other three nets all embed one of those, so `p:` is
  // the only one that can bridge it.
  const eop = row({
    releaseId: "eop-1",
    unp: "05397-2020-0006",
    contractId: "103",
    awarderEik: "000695089",
    contractorEik: "831183118",
    dateSigned: "2020-12-18",
    amountEur: 1_379_976.79,
  });
  const ocds = row({
    releaseId: "aop-1",
    unp: "05397-2020-0006",
    contractId: "103",
    awarderEik: "000695089",
    contractorEik: "831183118",
    dateSigned: "2021-01-04",
    amountEur: 689_988.39,
  });
  const shared = contentKeys(eop).filter((k) => contentKeys(ocds).includes(k));
  assert.equal(shared.length, 1, `expected exactly the p: net, got ${shared}`);
  assert.ok(shared[0].startsWith("p:"), shared[0]);
});

test("contentKeys: the p: net does NOT span two lots of one procedure", () => {
  // A procedure routinely awards several contracts to the SAME supplier
  // (00373-2022-0009 has lots 48251 and 48271, both to Здравко Георгиев Иванов). Dropping
  // the contract number from the key would make those two look like one contract.
  const lotA = row({
    unp: "00373-2022-0009",
    contractId: "48251",
    amountEur: 1,
  });
  const lotB = row({
    unp: "00373-2022-0009",
    contractId: "48271",
    amountEur: 2,
  });
  const shared = contentKeys(lotA).filter((k) => contentKeys(lotB).includes(k));
  assert.deepEqual(shared, [], `two lots must share no key, got ${shared}`);
});

test("contentKeys: the p: net does NOT span a contract and its amendment", () => {
  // This net is the broadest, so without `tag` an EOP contract row would content-match the
  // OCDS amendment of the same award and be evicted as a twin of its own amendment.
  const c = row({
    unp: "00042-2024-0005",
    contractId: "194447",
    tag: "contract",
    amountEur: 100,
  });
  const a = row({
    unp: "00042-2024-0005",
    contractId: "194447",
    tag: "contractAmendment",
    amountEur: 200,
  });
  const sharedP = contentKeys(c)
    .filter((k) => contentKeys(a).includes(k))
    .filter((k) => k.startsWith("p:"));
  assert.deepEqual(
    sharedP,
    [],
    `contract vs amendment must not match on p:, got ${sharedP}`,
  );
});

test("contentKeys: KNOWN HOLE — the c: net does span a contract and its amendment", () => {
  // Captured deliberately rather than left implicit. `c:` is buyer + supplier +
  // contract-number + signing date, with no `tag`, so an amendment sharing its parent's
  // signing date content-matches the parent. In evictSupersededEopTwins that means an EOP
  // amendment can be evicted by an OCDS *contract*, losing the amendment.
  //
  // NOT fixed here. Adding `tag` to `c:`/`f:` makes cross-source matching stricter, which
  // reduces evictions and could therefore *increase* double-counting elsewhere — a
  // corpus-wide behaviour change that needs its own measurement, not a side effect of
  // adding the p: net. This test pins today's behaviour so the change is deliberate when
  // it comes: if you tighten those nets, this assertion is what should flip.
  const c = row({
    unp: "00042-2024-0005",
    contractId: "194447",
    tag: "contract",
    amountEur: 100,
  });
  const a = row({
    unp: "00042-2024-0005",
    contractId: "194447",
    tag: "contractAmendment",
    amountEur: 200,
  });
  const shared = contentKeys(c).filter((k) => contentKeys(a).includes(k));
  assert.deepEqual(
    shared.map((k) => k.split(":")[0]),
    ["c"],
    `expected only the c: net to span tags today, got ${shared}`,
  );
});

test("contentKeys: the p: net requires BOTH a УНП and a contract number", () => {
  // Missing either would widen it to "any row from this buyer to this supplier", matching
  // unrelated awards — the over-reach that, as a deletion rule, destroyed 46 legitimate rows.
  for (const partial of [
    row({ unp: "", contractId: "1" }),
    row({ unp: "00073-2020-0060", contractId: "" }),
  ]) {
    assert.equal(
      contentKeys(partial).filter((k) => k.startsWith("p:")).length,
      0,
      "p: must not be emitted without both identifiers",
    );
  }
});

test("eviction: the p: net evicts a twin the other nets miss", () => {
  const ocds = row({
    key: "o1",
    releaseId: "aop-1",
    unp: "00055-2022-0040",
    contractId: "91883",
    awarderEik: "000695089",
    contractorEik: "831183118",
    dateSigned: "2023-05-10",
    amountEur: 494_646.78,
  });
  const eopTwin = row({
    key: "e1",
    releaseId: "eop-1",
    unp: "00055-2022-0040",
    contractId: "91883",
    awarderEik: "000695089",
    contractorEik: "831183118",
    dateSigned: "2023-06-01",
    amountEur: 989_293.55,
  });
  const { kept, evicted } = evictSupersededEopTwins([eopTwin], [ocds]);
  assert.equal(evicted, 1);
  assert.equal(kept.length, 0);
});

test("eviction: an arriving EOP row never supersedes a content-identical on-disk EOP row", () => {
  // Guards the "OCDS authoritative" contract: only non-EOP arrivals may evict.
  const onDisk = row({
    key: "e1",
    releaseId: "eop-1",
    unp: "U",
    amountEur: 100,
  });
  const arrivingEop = row({
    key: "e2",
    releaseId: "eop-2",
    unp: "U",
    amountEur: 100,
  });
  const { kept, evicted } = evictSupersededEopTwins([onDisk], [arrivingEop]);
  assert.equal(evicted, 0);
  assert.equal(kept.length, 1);
});

test("isEopSourced only flags the eop- namespace", () => {
  assert.equal(isEopSourced(row({ releaseId: "eop-1" })), true);
  assert.equal(isEopSourced(row({ releaseId: "aop-1" })), false);
  assert.equal(isEopSourced(row({ releaseId: "ocds-1" })), false);
});

test("eviction drops the EOP twin when the OCDS row arrives", () => {
  const eopTwin = row({
    key: "e1",
    releaseId: "eop-1",
    unp: "00594-2026-0030",
    amountEur: 5_000_000,
  });
  const otherEop = row({
    key: "e2",
    releaseId: "eop-2",
    unp: "00887-2026-0002",
    amountEur: 40_000,
  });
  const arriving = row({
    key: "o1",
    releaseId: "aop-1",
    unp: "00594-2026-0030",
    amountEur: 5_000_000,
  });
  const { kept, evicted } = evictSupersededEopTwins(
    [eopTwin, otherEop, arriving],
    [arriving],
  );
  assert.equal(evicted, 1);
  assert.deepEqual(
    kept.map((r) => r.key).sort(),
    ["e2", "o1"],
    "the matching EOP twin is gone; the unmatched EOP row and the OCDS row stay",
  );
});

test("eviction never removes a non-EOP row, even on a content match", () => {
  // Two OCDS rows with identical content (a republish) must not be evicted by
  // this pass — the key merge, not content dedup, owns OCDS-vs-OCDS.
  const ocdsOld = row({
    key: "a",
    releaseId: "aop-1",
    unp: "U",
    amountEur: 100,
  });
  const arriving = row({
    key: "b",
    releaseId: "aop-2",
    unp: "U",
    amountEur: 100,
  });
  const { kept, evicted } = evictSupersededEopTwins(
    [ocdsOld, arriving],
    [arriving],
  );
  assert.equal(evicted, 0);
  assert.equal(kept.length, 2);
});

test("eviction is a no-op when nothing content-matches", () => {
  // Different supplier → no net matches (the УНП, contract-number and
  // buyer+supplier+date+amount nets all key on contractorEik).
  const eop = row({
    key: "e",
    releaseId: "eop-1",
    unp: "A",
    contractorEik: "222",
  });
  const arriving = row({
    key: "o",
    releaseId: "aop-1",
    unp: "B",
    contractorEik: "333",
  });
  const { kept, evicted } = evictSupersededEopTwins(
    [eop, arriving],
    [arriving],
  );
  assert.equal(evicted, 0);
  assert.equal(kept.length, 2);
});
