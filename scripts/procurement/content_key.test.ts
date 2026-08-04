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
  feedOf,
  feedRank,
} from "./content_key";
import { identityE } from "./cross_source";
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

test("feedOf splits the four feeds; anything unrecognised is legacy aop", () => {
  assert.equal(feedOf(row({ releaseId: "ocds-e82gsb-1" })), "ocds");
  assert.equal(feedOf(row({ releaseId: "eop-1" })), "eop");
  assert.equal(feedOf(row({ releaseId: "rop-1" })), "rop");
  assert.equal(feedOf(row({ releaseId: "aop-legacy-2019-1-2" })), "aop");
  // Never a silent fifth bucket: an unknown generator belongs with the legacy pile.
  assert.equal(feedOf(row({ releaseId: "mystery-1" })), "aop");
  // isEopSourced stays the parse-time primitive and must agree with feedOf.
  for (const id of ["ocds-e1", "eop-1", "rop-1", "aop-legacy-1"])
    assert.equal(
      isEopSourced(row({ releaseId: id })),
      feedOf(row({ releaseId: id })) === "eop",
    );
});

test("feedRank orders ocds > aop > eop > rop", () => {
  const r = (id: string): number => feedRank(row({ releaseId: id }));
  assert.ok(r("ocds-e1") < r("aop-legacy-1"));
  // Easy to get backwards — corpus-wide averages say eop is richer, but on the pairs this
  // ordering decides, aop carries the annex links and eu_funded. See the FEED_RANK comment.
  assert.ok(r("aop-legacy-1") < r("eop-1"));
  assert.ok(r("eop-1") < r("rop-1"));
});

test("identity E is CONTAINED in the u: net, which is why there is no e: net here", () => {
  // The property that makes an identity-E content net dead code: identity E is
  // (unp, contractor, rounded €, date, tag) and `u:` is (unp, contractor, rounded €), so any
  // two rows agreeing on E already collide on `u:`. These nets are a union, so a strictly
  // narrower one can never add a match.
  //
  // Asserted rather than argued. The way this claim goes false is `u:` being given a component
  // identity E does NOT carry — the buyer, the contract number, the release — so the fixture
  // rows agree on EXACTLY the identity-E fields and differ on every other one. Adding
  // `awarderEik` to `u:`, or requiring it in `u:`'s guard, then fails here. (Adding the DATE to
  // `u:` cannot break containment, since E already fixes it; dropping the amount is a widening.
  // An earlier version of this comment named those two and was wrong on both.)
  const shape = {
    unp: "00001-2020-0001",
    contractorEik: "111111111",
    dateSigned: "2020-01-01",
    tag: "contract" as const,
  };
  const a = row({
    ...shape,
    releaseId: "aop-legacy-1",
    awarderEik: "111111111",
    contractId: "32038",
    amountEur: 1000,
  });
  const b = row({
    ...shape,
    releaseId: "eop-1",
    awarderEik: "999999999",
    contractId: "СОА21-ДГ55-32",
    amountEur: 1000.4, // rounds equal
  });
  // Non-null first: `assert.equal(null, null)` would pass vacuously if the fixture ever stopped
  // carrying a full identity, and the containment assertion below would then prove nothing.
  assert.ok(identityE(a), "fixture row a must carry an identity E");
  assert.equal(identityE(a), identityE(b), "fixture must agree on identity E");
  const shared = contentKeys(a).filter((k) => contentKeys(b).includes(k));
  assert.ok(
    shared.some((k) => k.startsWith("u:")),
    `rows agreeing on identity E must already collide on the u: net; shared keys were ${JSON.stringify(shared)}`,
  );
});

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

test("the p: net is INERT at parse time — it needs a backfilled УНП on both sides", () => {
  // Load-bearing limitation, pinned so it cannot be forgotten again. `normalize.ts` never sets
  // `unp` (the OCDS export carries none; backfill_unp.ts writes it onto the shards afterwards),
  // and `ingest.ts` passes freshly-parsed OCDS rows as `arriving`. So at parse time the
  // arriving side has no `unp`, emits no `p:` key, and this net cannot fire — measured over the
  // whole corpus in that shape: 8 evictions become 0.
  //
  // Which means cross-source reconciliation that depends on the УНП belongs in a POST-BACKFILL
  // pass, not in the parse-time eviction. Three earlier attempts at a precedence rule failed on
  // this same constraint before it was named. See plan §9.
  const ocdsNoUnp = row({
    releaseId: "aop-1",
    unp: "", // ← the real parse-time shape
    contractId: "91883",
    awarderEik: "000695089",
    contractorEik: "831183118",
    dateSigned: "2023-05-10",
    amountEur: 494_646.78,
  });
  const eopTwin = row({
    releaseId: "eop-1",
    unp: "00055-2022-0040",
    contractId: "91883",
    awarderEik: "000695089",
    contractorEik: "831183118",
    dateSigned: "2023-06-01",
    amountEur: 989_293.55,
  });
  assert.equal(
    contentKeys(ocdsNoUnp).filter((k) => k.startsWith("p:")).length,
    0,
    "an unbackfilled OCDS row cannot emit a p: key",
  );
  const { evicted } = evictSupersededEopTwins([eopTwin], [ocdsNoUnp]);
  assert.equal(evicted, 0, "so the twin survives parse-time eviction");
});

test("the survivor precondition is computable WITHOUT a УНП", () => {
  // The precondition must not repeat the mistake above. Keyed on (buyer, contract number, tag)
  // it is satisfiable by an unbackfilled OCDS row, so it narrows evictions without disabling
  // them. A first draft keyed it on the УНП and silently made 109,043 EOP rows unevictable.
  const ocdsNoUnp = row({
    releaseId: "aop-1",
    unp: "",
    contractId: "77",
    awarderEik: "000695089",
    contractorEik: "222",
    dateSigned: "2023-05-10",
    amountEur: 500,
  });
  // Same buyer/contract/supplier/date/amount → the f: net matches, and the precondition is
  // satisfied because buyer+contract+tag agree.
  const eopTwin = row({
    releaseId: "eop-1",
    unp: "00055-2022-0040",
    contractId: "77",
    awarderEik: "000695089",
    contractorEik: "222",
    dateSigned: "2023-05-10",
    amountEur: 500,
  });
  const { evicted } = evictSupersededEopTwins([eopTwin], [ocdsNoUnp]);
  assert.equal(evicted, 1, "a genuine parse-time twin must still be evictable");
});

test("the survivor precondition blocks an eviction that would orphan the contract", () => {
  // The f: net carries no contract number, so within one procedure it matches ACROSS
  // contracts — a buyer signing several contracts with one supplier on the same day for the
  // same amount. Measured: 6 such evictions left their contract with no row at all, including
  // 02023-2023-0001/118827 (Нивел строй, €4,136,627.87) matched to contract 118779.
  const ocdsOtherContract = row({
    releaseId: "aop-1",
    unp: "",
    contractId: "118779",
    awarderEik: "831160078",
    contractorEik: "222",
    dateSigned: "2023-12-01",
    amountEur: 4_136_627.87,
  });
  const eopThisContract = row({
    releaseId: "eop-1",
    unp: "02023-2023-0001",
    contractId: "118827",
    awarderEik: "831160078",
    contractorEik: "222",
    dateSigned: "2023-12-01",
    amountEur: 4_136_627.87,
  });
  const { kept, evicted } = evictSupersededEopTwins(
    [eopThisContract],
    [ocdsOtherContract],
  );
  assert.equal(evicted, 0, "no survivor for contract 118827 → must not evict");
  assert.equal(kept.length, 1);
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
