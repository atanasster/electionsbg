import { describe, expect, it } from "vitest";
import type { PresidentialPollDetail } from "./pollsTypes";
import { isNamedCandidateRow } from "./presidentialRow";

const row = (
  over: Partial<PresidentialPollDetail>,
): PresidentialPollDetail => ({
  pollId: "gm-2026-07-11",
  agencyId: "GM",
  candidateKey: "provisional:илияна-йотова",
  candidateName_bg: "Илияна Йотова",
  candidateName_en: "Iliana Yotova",
  nominator: null,
  placeholderFor: null,
  support: 30,
  ...over,
});

describe("isNamedCandidateRow", () => {
  it("is true for a real or provisional candidate row", () => {
    expect(isNamedCandidateRow(row({}))).toBe(true);
    expect(isNamedCandidateRow(row({ candidateKey: "radev-rumen" }))).toBe(
      true,
    );
  });

  it("is false for the 'none' (Не подкрепям никого) row", () => {
    expect(
      isNamedCandidateRow(
        row({ candidateKey: "none", candidateName_bg: "Не подкрепям никого" }),
      ),
    ).toBe(false);
  });

  it("is false for a placeholder row (no nominee yet)", () => {
    expect(
      isNamedCandidateRow(
        row({
          candidateKey: "placeholder:прб",
          candidateName_bg: "Прогресивна България",
          placeholderFor: "ПрБ",
        }),
      ),
    ).toBe(false);
  });
});
