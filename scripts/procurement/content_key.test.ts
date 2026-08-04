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

test("eviction: an EOP row with NO twin is still evicted when OCDS covers the contract", () => {
  // The gap the foreign-member fix opened. The EOP parse now emits a supplier the OCDS parse
  // dropped, so that row content-matches nothing on the OCDS side, survives the row-level
  // nets, and lands ON TOP of the unchanged OCDS rows for the same contract — while the two
  // feeds also disagree on the split denominator (OCDS value/4 vs EOP value/5). Measured on
  // a real 2024–2026 re-ingest: 55 orphan rows / +€33.76m, e.g. 00044-2025-0148 (АПИ/Kapsch)
  // reading €78,264,000 against a €65,220,000 award.
  const ocdsA = row({
    key: "o1",
    releaseId: "ocds-1",
    unp: "00044-2025-0148",
    contractId: "232300",
    contractorEik: "111111111",
    amountEur: 16_305_000,
  });
  // Same contract, a supplier OCDS never emitted (a foreign consortium member), and a
  // DIFFERENT per-row amount because the EOP side splits by one more member.
  const eopOrphan = row({
    key: "e1",
    releaseId: "eop-00044-2025-0148-232300",
    unp: "00044-2025-0148",
    contractId: "232300",
    contractorEik: "78107349",
    amountEur: 13_044_000,
  });
  const { kept, evicted } = evictSupersededEopTwins([eopOrphan], [ocdsA]);
  assert.equal(
    evicted,
    1,
    "the orphan must be evicted on contract-level precedence",
  );
  assert.equal(kept.length, 0);
});

test("eviction: an EOP row for a contract OCDS does NOT cover survives", () => {
  // The other half — the feed is a documented superset, so an EOP-only contract must be kept.
  // Real example: 00119-2026-0034 (Щрабаг ЕАД, €2,556,450) exists only in the flat feed.
  const ocdsOther = row({
    key: "o1",
    releaseId: "ocds-1",
    unp: "00044-2025-0148",
    contractId: "232300",
    contractorEik: "111111111",
    amountEur: 100,
  });
  const eopOnly = row({
    key: "e1",
    releaseId: "eop-00119-2026-0034-255644",
    unp: "00119-2026-0034",
    contractId: "255644",
    contractorEik: "831643582",
    amountEur: 2_556_450,
  });
  const { kept, evicted } = evictSupersededEopTwins([eopOnly], [ocdsOther]);
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
