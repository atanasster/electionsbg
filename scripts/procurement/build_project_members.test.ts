// Pure unit gate for summarize() — the money fold the AI projectLifecycle tool
// consumes (via summaries.json). No Postgres: it runs foldMembers/foldByContractor
// over a fixed CRow[] and locks in the camelCase field wiring (a regression there
// would silently zero the totals — the exact failure invariant 2 guards against)
// plus the honesty-strip self-consistency (buckets sum to the contracted total)
// and the "?" anonymous-contractor drop (FINDING-003).

import { describe, it, expect } from "vitest";
import { summarize, type CRow } from "./build_project_members";

const crow = (o: Partial<CRow> & { key: string }): CRow => ({
  tag: "contract",
  amountEur: null,
  procurementMethod: null,
  numberOfTenderers: null,
  date: null,
  contractorEik: null,
  contractorName: null,
  cpv: null,
  ...o,
});

describe("summarize()", () => {
  const rows: CRow[] = [
    // competitive
    crow({
      key: "a",
      amountEur: 200,
      procurementMethod: "открита процедура",
      contractorEik: "111",
      contractorName: "Алфа",
    }),
    // non-competitive (matches "договаряне без")
    crow({
      key: "b",
      amountEur: 300,
      procurementMethod: "договаряне без предварително обявление",
      contractorEik: "111",
      contractorName: "Алфа",
    }),
    // unspecified (blank method) — its own bucket
    crow({
      key: "c",
      amountEur: 500,
      procurementMethod: null,
      contractorEik: "222",
      contractorName: "Бета",
    }),
    // anonymous — neither EIK nor name → "?" bucket, must be dropped from top list
    crow({ key: "d", amountEur: 50, procurementMethod: null }),
  ];

  const s = summarize(
    { title: { bg: "Проект", en: "Project" }, thesis: { bg: "теза" } },
    rows,
    3,
  );

  it("wires the camelCase fields into a populated fold (not zeroed)", () => {
    expect(s.contractedEur).toBe(1050);
    expect(s.contractCount).toBe(4);
    expect(s.procedureCount).toBe(3); // passed through verbatim
  });

  it("keeps the three award buckets separate and self-consistent", () => {
    expect(s.methodMix.competitive).toBe(200);
    expect(s.methodMix.nonCompetitive).toBe(300);
    expect(s.methodMix.unspecified).toBe(550); // 500 + the anonymous 50
    expect(
      s.methodMix.competitive +
        s.methodMix.nonCompetitive +
        s.methodMix.unspecified,
    ).toBe(s.contractedEur);
  });

  it("drops the anonymous '?' bucket from top contractors (FINDING-003)", () => {
    expect(s.topContractors.map((c) => c.name)).toEqual(["Алфа", "Бета"]);
    // Алфа = 200 + 300, folded across its two contracts.
    expect(s.topContractors[0]).toMatchObject({ name: "Алфа", eur: 500 });
    expect(s.topContractors.some((c) => c.name === "?")).toBe(false);
  });
});

describe("summarize() — program-total (corpus) override", () => {
  const rows: CRow[] = [
    crow({ key: "a", amountEur: 200, contractorName: "Алфа" }),
    crow({ key: "b", amountEur: 300, contractorName: "Бета" }),
  ];

  it("replaces the fold total/count with the corpus figures when provided", () => {
    // The top-N fold is €500 / 2, but a distributed program's true corpus is far
    // larger — the override reports that, keeping the fold for the breakdowns.
    const s = summarize({ title: { bg: "П" } }, rows, 1, {
      contractedEur: 975_000_000,
      contractCount: 4539,
    });
    expect(s.contractedEur).toBe(975_000_000);
    expect(s.contractCount).toBe(4539);
    // Breakdowns still come from the member fold.
    expect(s.topContractors.map((c) => c.name)).toEqual(["Бета", "Алфа"]);
  });

  it("falls back to the fold total when corpus.contractedEur is null", () => {
    const s = summarize({ title: { bg: "П" } }, rows, 1, {
      contractedEur: null,
      contractCount: null,
    });
    expect(s.contractedEur).toBe(500);
    expect(s.contractCount).toBe(2);
  });

  it("falls back to the fold count independently when only the count is null", () => {
    const s = summarize({ title: { bg: "П" } }, rows, 1, {
      contractedEur: 975_000_000,
      contractCount: null,
    });
    expect(s.contractedEur).toBe(975_000_000);
    expect(s.contractCount).toBe(2); // fold count, not the corpus null
  });

  it("uses the fold total when no corpus override is passed (default project)", () => {
    const s = summarize({ title: { bg: "П" } }, rows, 1);
    expect(s.contractedEur).toBe(500);
  });
});
