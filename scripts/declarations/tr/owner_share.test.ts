import { describe, it, expect } from "vitest";
import { shareEur, isEurCurrency, ownerSharePercents } from "./owner_share";
import type { OwnerRecord } from "./owner_share";

const rec = (o: Partial<OwnerRecord> & { key: string }): OwnerRecord => ({
  name: o.nameNormalized ?? o.key.toUpperCase(),
  nameNormalized: o.key.toUpperCase(),
  role: "partner",
  addedAt: "2026-01-01",
  erasedAt: null,
  shareAmount: null,
  shareCurrency: null,
  ...o,
});

describe("shareEur", () => {
  it("passes a euro amount through, whatever the spelling", () => {
    for (const c of ["EUR", "eur", " Euro ", "ЕВРО", "€"])
      expect(shareEur(100, c)).toBe(100);
  });

  it("treats a blank currency as лв — pre-2026 filings carry no currency cell", () => {
    for (const c of [null, undefined, "", "  "])
      expect(shareEur(195.583, c)).toBeCloseTo(100, 6);
    expect(shareEur(195.583, "BGN")).toBeCloseTo(100, 6);
  });

  it("REFUSES an unrecognised currency rather than pegging it", () => {
    // A USD amount divided by 1.95583 is a wrong percentage indistinguishable
    // from a right one — the whole thing this rule exists to prevent.
    for (const c of ["USD", "GBP", "CHF"]) expect(shareEur(100, c)).toBeNull();
  });

  it("returns null for a missing amount", () => {
    expect(shareEur(null, "EUR")).toBeNull();
    expect(shareEur(undefined, "EUR")).toBeNull();
    expect(shareEur(Number.NaN, "EUR")).toBeNull();
  });

  it("classifies the euro spellings and nothing else", () => {
    expect(isEurCurrency("ЕВРО")).toBe(true);
    expect(isEurCurrency("BGN")).toBe(false);
    expect(isEurCurrency(null)).toBe(false);
  });
});

describe("ownerSharePercents — the vintage", () => {
  it("divides by the LATEST vintage only, not by every non-erased record", () => {
    // БИЛЯНА ООД (104119056), the case that opened this work. Summing all four
    // records gives 25.57 / 8.28; the current vintage gives 75.54 / 24.46.
    const out = ownerSharePercents([
      rec({
        key: "a1",
        nameNormalized: "ЛЕФТЕР",
        addedAt: "2022-03-28",
        shareAmount: 12564,
      }),
      rec({
        key: "b1",
        nameNormalized: "МИЛЕНА",
        addedAt: "2022-03-28",
        shareAmount: 4068,
      }),
      rec({
        key: "a2",
        nameNormalized: "ЛЕФТЕР",
        addedAt: "2026-07-03",
        shareAmount: 6428.58,
        shareCurrency: "EUR",
      }),
      rec({
        key: "b2",
        nameNormalized: "МИЛЕНА",
        addedAt: "2026-07-03",
        shareAmount: 2081.46,
        shareCurrency: "EUR",
      }),
    ]);
    expect(out.get("a2")).toBeCloseTo(75.5411, 3);
    expect(out.get("b2")).toBeCloseTo(24.4589, 3);
    // The superseded vintage carries no percentage — it is not a current stake.
    expect(out.get("a1")).toBeNull();
    expect(out.get("b1")).toBeNull();
  });

  it("folds currency before dividing, so a mixed-currency vintage is not added raw", () => {
    // МИТОТОПИЯ (208164555): 40 EUR against 60 BGN (= 30.68 EUR). Unfolded this
    // reads 40 / 60 — the majority owner FLIPS.
    const out = ownerSharePercents([
      rec({
        key: "e",
        nameNormalized: "ДИМИТЪР",
        shareAmount: 40,
        shareCurrency: "EUR",
      }),
      rec({
        key: "l",
        nameNormalized: "РАДОСЛАВ",
        shareAmount: 60,
        shareCurrency: "BGN",
      }),
    ]);
    expect(out.get("e")).toBeCloseTo(56.5951, 3);
    expect(out.get("l")).toBeCloseTo(43.4049, 3);
    expect(out.get("e")!).toBeGreaterThan(out.get("l")!);
  });

  it("sums a person's several records inside one vintage", () => {
    const out = ownerSharePercents([
      rec({
        key: "a1",
        nameNormalized: "А",
        shareAmount: 30,
        shareCurrency: "EUR",
      }),
      rec({
        key: "a2",
        nameNormalized: "А",
        shareAmount: 30,
        shareCurrency: "EUR",
      }),
      rec({
        key: "b",
        nameNormalized: "Б",
        shareAmount: 40,
        shareCurrency: "EUR",
      }),
    ]);
    expect(out.get("a1")).toBeCloseTo(60, 6);
    expect(out.get("a2")).toBeCloseTo(60, 6);
    expect(out.get("b")).toBeCloseTo(40, 6);
  });

  it("ignores erased records and non-owner roles entirely", () => {
    const out = ownerSharePercents([
      rec({
        key: "gone",
        nameNormalized: "Х",
        shareAmount: 900,
        shareCurrency: "EUR",
        erasedAt: "2025-01-01",
      }),
      rec({
        key: "mgr",
        nameNormalized: "У",
        role: "manager",
        shareAmount: 900,
        shareCurrency: "EUR",
      }),
      rec({
        key: "a",
        nameNormalized: "А",
        shareAmount: 50,
        shareCurrency: "EUR",
      }),
      rec({
        key: "b",
        nameNormalized: "Б",
        shareAmount: 50,
        shareCurrency: "EUR",
      }),
    ]);
    expect(out.get("gone")).toBeNull();
    expect(out.get("mgr")).toBeNull();
    expect(out.get("a")).toBeCloseTo(50, 6);
  });
});

describe("ownerSharePercents — the refusals", () => {
  it("a lone sole_owner is 100% even with no declared amount", () => {
    const out = ownerSharePercents([
      rec({ key: "s", role: "sole_owner", shareAmount: null }),
    ]);
    expect(out.get("s")).toBe(100);
  });

  it("a sole_owner sharing its vintage with partners gets NO percentage", () => {
    // The superseded-ЕООД case. Answering 100% here is what published companies
    // whose shares summed to a mean of 200.8%.
    const out = ownerSharePercents([
      rec({
        key: "s",
        nameNormalized: "С",
        role: "sole_owner",
        shareAmount: null,
      }),
      rec({
        key: "a",
        nameNormalized: "А",
        shareAmount: 50,
        shareCurrency: "EUR",
      }),
      rec({
        key: "b",
        nameNormalized: "Б",
        shareAmount: 50,
        shareCurrency: "EUR",
      }),
    ]);
    expect(out.get("s")).toBeNull();
    expect(out.get("a")).toBeNull();
    expect(out.get("b")).toBeNull();
  });

  it("refuses the WHOLE company when any current owner has no amount", () => {
    // Excluding just that row would inflate everyone else against a short
    // denominator — the same defect wearing new clothes.
    const out = ownerSharePercents([
      rec({
        key: "a",
        nameNormalized: "А",
        shareAmount: 50,
        shareCurrency: "EUR",
      }),
      rec({ key: "b", nameNormalized: "Б", shareAmount: null }),
    ]);
    expect(out.get("a")).toBeNull();
    expect(out.get("b")).toBeNull();
  });

  it("refuses one person's stake restated in both лв and EUR in one vintage", () => {
    // A holding carried across the re-denomination is one stake recorded twice;
    // summing them publishes a doubled position.
    const out = ownerSharePercents([
      rec({
        key: "a1",
        nameNormalized: "А",
        shareAmount: 2500,
        shareCurrency: null,
      }),
      rec({
        key: "a2",
        nameNormalized: "А",
        shareAmount: 1300,
        shareCurrency: "EUR",
      }),
      rec({
        key: "b",
        nameNormalized: "Б",
        shareAmount: 1300,
        shareCurrency: "EUR",
      }),
    ]);
    expect(out.get("a1")).toBeNull();
    expect(out.get("a2")).toBeNull();
    expect(out.get("b")).toBeNull();
  });

  it("does NOT refuse two DIFFERENT people filing in different currencies", () => {
    // The predicate groups per person; a mixed-currency vintage across two
    // partners is ordinary and must still publish (see МИТОТОПИЯ above).
    const out = ownerSharePercents([
      rec({
        key: "a",
        nameNormalized: "А",
        shareAmount: 40,
        shareCurrency: "EUR",
      }),
      rec({
        key: "b",
        nameNormalized: "Б",
        shareAmount: 60,
        shareCurrency: "BGN",
      }),
    ]);
    expect(out.get("a")).not.toBeNull();
    expect(out.get("b")).not.toBeNull();
  });

  it("refuses an undated record in a dated company rather than dropping it", () => {
    // Dropping it would inflate the survivors to 50/50 — and they would still
    // sum to 100%, so no sums-to-100 check could see it.
    const out = ownerSharePercents([
      rec({
        key: "a",
        nameNormalized: "А",
        shareAmount: 50,
        shareCurrency: "EUR",
      }),
      rec({
        key: "b",
        nameNormalized: "Б",
        shareAmount: 50,
        shareCurrency: "EUR",
      }),
      rec({
        key: "u",
        nameNormalized: "В",
        shareAmount: 50,
        shareCurrency: "EUR",
        addedAt: null,
      }),
    ]);
    expect(out.get("a")).toBeNull();
    expect(out.get("b")).toBeNull();
    expect(out.get("u")).toBeNull();
  });

  it("treats every record as current when the company files no dates at all", () => {
    const out = ownerSharePercents([
      rec({
        key: "a",
        nameNormalized: "А",
        shareAmount: 50,
        shareCurrency: "EUR",
        addedAt: null,
      }),
      rec({
        key: "b",
        nameNormalized: "Б",
        shareAmount: 50,
        shareCurrency: "EUR",
        addedAt: null,
      }),
    ]);
    expect(out.get("a")).toBeCloseTo(50, 6);
    expect(out.get("b")).toBeCloseTo(50, 6);
  });

  it("refuses an unrecognised currency instead of pegging it", () => {
    const out = ownerSharePercents([
      rec({
        key: "a",
        nameNormalized: "А",
        shareAmount: 50,
        shareCurrency: "USD",
      }),
      rec({
        key: "b",
        nameNormalized: "Б",
        shareAmount: 50,
        shareCurrency: "EUR",
      }),
    ]);
    expect(out.get("a")).toBeNull();
    expect(out.get("b")).toBeNull();
  });

  it("refuses a non-positive total", () => {
    const out = ownerSharePercents([
      rec({
        key: "a",
        nameNormalized: "А",
        shareAmount: 0,
        shareCurrency: "EUR",
      }),
      rec({
        key: "b",
        nameNormalized: "Б",
        shareAmount: 0,
        shareCurrency: "EUR",
      }),
    ]);
    expect(out.get("a")).toBeNull();
    expect(out.get("b")).toBeNull();
  });
});

describe("ownerSharePercents — shape", () => {
  it("returns an entry for every record passed in", () => {
    const recs = [
      rec({
        key: "a",
        nameNormalized: "А",
        shareAmount: 50,
        shareCurrency: "EUR",
      }),
      rec({ key: "m", nameNormalized: "М", role: "manager" }),
    ];
    const out = ownerSharePercents(recs);
    for (const r of recs) expect(out.has(r.key)).toBe(true);
  });

  it("handles a company with no owner records at all", () => {
    const out = ownerSharePercents([rec({ key: "m", role: "manager" })]);
    expect(out.get("m")).toBeNull();
  });

  it("published shares sum to 100 for an ordinary company", () => {
    const out = ownerSharePercents([
      rec({
        key: "a",
        nameNormalized: "А",
        shareAmount: 1,
        shareCurrency: "EUR",
      }),
      rec({
        key: "b",
        nameNormalized: "Б",
        shareAmount: 1,
        shareCurrency: "EUR",
      }),
      rec({
        key: "c",
        nameNormalized: "В",
        shareAmount: 1,
        shareCurrency: "EUR",
      }),
    ]);
    const total = ["a", "b", "c"].reduce((s, k) => s + (out.get(k) ?? 0), 0);
    // Three equal owners are 33.3333 × 3 = 99.9999 — the rounding residue the SQL
    // side documents. Assert the tolerance, never equality.
    expect(Math.abs(total - 100)).toBeLessThan(0.01);
  });
});

describe("ownerSharePercents — the deleted-fact placeholder", () => {
  it("does not count „Заличено обстоятелство." + '"' + " as an owner", () => {
    // The register's deleted-fact marker, not a person: 4,356 owner rows carry it and
    // not one has an amount. Counted, it makes a two-owner company out of a one-owner
    // one and refuses 4,299 lone sole owners their correct 100%.
    const out = ownerSharePercents([
      rec({
        key: "s",
        nameNormalized: "С",
        role: "sole_owner",
        shareAmount: null,
      }),
      rec({
        key: "x",
        name: "Заличено обстоятелство.",
        nameNormalized: "ЗАЛИЧЕНО ОБСТОЯТЕЛСТВО.",
        role: "partner",
        shareAmount: null,
      }),
    ]);
    expect(out.get("s")).toBe(100);
    expect(out.get("x")).toBeNull();
  });

  it("still refuses when a REAL second owner sits beside the sole owner", () => {
    const out = ownerSharePercents([
      rec({
        key: "s",
        nameNormalized: "С",
        role: "sole_owner",
        shareAmount: null,
      }),
      rec({
        key: "p",
        nameNormalized: "П",
        role: "partner",
        shareAmount: 50,
        shareCurrency: "EUR",
      }),
    ]);
    expect(out.get("s")).toBeNull();
    expect(out.get("p")).toBeNull();
  });
});

describe("ownerSharePercents — a nameless record", () => {
  it("does not count a blank-named row as an owner", () => {
    // load_tr_pg loads `WHERE name <> ''`, so Postgres never sees these — but the
    // SQLite corpus does, and the CR projection emits them. Counting one made a
    // two-owner company out of a one-owner one and refused three lone sole owners
    // their correct 100%.
    const out = ownerSharePercents([
      rec({
        key: "s",
        name: "НИКОЛАЙ СТОИЛОВ МИХАЙЛОВ",
        nameNormalized: "НИКОЛАЙ СТОИЛОВ МИХАЙЛОВ",
        role: "sole_owner",
        shareAmount: null,
      }),
      rec({
        key: "blank",
        name: "",
        nameNormalized: "",
        role: "partner",
        shareAmount: null,
      }),
    ]);
    expect(out.get("s")).toBe(100);
    expect(out.get("blank")).toBeNull();
  });

  it("treats a whitespace-only name the same way", () => {
    const out = ownerSharePercents([
      rec({ key: "s", name: "С", nameNormalized: "С", role: "sole_owner" }),
      rec({ key: "ws", name: "   ", nameNormalized: "   ", role: "partner" }),
    ]);
    expect(out.get("s")).toBe(100);
  });
});
