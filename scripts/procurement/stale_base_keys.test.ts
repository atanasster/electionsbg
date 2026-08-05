// Unit gate for stale-base-key detection (stale_base_keys.ts) — the module BOTH the one-shot
// sweep and the standing data gate run on.
//
// Hermetic: synthetic rows only, no shards and no database. The point is the same as
// cross_source.test.ts's: the corpus gate proves the rule reaches the right answer on the data we
// have; this proves it reaches the right answer on the cases the data does not currently contain.
// This pass DELETES rows from a gitignored tree that is not recoverable from git, and two earlier
// attempts in this family destroyed real data while reporting plausible counts — so every way the
// rule could over-select is pinned here.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { hashKey } from "./contract_key";
import {
  analyzeStaleBaseKeys,
  baseKeyOf,
  conflictsOf,
  currentKeyOf,
  documentId,
  evictStaleBaseKeys,
  identityOf,
  mintTimeEik,
  preflightOrder,
} from "./stale_base_keys";
import type { Contract } from "./types";

const BUNDLE = "c5404069-668a-4cd2-ab43-a1cdc26e03c6";

/** A legacy row whose key is filled in by the caller. `doc` is the ocid's document id. */
const row = (o: {
  doc?: string;
  eik?: string;
  contractId?: string;
  amount?: number;
  key?: string;
  year?: string;
  bundle?: string;
  extra?: Partial<Contract>;
}): Contract => {
  const doc = o.doc ?? "65860";
  const eik = o.eik ?? "203283623";
  const ocid = `aop-legacy-${o.year ?? "2020"}-${doc}`;
  const base: Contract = {
    key: o.key ?? "unset",
    ocid,
    releaseId: `${ocid}-${eik}`,
    contractId: o.contractId ?? "C-1",
    tag: "contract",
    date: "2020-10-14",
    dateSigned: "2020-09-30",
    awarderEik: "000695317",
    awarderName: "МИНИСТЕРСТВО НА ЗДРАВЕОПАЗВАНЕТО",
    contractorEik: eik,
    contractorName: "Фьоникс Фарма ЕООД",
    amount: o.amount ?? 3492000,
    currency: "BGN",
    amountEur: (o.amount ?? 3492000) / 1.95583,
    title: "Ваксина",
    bundleUuid: o.bundle ?? BUNDLE,
    sourceUrl: "u",
  } as Contract;
  return { ...base, ...o.extra };
};

/** The stale + live pair of the worked case: same identity, keys one formula apart. */
const pairRows = (over: Partial<Contract> = {}): Contract[] => {
  const probe = row({});
  const b = baseKeyOf(probe)!;
  const stale = row({ key: b });
  const live = row({ key: currentKeyOf(probe, b), extra: over });
  return [stale, live];
};

describe("key reconstruction", () => {
  test("mintTimeEik reads the EIK off releaseId, not the (rewritable) field", () => {
    const r = row({ eik: "203283623" });
    expect(mintTimeEik(r)).toBe("203283623");
    // __encode_personal_ids_inplace.ts rewrites contractorEik; releaseId is never rewritten.
    expect(mintTimeEik({ ...r, contractorEik: "person-abc" })).toBe(
      "203283623",
    );
  });

  test("mintTimeEik returns null on an unexpected shape rather than mis-hashing", () => {
    expect(mintTimeEik({ ...row({}), releaseId: "something-else" })).toBeNull();
    expect(baseKeyOf({ ...row({}), releaseId: "something-else" })).toBeNull();
  });

  test("documentId strips the year token, including the -RL variant", () => {
    expect(documentId("aop-legacy-2020-65860")).toBe("65860");
    expect(documentId("aop-legacy-2022-RL-1031860")).toBe("1031860");
  });

  test("reproduces the worked case's three real keys exactly", () => {
    const probe = row({});
    const base = baseKeyOf(probe)!;
    expect(base).toBe("ead302ce1ecd");
    expect(base).toBe(hashKey(`legacy::${BUNDLE}::65860::203283623`));
    expect(
      currentKeyOf(
        row({ contractId: "Договор №РД-11-485", amount: 3492000 }),
        base,
      ),
    ).toBe("3c5d7dffb956");
    expect(
      currentKeyOf(
        row({ contractId: "Договор №РД-11-485", amount: 1371600 }),
        base,
      ),
    ).toBe("cb415fc29f5b");
  });
});

describe("identityOf", () => {
  test("ignores display names — they are labels the ingest rewrites in place", () => {
    const a = row({});
    const b = {
      ...a,
      awarderName: "Министерство на здравеопазването",
      contractorName: "фьоникс фарма еоод",
    };
    expect(identityOf(a)).toBe(identityOf(b));
  });

  test("separates rows differing in any identity field", () => {
    const a = row({});
    for (const over of [
      { amount: 1 },
      { amountEur: 1 },
      { contractId: "other" },
      { unp: "00001-2020-0001" },
      { cpv: "99999999" },
      { title: "different" },
      { dateSigned: "2019-01-01" },
      { awarderEik: "000000002" },
      { contractorEik: "999999999" },
      // the 13-digit branch EIK is an identity, not a label
      { contractorEikFull: "2032836230011" },
      { currency: "EUR" },
    ] as Partial<Contract>[])
      expect(identityOf({ ...a, ...over })).not.toBe(identityOf(a));
  });
});

describe("conflictsOf", () => {
  test("reports numberOfTenderers, the published single-bidder signal", () => {
    const [a, b] = pairRows({ numberOfTenderers: 2 });
    expect(conflictsOf({ ...a, numberOfTenderers: 1 }, b)).toEqual([
      "numberOfTenderers: 1 → 2",
    ]);
  });

  test("is empty when only the key differs", () => {
    const [a, b] = pairRows();
    expect(conflictsOf(a, b)).toEqual([]);
  });
});

describe("analyzeStaleBaseKeys", () => {
  test("pairs a bare-key row with its re-derivable twin", () => {
    const [stale, live] = pairRows();
    const r = analyzeStaleBaseKeys([stale, live]);
    expect(r.pairs).toHaveLength(1);
    // The bare base key is evicted; the survivor is the one today's formula reproduces. (The real
    // corpus keys are pinned by "reproduces the worked case's three real keys exactly" above —
    // this fixture uses a synthetic contractId, so it derives the expectation.)
    expect(r.pairs[0].evicted.key).toBe("ead302ce1ecd");
    expect(r.pairs[0].survivor.key).toBe(live.key);
    expect(r.pairs[0].survivor.key).toBe(currentKeyOf(live, baseKeyOf(live)!));
    expect(r.unresolved).toHaveLength(0);
  });

  test("carries the conflict through instead of resolving it silently", () => {
    const [stale, live] = pairRows({ numberOfTenderers: 2 });
    const r = analyzeStaleBaseKeys([{ ...stale, numberOfTenderers: 1 }, live]);
    expect(r.pairs[0].conflicts).toEqual(["numberOfTenderers: 1 → 2"]);
  });

  test("NEVER evicts a lone bare key — that is a correct non-colliding row", () => {
    const probe = row({});
    expect(
      analyzeStaleBaseKeys([row({ key: baseKeyOf(probe)! })]).pairs,
    ).toEqual([]);
  });

  test("NEVER evicts a bare key whose base-group siblings are different contracts", () => {
    // The real shape of a colliding framework: two genuinely distinct lots under one document
    // number. Identity differs, so neither is the other's duplicate.
    const probe = row({});
    const base = baseKeyOf(probe)!;
    const other = row({ contractId: "C-2", amount: 1371600 });
    const r = analyzeStaleBaseKeys([
      row({ key: base }),
      { ...other, key: currentKeyOf(other, base) },
    ]);
    expect(r.pairs).toEqual([]);
    expect(r.unresolved).toEqual([]);
  });

  test("REFUSES when the identity-identical twin is not re-derivable", () => {
    const [stale] = pairRows();
    // A twin whose key matches neither formula — the two known 2022/2023 groups' shape.
    const r = analyzeStaleBaseKeys([stale, { ...stale, key: "deadbeef0000" }]);
    expect(r.pairs).toEqual([]);
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].reason).toMatch(/none carrying the current key/);
  });

  test("REFUSES an ambiguous group rather than picking a survivor", () => {
    const [stale, live] = pairRows();
    // Two rows carrying the SAME current key is impossible on disk (keys are unique), but the
    // refusal must not depend on that holding.
    const r = analyzeStaleBaseKeys([stale, live, { ...live }]);
    expect(r.pairs).toEqual([]);
    expect(r.unresolved[0].reason).toMatch(/ambiguous/);
  });

  test("never crosses base groups — a different bundle or document is a different base", () => {
    const [stale] = pairRows();
    const probe = row({ doc: "99999" });
    const elsewhere = row({
      doc: "99999",
      key: currentKeyOf(probe, baseKeyOf(probe)!),
    });
    expect(analyzeStaleBaseKeys([stale, elsewhere]).pairs).toEqual([]);
  });

  test("reports identity-identical duplicates it cannot resolve, rather than staying silent", () => {
    const a = { ...row({}), key: "aaaaaaaaaaaa" };
    const b = { ...row({}), key: "bbbbbbbbbbbb" };
    const r = analyzeStaleBaseKeys([a, b]);
    expect(r.pairs).toEqual([]);
    expect(r.unactedDuplicates).toHaveLength(1);
    expect(r.unactedDuplicates[0].map((x) => x.key).sort()).toEqual([
      "aaaaaaaaaaaa",
      "bbbbbbbbbbbb",
    ]);
  });

  test("ignores non-legacy feeds entirely", () => {
    const eop = { ...row({}), ocid: "eop-1", releaseId: "eop-1-203283623" };
    expect(analyzeStaleBaseKeys([eop, { ...eop, key: "x" }]).pairs).toEqual([]);
  });
});

describe("evictStaleBaseKeys (the writeMonthShards self-heal)", () => {
  test("removes the stale row and keeps the survivor", () => {
    const [stale, live] = pairRows();
    const r = evictStaleBaseKeys([stale, live], []);
    expect(r.rows.map((x) => x.key)).toEqual([live.key]);
    expect(r.evicted).toHaveLength(1);
    expect(r.evicted[0].evicted.key).toBe(stale.key);
    expect(r.evicted[0].survivor.key).toBe(live.key);
  });

  test("NEVER evicts a row the current ingest is writing (the de-collision inversion)", () => {
    // The bug this signature exists for. `disambiguateContractKeys` leaves a base key BARE when
    // it is unique in the batch, so a republished CSV that DE-COLLIDES a group arrives as the
    // bare-key member while the stale row holds the disambiguated key — the pair inverts. Without
    // the guard the pass evicts the ROW IT JUST INGESTED and reverts numberOfTenderers to the
    // superseded value, re-firing on every subsequent re-ingest.
    const probe = row({});
    const base = baseKeyOf(probe)!;
    const arrivingBare = row({ key: base, extra: { numberOfTenderers: 2 } });
    const staleDisamb = row({
      key: currentKeyOf(probe, base),
      extra: { numberOfTenderers: 1 },
    });
    const merged = [staleDisamb, arrivingBare];
    // Unguarded, this pair is evictable in the wrong direction…
    expect(analyzeStaleBaseKeys(merged).pairs[0].evicted.key).toBe(base);
    // …and the guard refuses it, leaving BOTH rows in place rather than reverting the new one.
    const r = evictStaleBaseKeys(merged, [arrivingBare]);
    expect(r.evicted).toEqual([]);
    expect(r.rows).toHaveLength(2);
  });

  test("still evicts a stale row when a DIFFERENT row is the arriving one", () => {
    const [stale, live] = pairRows();
    const unrelated = row({ doc: "99999", key: "cccccccccccc" });
    const r = evictStaleBaseKeys([stale, live, unrelated], [unrelated]);
    expect(r.evicted).toHaveLength(1);
    expect(r.evicted[0].evicted.key).toBe(stale.key);
  });

  test("is idempotent — the second pass is a no-op", () => {
    const [stale, live] = pairRows();
    const once = evictStaleBaseKeys([stale, live], []);
    const twice = evictStaleBaseKeys(once.rows, []);
    expect(twice.evicted).toEqual([]);
    expect(twice.rows).toBe(once.rows); // same reference: nothing rebuilt
  });

  test("returns the input untouched when there is nothing to heal", () => {
    const rows = [row({ key: "aaaaaaaaaaaa" }), row({ key: "bbbbbbbbbbbb" })];
    const r = evictStaleBaseKeys(rows, []);
    expect(r.rows).toBe(rows);
    expect(r.evicted).toEqual([]);
  });

  test("never touches a non-legacy feed", () => {
    const eop = { ...row({}), ocid: "eop-1", releaseId: "eop-1-203283623" };
    const rows = [eop, { ...eop, key: "x" }];
    expect(evictStaleBaseKeys(rows, []).evicted).toEqual([]);
  });

  test("a stale row and its survivor always share a month shard", () => {
    // What makes per-shard eviction sufficient. `identityOf` includes `date` and writeMonthShards
    // shards on date.slice(0, 7), so the two can never be split across files — by construction,
    // not by measurement. If identityOf ever drops `date`, this fails.
    const [stale, live] = pairRows();
    expect(stale.date.slice(0, 7)).toBe(live.date.slice(0, 7));
    expect(identityOf({ ...stale, date: "1999-01-01" })).not.toBe(
      identityOf(stale),
    );
  });
});

describe("the self-heal is wired into every shard-merge path", () => {
  // Source-level, like cross_reference.test.ts's guard on buildNamesakeFilteredLinkageMap. The
  // `-x` class needed one bespoke one-shot because its guard was missing from a merge path; this
  // fails if either path stops calling the eviction, rather than waiting for the corpus to drift.
  const paths = ["ingest.ts", "ingest_legacy.ts"];
  for (const f of paths)
    test(`${f} calls evictStaleBaseKeys inside writeMonthShards`, () => {
      const src = readFileSync(
        new URL(`./${f}`, import.meta.url).pathname,
        "utf8",
      );
      const start = src.indexOf("const writeMonthShards");
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf("\n};", start));
      expect(body).toContain("evictStaleBaseKeys");
      // …on the MERGED set (existing ∪ fresh), not on freshRows: a stale row lives in `existing`,
      // so evicting only among the arriving rows would never see it.
      expect(body.indexOf("evictStaleBaseKeys")).toBeGreaterThan(
        body.indexOf("byKey.set(r.key, r)"),
      );
      // …and `freshRows` MUST be the second argument. Without it a de-colliding re-ingest evicts
      // the row it just wrote and reverts numberOfTenderers — see the inversion test above. A
      // caller that drops the argument still compiles against `readonly Contract[]` if someone
      // later gives it a default, so pin the call shape here.
      expect(body).toMatch(/evictStaleBaseKeys\(\s*\w+,\s*freshRows\s*\)/);
    });
});

describe("preflightOrder", () => {
  test("passes on a corpus whose keys still reproduce", () => {
    expect(preflightOrder(pairRows())).toBeNull();
  });

  test("refuses when the key inputs have been rewritten since minting", () => {
    // What running after fix_amount_overrides.ts looks like: nothing reproduces either form, so
    // detection would find zero and exit green.
    const rows = Array.from({ length: 100 }, (_, i) =>
      row({ doc: String(i), key: `unreproducible${i}` }),
    );
    expect(preflightOrder(rows)).toMatch(/reproduce either key form/);
  });

  test("refuses an empty corpus rather than reporting a clean one", () => {
    expect(preflightOrder([])).toMatch(/no aop-legacy- rows/);
  });
});
