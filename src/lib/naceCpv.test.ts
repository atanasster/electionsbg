import { describe, it, expect } from "vitest";
import {
  naceCpvMismatch,
  UNIVERSAL_CPV,
  NACE_CPV_ALLOW,
  naceCpvAllowRows,
  naceCpvOpinionDivisions,
  naceCpvUniversalDivisions,
} from "./naceCpv";

describe("naceCpvMismatch — the conservative signal", () => {
  it("MATCH: a construction firm (42, civil eng) winning road/construction work (45)", () => {
    expect(naceCpvMismatch("42", "45")).toBe("match");
    expect(naceCpvMismatch("41", "45")).toBe("match"); // building construction
  });

  it("MATCH: a health firm (86) winning medical equipment (33) or health services (85)", () => {
    expect(naceCpvMismatch("86", "33")).toBe("match");
    expect(naceCpvMismatch("86", "85")).toBe("match");
  });

  it("MATCH: an IT firm (62) winning software (48) / IT services (72)", () => {
    expect(naceCpvMismatch("62", "48")).toBe("match");
    expect(naceCpvMismatch("62", "72")).toBe("match");
  });

  it("MISMATCH: a retail firm (47) winning construction work (45) — the headline case", () => {
    expect(naceCpvMismatch("47", "45")).toBe("mismatch");
  });

  it("MISMATCH: a restaurant (56) winning medical equipment (33)", () => {
    expect(naceCpvMismatch("56", "33")).toBe("mismatch");
  });

  it("MATCH: any NACE winning a UNIVERSAL cross-cutting CPV (office supplies, consulting)", () => {
    // A construction firm winning office supplies (30) or a bakery winning
    // consulting (79) must NEVER be flagged.
    expect(naceCpvMismatch("42", "30")).toBe("match");
    expect(naceCpvMismatch("10", "79")).toBe("match");
    for (const u of UNIVERSAL_CPV)
      expect(naceCpvMismatch("47", u)).toBe("match");
  });

  it("UNAVAILABLE: missing NACE or missing CPV", () => {
    expect(naceCpvMismatch(null, "45")).toBe("unavailable");
    expect(naceCpvMismatch("42", null)).toBe("unavailable");
    expect(naceCpvMismatch(undefined, undefined)).toBe("unavailable");
    expect(naceCpvMismatch("", "45")).toBe("unavailable");
  });

  it("UNAVAILABLE: an unmapped NACE division never manufactures a mismatch", () => {
    // "99" is not in the table — we have no opinion, so it's unavailable, not a flag.
    expect(naceCpvMismatch("99", "45")).toBe("unavailable");
  });

  it("UNAVAILABLE: a prototype-name key can't crash or return a stray verdict", () => {
    // Object.hasOwn guard — "constructor"/"__proto__" must read as no-opinion, not throw.
    expect(naceCpvMismatch("constructor", "45")).toBe("unavailable");
    expect(naceCpvMismatch("__proto__", "45")).toBe("unavailable");
  });

  it("MISMATCH: an opinionated EMPTY-LIST NACE fires on any non-universal CPV", () => {
    // The empty-list branch — a firm whose only legit output is universal (finance,
    // legal, printing) winning a specialised productive contract IS the signal.
    expect(naceCpvMismatch("69", "45")).toBe("mismatch"); // law firm → construction
    expect(naceCpvMismatch("18", "33")).toBe("mismatch"); // printer → medical
    expect(naceCpvMismatch("82", "45")).toBe("mismatch"); // office admin → construction
  });

  it("MATCH: an opinionated empty-list NACE still matches a universal CPV", () => {
    expect(naceCpvMismatch("69", "79")).toBe("match"); // law firm → business svcs
    expect(naceCpvMismatch("66", "66")).toBe("match"); // finance → finance
  });

  it("distinguishes absent (unavailable) from empty (opinionated)", () => {
    expect("12" in NACE_CPV_ALLOW).toBe(false); // tobacco — no opinion
    expect(naceCpvMismatch("12", "45")).toBe("unavailable");
    expect(NACE_CPV_ALLOW["69"]).toEqual([]); // legal — opinionated, empty
    expect(naceCpvMismatch("69", "45")).toBe("mismatch");
  });

  it("widened lists no longer over-flag common legitimate winners", () => {
    expect(naceCpvMismatch("46", "48")).toBe("match"); // IT wholesaler → software
    expect(naceCpvMismatch("46", "42")).toBe("match"); // equipment wholesaler → machinery
    expect(naceCpvMismatch("85", "73")).toBe("match"); // university → R&D
    expect(naceCpvMismatch("77", "43")).toBe("match"); // plant hire → construction machinery
    expect(naceCpvMismatch("20", "44")).toBe("match"); // paint maker → paints (materials)
  });

  it("wholesale (46) is broad — matches most goods, so rarely flagged", () => {
    for (const cpv of ["15", "30", "31", "33", "44"])
      expect(naceCpvMismatch("46", cpv)).toBe("match");
  });
});

describe("crosswalk artifact integrity", () => {
  it("no per-NACE list redundantly repeats a UNIVERSAL division", () => {
    // Keeps the two halves disjoint: universals are applied globally, not per-NACE.
    for (const [nace, cpvs] of Object.entries(NACE_CPV_ALLOW))
      for (const cpv of cpvs)
        expect(
          UNIVERSAL_CPV.has(cpv),
          `${nace}→${cpv} duplicates a universal`,
        ).toBe(false);
  });

  it("every mapped CPV division is a real 2-digit division present in cpvSectors", async () => {
    const { CPV_DIVISION } = await import("./cpvSectors");
    const known = new Set(Object.keys(CPV_DIVISION));
    for (const [nace, cpvs] of Object.entries(NACE_CPV_ALLOW))
      for (const cpv of cpvs)
        expect(
          known.has(cpv),
          `${nace}→${cpv} is not a known CPV division`,
        ).toBe(true);
    for (const u of UNIVERSAL_CPV)
      expect(known.has(u), `universal ${u} is not a known CPV division`).toBe(
        true,
      );
  });

  it("every NACE key and CPV value is a 2-digit code", () => {
    for (const [nace, cpvs] of Object.entries(NACE_CPV_ALLOW)) {
      expect(nace).toMatch(/^\d{2}$/);
      for (const cpv of cpvs) expect(cpv).toMatch(/^\d{2}$/);
    }
  });

  it("naceCpvUniversalDivisions serializes the universal set for the PG seed", () => {
    // SQL 112 reads this from a loader-seeded table; it MUST equal UNIVERSAL_CPV
    // exactly, or the SQL fired-test diverges from the TS scorer and parity breaks.
    expect(new Set(naceCpvUniversalDivisions())).toEqual(UNIVERSAL_CPV);
    expect(naceCpvUniversalDivisions().every((d) => /^\d{2}$/.test(d))).toBe(
      true,
    );
  });

  it("naceCpvAllowRows flattens to (nace,cpv) pairs excluding universals", () => {
    const rows = naceCpvAllowRows();
    expect(rows.length).toBeGreaterThan(80);
    expect(rows.every(([n, c]) => /^\d{2}$/.test(n) && /^\d{2}$/.test(c))).toBe(
      true,
    );
    expect(rows.some(([, c]) => UNIVERSAL_CPV.has(c))).toBe(false);
  });

  it("opinion-set + rows + universals reconstruct naceCpvMismatch (the PG parity model)", () => {
    // This is exactly what SQL 112 will do: opinion = nace ∈ opinion-set (NOT ≥1 row),
    // then universal-or-listed = match, else mismatch. If this drifts from
    // naceCpvMismatch, the TS chip and the SQL cache would disagree (FINDING-001).
    const rowSet = new Set(naceCpvAllowRows().map(([n, c]) => `${n}:${c}`));
    const opinion = new Set(naceCpvOpinionDivisions());
    const reconstruct = (n: string, c: string) =>
      !opinion.has(n)
        ? "unavailable"
        : UNIVERSAL_CPV.has(c) || rowSet.has(`${n}:${c}`)
          ? "match"
          : "mismatch";
    const naces = [...opinion, "99"]; // incl. an unmapped one
    for (const n of naces)
      for (const c of ["45", "33", "48", "79", "30", "92", "60"])
        expect(reconstruct(n, c), `${n}→${c}`).toBe(naceCpvMismatch(n, c));
  });
});
