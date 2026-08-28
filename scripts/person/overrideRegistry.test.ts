import { describe, expect, it } from "vitest";
import {
  mergeOverrideRows,
  overrideKey,
  parseOverrideRegistry,
} from "./overrideRegistry";
import type { OverrideRow } from "./overrides";

const entry = {
  kind: "merge",
  refA: "2021:a",
  refB: "2022:b",
  note: "Operator verified both candidacies as the same person",
  decidedBy: "operator",
  decidedAt: "2026-08-28",
  evidence: [],
};

const registry = (overrides: unknown[]) => ({ schemaVersion: 1, overrides });

describe("parseOverrideRegistry", () => {
  it("loads an audited ref merge into the resolver row shape", () => {
    expect(parseOverrideRegistry(registry([entry]))).toEqual([
      {
        override_id: "committed:1",
        kind: "merge",
        fold_a: null,
        fold_b: null,
        ref_a: "2021:a",
        ref_b: "2022:b",
      },
    ]);
  });

  it.each([
    [{ ...entry, note: "" }, "note must be a non-empty string"],
    [{ ...entry, decidedBy: "" }, "decidedBy must be a non-empty string"],
    [{ ...entry, decidedAt: "28/08/2026" }, "must be a real YYYY-MM-DD date"],
    [{ ...entry, decidedAt: "2026-02-29" }, "must be a real YYYY-MM-DD date"],
    [{ ...entry, decidedAt: "2026-13-01" }, "must be a real YYYY-MM-DD date"],
    [{ ...entry, evidence: null }, "evidence must be an array"],
    [{ ...entry, kind: "join" }, "kind must be merge or split"],
    [{ ...entry, refB: undefined }, "requires both ref_a and ref_b"],
    [{ ...entry, refB: "2021:a" }, "cannot target the same ref twice"],
    [{ ...entry, foldA: "a", foldB: "b" }, "cannot be mixed"],
  ])("rejects malformed audited entries", (bad, message) => {
    expect(() => parseOverrideRegistry(registry([bad]))).toThrow(message);
  });

  it("rejects duplicate decisions independent of endpoint order", () => {
    expect(() =>
      parseOverrideRegistry(
        registry([entry, { ...entry, refA: entry.refB, refB: entry.refA }]),
      ),
    ).toThrow("duplicate committed person override");
  });

  it("accepts a real leap day", () => {
    expect(
      parseOverrideRegistry(registry([{ ...entry, decidedAt: "2024-02-29" }])),
    ).toHaveLength(1);
  });
});

describe("mergeOverrideRows", () => {
  const committed = parseOverrideRegistry(registry([entry]));
  const duplicateDb: OverrideRow = {
    kind: "merge",
    fold_a: null,
    fold_b: null,
    ref_a: entry.refB,
    ref_b: entry.refA,
  };

  it("deduplicates a DB hotfix already promoted to the committed registry", () => {
    expect(mergeOverrideRows(committed, [duplicateDb])).toEqual(committed);
  });

  it("keeps a contrary split because precedence, not dedupe, resolves it", () => {
    const split = { ...duplicateDb, kind: "split" as const };
    expect(mergeOverrideRows(committed, [split])).toHaveLength(2);
    expect(overrideKey(split)).not.toBe(overrideKey(committed[0]));
  });
});
