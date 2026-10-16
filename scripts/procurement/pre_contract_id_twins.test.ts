// Fixture tests for the contract-number-less legacy twin rule
// (docs/plans/procurement-same-feed-dedup-v1.md §7). The shapes are the real ones:
// ДЗЗД Джисиеф Стара Загора–Завой (one lot, €77,479,126.61 twice) and a 15-lot document
// whose lots share one amount.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Contract } from "./types";
import {
  analyzePreContractIdTwins,
  evictPreContractIdTwins,
  isPreCidCandidate,
} from "./pre_contract_id_twins";

const row = (over: Partial<Contract>): Contract =>
  ({
    key: "k",
    ocid: "aop-legacy-2011-2015-426546",
    releaseId: "aop-legacy-2011-2015-426546-176032806",
    tag: "contract",
    date: "2011-02-14",
    awarderEik: "130823243",
    awarderName: "НКЖИ",
    contractorEik: "176032806",
    contractorName: "ДЗЗД",
    amount: 151_536_000,
    currency: "BGN",
    amountEur: 77_479_126.61,
    title: "Рехабилитация на железопътните отсечки Стара Загора – Завой",
    ...over,
  }) as Contract;

const orphan = row({ key: "62583709a53d", dateSigned: "2011-02-14" });
const live = row({
  key: "4fafad32949f",
  contractId: "3619",
  dateSigned: "2011-02-08",
});

describe("analyzePreContractIdTwins", () => {
  it("evicts the number-less row when a fresh parse produces only its numbered twin", () => {
    const { pairs, refused } = analyzePreContractIdTwins(
      [orphan, live],
      new Set([live.key]),
    );
    expect(pairs.map((p) => [p.evicted.key, p.survivor.key])).toEqual([["62583709a53d", "4fafad32949f"]]); // prettier-ignore
    expect(refused).toEqual([]);
  });

  it("matches on the NATIVE amount, so an annexed twin (amountEur flipped) still pairs", () => {
    const annexed = { ...live, amountEur: 80_000_000 };
    expect(analyzePreContractIdTwins([orphan, annexed], new Set([live.key])).pairs).toHaveLength(1); // prettier-ignore
  });

  it("refuses when a fresh parse DOES produce the number-less row", () => {
    const { pairs, refused } = analyzePreContractIdTwins([orphan, live], new Set([orphan.key, live.key])); // prettier-ignore
    expect(pairs).toEqual([]);
    expect(refused[0].reason).toMatch(/produces this row/);
  });

  it("refuses when the fresh parse produces a number-less row of the same identity under another key", () => {
    const numberless = new Set([JSON.stringify([orphan.releaseId, orphan.amount, orphan.currency, orphan.title])]); // prettier-ignore
    const res = analyzePreContractIdTwins(
      [orphan, live],
      new Set([live.key]),
      numberless,
    );
    expect(res.pairs).toEqual([]);
    expect(res.refused[0].reason).toMatch(/key may have moved/);
  });

  it("refuses when no sibling is confirmed by the fresh parse", () => {
    expect(analyzePreContractIdTwins([orphan, live], new Set()).refused[0].reason).toMatch(/no sibling/); // prettier-ignore
  });

  it("leaves a lone number-less row alone — it duplicates nothing", () => {
    const res = analyzePreContractIdTwins([orphan], new Set());
    expect(res.pairs).toEqual([]);
    expect(res.refused).toEqual([]);
  });

  it("does not pair across a different amount, title, contractor or document", () => {
    for (const other of [
      { amount: 1 },
      { title: "друго" },
      { releaseId: "aop-legacy-2011-2015-426546-999999999" },
      { releaseId: "aop-legacy-2011-2015-426547-176032806" },
    ])
      expect(analyzePreContractIdTwins([orphan, row({ ...other, key: "x", contractId: "1" })], null).pairs).toEqual([]); // prettier-ignore
  });

  it("never touches amendments or non-legacy feeds", () => {
    expect(isPreCidCandidate(row({ tag: "contractAmendment" }))).toBe(false);
    expect(isPreCidCandidate(row({ ocid: "eop-123" }))).toBe(false);
  });

  it("names one deterministic survivor in a many-lot document with one shared amount", () => {
    const lots = [3, 1, 2].map((i) =>
      row({ key: `lot${i}`, contractId: `0320011130038${i}` }),
    );
    const { pairs } = analyzePreContractIdTwins(
      [orphan, ...lots],
      new Set(lots.map((l) => l.key)),
    );
    expect(pairs.map((p) => p.survivor.key)).toEqual(["lot1"]);
  });
});

describe("evictPreContractIdTwins (the ingest self-heal)", () => {
  it("evicts the stale row when the arriving batch carries its numbered twin", () => {
    const out = evictPreContractIdTwins([orphan, live], [live]);
    expect(out.rows).toEqual([live]);
    expect(out.evicted).toHaveLength(1);
  });

  it("cannot pair across months — it only ever sees one shard (the sweep clears that case)", () => {
    // The merge hands it one month's rows: an orphan whose twin sits in another month's shard
    // is simply not in `rows`, so nothing is evicted.
    expect(evictPreContractIdTwins([orphan], [live]).evicted).toEqual([]);
  });

  it("never evicts an arriving row, and does nothing for a non-legacy batch", () => {
    expect(
      evictPreContractIdTwins([orphan, live], [orphan, live]).evicted,
    ).toEqual([]);
    expect(evictPreContractIdTwins([orphan, live], [row({ ocid: "eop-1", key: "e" })]).evicted).toEqual([]); // prettier-ignore
  });
});

describe("the self-heal is wired into every shard-merge path", () => {
  for (const f of ["ingest.ts", "ingest_legacy.ts"])
    it(`${f} calls evictPreContractIdTwins on the merged shard with freshRows`, () => {
      const src = readFileSync(
        new URL(`./${f}`, import.meta.url).pathname,
        "utf8",
      );
      const start = src.indexOf("const writeMonthShards");
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf("\n};", start));
      expect(body.indexOf("evictPreContractIdTwins")).toBeGreaterThan(body.indexOf("byKey.set(r.key, r)")); // prettier-ignore
      expect(body).toMatch(
        /evictPreContractIdTwins\(\s*[\w.]+,\s*freshRows\s*\)/,
      );
    });
});
