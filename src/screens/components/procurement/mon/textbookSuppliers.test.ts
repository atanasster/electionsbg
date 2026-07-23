// The tile sits on a page where MOST contracts are not textbooks (a school buys
// fuel, food and repairs through the same register), so the CPV filter is the
// load-bearing part — and the group bucketing has to match what /sector/edu
// shows, which is why both call publisherGroupOf.

import { describe, it, expect } from "vitest";
import { textbookSuppliersOf, type ContractRow } from "./textbookSuppliers";

const row = (over: Partial<ContractRow>): ContractRow => ({
  cpv: "22112000",
  amountEur: 1000,
  contractorEik: "131106522", // Просвета-София
  contractorName: "Просвета-София АД",
  date: "2024-05-01",
  ...over,
});

describe("textbookSuppliersOf", () => {
  it("keeps only CPV-22112 rows", () => {
    const s = textbookSuppliersOf([
      row({}),
      row({ cpv: "09134200", amountEur: 500000 }), // diesel
      row({ cpv: "45000000", amountEur: 90000 }), // building works
      row({ cpv: null }),
    ]);
    expect(s.contracts).toBe(1);
    expect(s.totalEur).toBe(1000);
  });

  it("merges the multi-EIK Просвета group into one row", () => {
    const s = textbookSuppliersOf([
      row({ contractorEik: "131106522", amountEur: 3000 }),
      row({ contractorEik: "206339963", amountEur: 1000 }), // Просвета Плюс
      row({ contractorEik: "175041923", amountEur: 1000 }), // Просвета АзБуки
    ]);
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0]).toMatchObject({
      id: "prosveta",
      eur: 5000,
      contracts: 3,
      pct: 100,
    });
  });

  it("ranks groups by value and computes shares over the textbook total", () => {
    const s = textbookSuppliersOf([
      row({ contractorEik: "131106522", amountEur: 3000 }),
      row({
        contractorEik: "130878827",
        contractorName: "Клет България ООД",
        amountEur: 1000,
      }),
      row({ cpv: "09134200", amountEur: 999999 }), // must not dilute the shares
    ]);
    expect(s.groups.map((g) => g.id)).toEqual(["prosveta", "klett"]);
    expect(s.groups[0].pct).toBe(75);
    expect(s.groups[1].pct).toBe(25);
  });

  it("buckets an unknown publisher by name, and a reseller as a distributor", () => {
    const s = textbookSuppliersOf([
      row({
        contractorEik: "999999999",
        contractorName: 'ИК "Архимед" ЕООД',
        amountEur: 100,
      }),
      row({
        contractorEik: "813044200",
        contractorName: "С.А.Н.-ПРО ЕООД",
        amountEur: 100,
      }),
    ]);
    expect(s.groups.map((g) => g.id).sort()).toEqual([
      "arhimed",
      "distributor",
    ]);
  });

  it("spans the years the textbook rows cover, ignoring the other CPVs", () => {
    const s = textbookSuppliersOf([
      row({ date: "2019-09-02" }),
      row({ date: "2026-08-15" }),
      row({ cpv: "09134200", date: "2011-01-01" }),
      row({ date: "" }),
    ]);
    expect(s.years).toEqual([2019, 2026]);
  });

  it("survives null amounts without turning the total into NaN", () => {
    const s = textbookSuppliersOf([
      row({ amountEur: null }),
      row({ amountEur: 250 }),
    ]);
    expect(s.totalEur).toBe(250);
    expect(s.contracts).toBe(2);
  });

  it("is empty for a school that buys no textbooks", () => {
    const s = textbookSuppliersOf([row({ cpv: "09134200" })]);
    expect(s).toEqual({ groups: [], totalEur: 0, contracts: 0, years: [] });
  });
});
