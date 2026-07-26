// Unit test for the roster reassembly in useMunicipalOfficials — the pure transform from
// flat /api/db/table rows to the MunicipalityRosterFile the tiles expect. No network, no DB.
// Plan: docs/plans/persons-pg-retirement-v1.md (Tier 1.5).

import { describe, it, expect } from "vitest";
import {
  canonicalName,
  toRosterFile,
  type MunicipalOfficialRow,
} from "./useMunicipalOfficials";

const row = (o: Partial<MunicipalOfficialRow>): MunicipalOfficialRow => ({
  officialSlug: "s",
  personSlug: null,
  name: "Иван Иванов Иванов",
  role: "councillor",
  roleRaw: null,
  obshtina: "BGS04",
  district: null,
  municipality: "Бургас",
  latestDeclarationYear: 2024,
  hasDeclaration: true,
  candidateCycle: null,
  candidatePartyName: null,
  candidatePartyCanonicalId: null,
  candidateListPos: null,
  candidatePrefVotes: null,
  candidateIsElected: null,
  candidateMpId: null,
  candidatePhotoUrl: null,
  ...o,
});

describe("canonicalName", () => {
  it("uppercases, collapses spaced hyphens, and drops the Д-Р title", () => {
    expect(canonicalName("д-р Асен Русев Генев")).toBe("АСЕН РУСЕВ ГЕНЕВ");
    expect(canonicalName("Мария  Петрова - Иванова")).toBe(
      "МАРИЯ ПЕТРОВА-ИВАНОВА",
    );
  });
});

describe("toRosterFile", () => {
  it("returns null for an empty roster", () => {
    expect(toRosterFile("BGS04", [])).toBeNull();
  });

  it("sorts in roster-display order: role priority, then name (bg)", () => {
    const roster = toRosterFile("BGS04", [
      row({ officialSlug: "c-b", name: "Борис", role: "councillor" }),
      row({ officialSlug: "may", name: "Яна", role: "mayor" }),
      row({ officialSlug: "c-a", name: "Ана", role: "councillor" }),
      row({ officialSlug: "chair", name: "Петър", role: "council_chair" }),
      row({ officialSlug: "dep", name: "Георги", role: "deputy_mayor" }),
    ]);
    expect(roster!.entries.map((e) => e.slug)).toEqual([
      "may", // mayor
      "dep", // deputy_mayor
      "chair", // council_chair
      "c-a", // councillor, Ана before Борис
      "c-b",
    ]);
  });

  it("tallies byRole across every returned row", () => {
    const roster = toRosterFile("BGS04", [
      row({ officialSlug: "m", role: "mayor" }),
      row({ officialSlug: "c1", role: "councillor" }),
      row({ officialSlug: "c2", role: "councillor" }),
      row({ officialSlug: "a", role: "chief_architect" }),
    ]);
    expect(roster!.byRole).toMatchObject({
      mayor: 1,
      councillor: 2,
      chief_architect: 1,
      deputy_mayor: 0,
      council_chair: 0,
      other: 0,
    });
  });

  it("derives normalizedName from the resolved name and years from the newest filing", () => {
    const roster = toRosterFile("BGS04", [
      row({ name: "д-р Иван Иванов Иванов", latestDeclarationYear: 2023 }),
      row({ officialSlug: "s2", latestDeclarationYear: 2024 }),
    ]);
    expect(roster!.entries[0].normalizedName).toBe("ИВАН ИВАНОВ ИВАНОВ");
    expect(roster!.years).toEqual([2024]);
  });

  it("rebuilds a full candidateLink from the candidate_* columns", () => {
    const roster = toRosterFile("BGS04", [
      row({
        role: "councillor",
        candidateCycle: "2023_10_29_mi",
        candidatePartyName: "ГЕРБ",
        candidatePartyCanonicalId: "gerb",
        candidateListPos: 3,
        candidatePrefVotes: 412,
        candidateIsElected: true,
        candidateMpId: 55,
        candidatePhotoUrl: "https://x/55.jpg",
      }),
    ]);
    expect(roster!.entries[0].candidateLink).toEqual({
      cycle: "2023_10_29_mi",
      partyName: "ГЕРБ",
      partyCanonicalId: "gerb",
      listPos: 3,
      prefVotes: 412,
      isElected: true,
      mpId: 55,
      photoUrl: "https://x/55.jpg",
    });
  });

  it("emits no candidateLink when candidate_cycle is null", () => {
    const roster = toRosterFile("BGS04", [row({ candidateCycle: null })]);
    expect(roster!.entries[0].candidateLink).toBeUndefined();
  });

  it("keeps an MP-only link (empty party, synthetic listPos 0, photo)", () => {
    const roster = toRosterFile("BGS04", [
      row({
        candidateCycle: "2023_10_29_mi",
        candidatePartyName: "",
        candidatePartyCanonicalId: null,
        candidateListPos: 0,
        candidatePrefVotes: 0,
        candidateIsElected: false,
        candidateMpId: 99,
        candidatePhotoUrl: "https://x/99.jpg",
      }),
    ]);
    expect(roster!.entries[0].candidateLink).toEqual({
      cycle: "2023_10_29_mi",
      partyName: "",
      partyCanonicalId: null,
      listPos: 0,
      prefVotes: 0,
      isElected: false,
      mpId: 99,
      photoUrl: "https://x/99.jpg",
    });
  });

  it("carries district only when present, and coerces a null filing year to 0", () => {
    const roster = toRosterFile("PDV22", [
      row({ officialSlug: "d", district: "Район Централен" }),
      row({ officialSlug: "n", district: null, latestDeclarationYear: null }),
    ]);
    const bySlug = Object.fromEntries(roster!.entries.map((e) => [e.slug, e]));
    expect(bySlug.d.district).toBe("Район Централен");
    expect(bySlug.n.district).toBeUndefined();
    expect(bySlug.n.latestDeclarationYear).toBe(0);
  });
});
