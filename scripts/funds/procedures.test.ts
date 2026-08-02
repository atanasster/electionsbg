import { describe, it, expect } from "vitest";
import {
  procedureCodeOf,
  buildProcedures,
  writeProcedures,
  MIN_INDEXABLE_CONTRACTS,
} from "./procedures";
import type { ProcedureAttributable } from "./projects_types";

const contract = (
  over: Partial<ProcedureAttributable> & { contractNumber: string },
): ProcedureAttributable => ({
  title: "Проект",
  status: "Приключен (към датата на приключване)",
  programCode: "2014BG16RFOP002",
  programName: "Иновации и конкурентоспособност",
  beneficiaryEik: "123456789",
  beneficiaryName: "Фирма ЕООД",
  orgType: "Компания",
  totalEur: 100,
  grantEur: 80,
  paidEur: 60,
  locationRaw: "гр.София",
  location: { munis: ["S22"], oblasts: ["S22"] },
  ...over,
});

describe("procedureCodeOf", () => {
  it("strips the project ordinal and the contract suffix", () => {
    expect(procedureCodeOf("BG16RFOP002-2.089-3686-C01")).toBe(
      "BG16RFOP002-2.089",
    );
    expect(procedureCodeOf("BG16RFOP002-2.089-3686")).toBe("BG16RFOP002-2.089");
    expect(procedureCodeOf("BG-RRP-1.015-0042")).toBe("BG-RRP-1.015");
  });

  it("accepts ordinals longer than four digits", () => {
    // BG16RFOP002-2.073 ran past 9,999 projects. A strict \d{4} dropped 14,510
    // rows — 17.7% of the corpus — almost all of them from this one procedure.
    expect(procedureCodeOf("BG16RFOP002-2.073-19464")).toBe(
      "BG16RFOP002-2.073",
    );
    expect(procedureCodeOf("BG16RFOP002-2.073-10000")).toBe(
      "BG16RFOP002-2.073",
    );
  });

  it("does not split a procedure code that itself ends in digits", () => {
    // The lazy prefix can only cut at a `-`, so `2.073` survives intact.
    expect(procedureCodeOf("BG16RFOP002-2.073-0001")).toBe("BG16RFOP002-2.073");
  });

  it("strips a trailing co-financing programme suffix", () => {
    expect(
      procedureCodeOf(
        "BG05M9OP001-2.018-0024-2014BG05M2OP001",
        "2014BG05M2OP001",
      ),
    ).toBe("BG05M9OP001-2.018");
    // Without the programme code there is nothing to key the strip on, so the
    // row is dropped rather than mis-grouped.
    expect(
      procedureCodeOf("BG05M9OP001-2.018-0024-2014BG05M2OP001"),
    ).toBeNull();
  });

  it("returns null when there is no project ordinal to strip", () => {
    // Without the ordinal there is no procedure/project boundary to find, so
    // inventing one would group unrelated rows.
    expect(procedureCodeOf("BG16RFOP002")).toBeNull();
    expect(procedureCodeOf("")).toBeNull();
    expect(procedureCodeOf("BG16RFOP002-2.089-36")).toBeNull();
  });

  it("rejects codes that would escape a filename or URL segment", () => {
    expect(procedureCodeOf("../../etc/passwd-0001")).toBeNull();
    expect(procedureCodeOf("проект-0001")).toBeNull();
  });

  it("normalises the stray space ИСУН publishes in BGJUSTICE codes", () => {
    // 17 real contracts ship as `BGJUSTICE -1.001-0001`. Dropping them on the
    // charset check would lose contracts to an export typo.
    expect(procedureCodeOf("BGJUSTICE -1.001-0001")).toBe("BGJUSTICE-1.001");
  });

  it("tolerates surrounding whitespace", () => {
    expect(procedureCodeOf("  BG-RRP-1.015-0042  ")).toBe("BG-RRP-1.015");
  });
});

describe("buildProcedures", () => {
  const at = "2026-08-02T00:00:00.000Z";
  // Injected so the tests never read data/settlements.json.
  const oblasts = new Map([
    ["S22", "S22"],
    ["SZR31", "SZR"],
    ["VRC10", "VRC"],
    ["BGS01", "BGS"],
  ]);
  const build = (rows: ProcedureAttributable[]) =>
    buildProcedures(rows, at, oblasts);

  it("groups contracts by procedure and rolls up money and beneficiaries", () => {
    const { shards } = build([
      contract({ contractNumber: "BG16RFOP002-2.089-0001", totalEur: 300 }),
      contract({
        contractNumber: "BG16RFOP002-2.089-0002",
        totalEur: 200,
        beneficiaryEik: "987654321",
        beneficiaryName: "Друга ЕООД",
      }),
      contract({ contractNumber: "BG16RFOP002-2.073-0001", totalEur: 50 }),
    ]);

    expect(shards.map((s) => s.procedureCode)).toEqual([
      "BG16RFOP002-2.073",
      "BG16RFOP002-2.089",
    ]);
    const p089 = shards.find((s) => s.procedureCode === "BG16RFOP002-2.089")!;
    expect(p089.rollup.contractCount).toBe(2);
    expect(p089.rollup.beneficiaryCount).toBe(2);
    expect(p089.rollup.totalEur).toBe(500);
    expect(p089.programCode).toBe("2014BG16RFOP002");
    // Sorted by value, largest first.
    expect(p089.topContracts[0].contractNumber).toBe("BG16RFOP002-2.089-0001");
  });

  it("counts one beneficiary across that beneficiary's several contracts", () => {
    const { shards } = build([
      contract({ contractNumber: "BG-RRP-1.015-0001" }),
      contract({ contractNumber: "BG-RRP-1.015-0002" }),
    ]);
    expect(shards[0].rollup.contractCount).toBe(2);
    expect(shards[0].rollup.beneficiaryCount).toBe(1);
    expect(shards[0].topBeneficiaries).toHaveLength(1);
    expect(shards[0].topBeneficiaries[0].contractCount).toBe(2);
  });

  it("names the procedure when its contracts overwhelmingly share a title", () => {
    const scheme = "Подкрепа за малки предприятия";
    const { shards } = build(
      Array.from({ length: 10 }, (_, i) =>
        contract({
          contractNumber: `BG16RFOP002-2.089-000${i}`,
          title: scheme,
        }),
      ),
    );
    expect(shards[0].procedureName).toBe(scheme);
  });

  it("leaves the name null when titles are per-project", () => {
    const { shards } = build(
      Array.from({ length: 10 }, (_, i) =>
        contract({
          contractNumber: `BG06RDNP001-6.007-000${i}`,
          title: `Стопанство №${i}`,
        }),
      ),
    );
    expect(shards[0].procedureName).toBeNull();
  });

  it("indexes only procedures at or above the contract floor", () => {
    const rows = [
      ...Array.from({ length: MIN_INDEXABLE_CONTRACTS }, (_, i) =>
        contract({ contractNumber: `BG16RFOP002-2.089-000${i}` }),
      ),
      contract({ contractNumber: "BG16RFOP002-2.999-0001" }),
    ];
    const { index, shards } = build(rows);
    // A shard for every procedure so the SPA route resolves …
    expect(shards).toHaveLength(2);
    // … but only the one above the floor gets a page.
    expect(index.procedures.map((p) => p.procedureCode)).toEqual([
      "BG16RFOP002-2.089",
    ]);
    expect(index.procedureCount).toBe(2);
    expect(index.minIndexableContracts).toBe(MIN_INDEXABLE_CONTRACTS);
  });

  it("splits multi-муни money rather than replicating it", () => {
    // Same rule as the choropleth: attributing the full value to each named
    // муни would invent money.
    const { shards } = build([
      contract({
        contractNumber: "BG-RRP-1.015-0001",
        totalEur: 100,
        paidEur: 40,
        location: { munis: ["S22", "BGS01"], oblasts: ["S22"] },
      }),
    ]);
    const munis = shards[0].topMunis;
    expect(munis).toHaveLength(2);
    expect(munis.map((m) => m.totalEur)).toEqual([50, 50]);
    // Counts are never shared — it is one contract wherever it lands.
    expect(munis.map((m) => m.contractCount)).toEqual([1, 1]);
    // The procedure rollup keeps the contract's full value.
    expect(shards[0].rollup.totalEur).toBe(100);
  });

  it("skips rows whose number carries no procedure", () => {
    const { shards, index } = build([
      contract({ contractNumber: "NOPROCEDURE" }),
    ]);
    expect(shards).toHaveLength(0);
    expect(index.procedures).toHaveLength(0);
  });

  it("buckets raw ИСУН statuses into the four dashboard groups", () => {
    const { shards } = build([
      contract({
        contractNumber: "BG-RRP-1.015-0001",
        status: "Приключен (към датата на приключване)",
      }),
      contract({
        contractNumber: "BG-RRP-1.015-0002",
        status: "В изпълнение (от дата на стартиране)",
      }),
      contract({ contractNumber: "BG-RRP-1.015-0003", status: "Сключен" }),
      contract({
        contractNumber: "BG-RRP-1.015-0004",
        status: "Прекратен (към дата на прекратяване)",
      }),
    ]);
    expect(new Set(shards[0].statusBreakdown.map((s) => s.status))).toEqual(
      new Set(["completed", "in-progress", "signed", "terminated"]),
    );
  });

  it("is deterministic regardless of input order", () => {
    const rows = [
      contract({ contractNumber: "BG-RRP-1.015-0001", totalEur: 10 }),
      contract({ contractNumber: "BG-RRP-1.015-0002", totalEur: 10 }),
      contract({ contractNumber: "BG16RFOP002-2.089-0001", totalEur: 10 }),
    ];
    const a = build(rows);
    const b = build([...rows].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never labels a муни with another муни's oblast", () => {
    // The oblast belongs to the муни, not to the contract. Reading
    // `location.oblasts[0]` put Стара Загора in Враца on 311 published rows.
    const { shards } = build([
      contract({
        contractNumber: "BG-RRP-1.024-0001",
        location: { munis: ["SZR31", "VRC10"], oblasts: ["VRC", "SZR"] },
      }),
    ]);
    const byMuni = new Map(shards[0].topMunis.map((m) => [m.muni, m.oblast]));
    expect(byMuni.get("SZR31")).toBe("SZR");
    expect(byMuni.get("VRC10")).toBe("VRC");
  });

  it("leaves the oblast null for a муни the dictionary does not know", () => {
    const { shards } = build([
      contract({
        contractNumber: "BG-RRP-1.024-0002",
        location: { munis: ["ZZZ99"], oblasts: ["VRC"] },
      }),
    ]);
    // A null oblast renders as unknown; a wrong one renders as a fact.
    expect(shards[0].topMunis[0].oblast).toBeNull();
  });

  it("attributes a co-financed procedure to its majority programme", () => {
    // BG05M9OP001-2.018 publishes as two complementary legs. Keying the parent
    // on the largest single contract made the label depend on which leg held
    // the biggest row — right by luck, and silently reparented by a €1 change.
    const { shards } = build([
      contract({ contractNumber: "BG05M9OP001-2.018-0001", totalEur: 100 }),
      contract({ contractNumber: "BG05M9OP001-2.018-0002", totalEur: 100 }),
      contract({
        contractNumber: "BG05M9OP001-2.018-0001-2014BG05M2OP001",
        programCode: "2014BG05M2OP001",
        programName: "Наука и образование за интелигентен растеж",
        totalEur: 500,
      }),
    ]);
    expect(shards[0].rollup.contractCount).toBe(3);
    expect(shards[0].programCode).toBe("2014BG16RFOP002");
    expect(shards[0].programName).toBe("Иновации и конкурентоспособност");
  });

  it("keys unlinked beneficiaries by name, not by a shared null EIK", () => {
    const twoNames = build([
      contract({
        contractNumber: "BG-RRP-1.015-0001",
        beneficiaryEik: null,
        beneficiaryName: "Първа",
      }),
      contract({
        contractNumber: "BG-RRP-1.015-0002",
        beneficiaryEik: null,
        beneficiaryName: "Втора",
      }),
    ]);
    expect(twoNames.shards[0].rollup.beneficiaryCount).toBe(2);
    expect(twoNames.shards[0].topBeneficiaries).toHaveLength(2);

    const oneName = build([
      contract({
        contractNumber: "BG-RRP-1.015-0001",
        beneficiaryEik: null,
        beneficiaryName: "Първа",
      }),
      contract({
        contractNumber: "BG-RRP-1.015-0002",
        beneficiaryEik: null,
        beneficiaryName: "Първа",
      }),
    ]);
    expect(oneName.shards[0].rollup.beneficiaryCount).toBe(1);
    expect(oneName.shards[0].topBeneficiaries[0].contractCount).toBe(2);
  });

  it("caps the emitted lists at TOP_BENEFICIARIES / TOP_CONTRACTS", () => {
    // The prerendered beneficiary table is T1's whole SEO thesis; a regression
    // to a smaller slice would gut it while every other assertion still passed.
    const { shards } = build(
      Array.from({ length: 120 }, (_, i) =>
        contract({
          contractNumber: `BG16RFOP002-2.089-${String(i).padStart(4, "0")}`,
          beneficiaryEik: String(100000000 + i),
          beneficiaryName: `Фирма ${i}`,
          totalEur: 1000 - i,
        }),
      ),
    );
    expect(shards[0].rollup.beneficiaryCount).toBe(120);
    expect(shards[0].topBeneficiaries).toHaveLength(100);
    expect(shards[0].topBeneficiaries[0].beneficiaryName).toBe("Фирма 0");
    expect(shards[0].topContracts).toHaveLength(25);
  });

  it("accounts for every input row exactly once", () => {
    // The invariant the strict-\d{4} ordinal broke: 14,510 rows vanished with
    // nothing failing, and the plan's counts were then measured under it.
    const rows = [
      contract({ contractNumber: "BG16RFOP002-2.089-3686-C01" }),
      contract({ contractNumber: "BG16RFOP002-2.073-19464" }),
      contract({ contractNumber: "BGJUSTICE -1.001-0001" }),
      contract({
        contractNumber: "BG05M9OP001-2.018-0024-2014BG05M2OP001",
        programCode: "2014BG05M2OP001",
      }),
      contract({ contractNumber: "BG-RRP-1.015-0042" }),
    ];
    const { shards } = build(rows);
    expect(shards.reduce((n, s) => n + s.rollup.contractCount, 0)).toBe(
      rows.length,
    );
  });
});

describe("writeProcedures", () => {
  const at = "2026-08-02T00:00:00.000Z";
  const oblasts = new Map([["S22", "S22"]]);

  // Neither case occurs in the corpus today. Both would silently destroy a
  // shard on write, so they fail loudly instead.
  it("refuses a procedure code that collides with the catalogue file", () => {
    const data = buildProcedures(
      [contract({ contractNumber: "index-0001" })],
      at,
      oblasts,
    );
    expect(data.shards[0].procedureCode).toBe("index");
    expect(() => writeProcedures(data)).toThrow(/collides with the catalogue/);
  });

  it("refuses two codes that collide on a case-insensitive filesystem", () => {
    const data = buildProcedures(
      [
        contract({ contractNumber: "BG-RRP-1.015-0001" }),
        contract({ contractNumber: "bg-rrp-1.015-0002" }),
      ],
      at,
      oblasts,
    );
    expect(data.shards).toHaveLength(2);
    expect(() => writeProcedures(data)).toThrow(/case-insensitive/);
  });
});
