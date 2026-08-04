// Gate for the OCDS normalizer's supplier handling.
//
// This file exists because `normalize.ts` had NO unit coverage at all, while carrying two
// money-splitting behaviours that were each measurably wrong:
//
//   1. Every non-BG supplier was dropped (`isValidEik` gate, no foreign recovery), so joint
//      awards recorded the wrong counterparty. This is the OCDS half of the defect that lost
//      both Alstom entities on УНП 00042-2024-0005 — see
//      docs/plans/procurement-foreign-consortium-members-v1.md, D-2.
//   2. The split denominator counted supplier REFS rather than DISTINCT resolved keys, and
//      its self-deal predicate differed from the emit loop's. Rows sharing a contractorEik
//      collapse at the month-shard rowKey merge, so a duplicated supplier inflated the
//      denominator and (N-1)/N of the contract merged away — 477 OCDS groups, €7.9m.
//
// Denominator symmetry between the two feeds is load-bearing, not cosmetic: `contentKeys()`
// matches a logical contract across the OCDS and ЦАИС feeds on (contractorEik, rounded
// amountEur), so if the two paths split by different counts, cross-source dedup stops
// matching and the same contract survives from both feeds — double-counted.
//
//   npx vitest run scripts/procurement/normalize.test.ts

import { describe, test, expect } from "vitest";
import { normalizeBundle } from "./normalize";

const BUYER = {
  id: "b1",
  identifier: { id: "000695388", legalName: "МИНИСТЕРСТВО НА ТРАНСПОРТА" },
};

// Minimal OCDS release carrying one signed contract and a supplier list.
const bundle = (
  suppliers: Array<{ id: string; eik: string; name: string }>,
  amount = 1000,
) => ({
  uri: "http://x",
  releases: [
    {
      ocid: "ocds-test-1",
      id: "r1",
      date: "2025-05-02T00:00:00Z",
      tag: ["contract"],
      buyer: { id: "b1" },
      parties: [
        { ...BUYER, roles: ["buyer"] },
        ...suppliers.map((s) => ({
          id: s.id,
          roles: ["supplier"],
          identifier: { id: s.eik, legalName: s.name },
        })),
      ],
      awards: [
        {
          id: "a1",
          suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
        },
      ],
      contracts: [
        {
          id: "c1",
          awardID: "a1",
          value: { amount, currency: "EUR" },
          dateSigned: "2025-04-25",
        },
      ],
    },
  ],
});

const run = (b: ReturnType<typeof bundle>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  normalizeBundle(b as any, "dataset-uuid");

describe("normalizeBundle — supplier resolution", () => {
  test("keeps a foreign supplier instead of dropping it", () => {
    const { rows } = run(
      bundle([
        { id: "s1", eik: "181339162", name: "КОНСОРЦИУМ БУЛЕМУ" },
        { id: "s2", eik: "RO6640696", name: "ALSTOM TRANSPORT SA" },
      ]),
    );
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.contractorEik).sort()).toEqual([
      "181339162",
      "RO6640696",
    ]);
    // Split over both, summing back to the contract value.
    expect(rows.reduce((s, r) => s + (r.amount ?? 0), 0)).toBe(1000);
  });

  test("an ЕГН never becomes the contractor key", () => {
    const { rows } = run(
      bundle([
        { id: "s1", eik: "6207316703", name: "Венцеслав Георгиев Делов" },
      ]),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].contractorEik).toMatch(/^np-[0-9a-f]{12}$/);
    expect(rows[0].contractorEik).not.toContain("6207316703");
    // The raw token must not survive in the "source id" field either.
    expect(rows[0].contractorEikFull ?? "").not.toContain("6207316703");
  });

  test("the split denominator counts DISTINCT keys, not refs", () => {
    // The same company listed twice — a real shape in the feed. Both refs resolve to one
    // key, the two rows collapse at the rowKey merge, so splitting by 2 would lose half
    // the contract. Splitting by 1 distinct key keeps it whole.
    const { rows } = run(
      bundle([
        { id: "s1", eik: "181339162", name: "Фирма ЕООД" },
        { id: "s2", eik: "181339162", name: "Фирма ЕООД" },
      ]),
    );
    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect([...byKey.values()].reduce((s, r) => s + (r.amount ?? 0), 0)).toBe(
      1000,
    );
  });

  test("a self-deal supplier is dropped and does not take a split slot", () => {
    // buyer EIK reused as the supplier id is the feed's "missing supplier" placeholder.
    // The count and the emit loop must agree on dropping it, or the survivors come up
    // short — they previously disagreed when the names matched.
    const { rows } = run(
      bundle([
        { id: "s1", eik: "181339162", name: "Фирма ЕООД" },
        {
          id: "s2",
          eik: "000695388",
          name: "МИНИСТЕРСТВО НА ТРАНСПОРТА",
        },
      ]),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].contractorEik).toBe("181339162");
    expect(rows[0].amount).toBe(1000);
  });
});
