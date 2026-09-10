import { describe, expect, it } from "vitest";
import { gateSharesEitherDirection } from "./evidence_gate";
import { extractCandidateSharesBySentenceRule } from "./candidate_name_rule";

describe("extractCandidateSharesBySentenceRule", () => {
  it("extracts a forward 'Name с X%' claim", () => {
    const text = "Цецка Цачева с 27,3% от заявилите, че ще гласуват.";
    const claims = extractCandidateSharesBySentenceRule(text);
    expect(claims).toEqual([
      {
        label: "Цецка Цачева",
        value: 27.3,
        quote: text.slice(0, text.length - 1),
      },
    ]);
  });

  it("extracts a comma-separated list of 'Name (X%)' rows", () => {
    const text =
      "Следват Красимир Каракачанов (12,1%), Ивайло Калфин (6,7%) и Веселин Марешки (6,3%).";
    const claims = extractCandidateSharesBySentenceRule(text);
    expect(claims.map((c) => [c.label, c.value])).toEqual([
      ["Красимир Каракачанов", 12.1],
      ["Ивайло Калфин", 6.7],
      ["Веселин Марешки", 6.3],
    ]);
  });

  it("falls back to a BACKWARD window when the forward one is empty (value stated before the name)", () => {
    const text =
      "Цецка Цачева с 27,3%. След нея с 24% се нарежда подкрепеният от БСП претендент Румен Радев.";
    const claims = extractCandidateSharesBySentenceRule(text);
    const radev = claims.find((c) => c.label === "Румен Радев");
    expect(radev?.value).toBe(24);
    // The quote is a verbatim slice bounded to Radev's OWN sentence — it
    // must not reach back into Цачева's sentence/number.
    expect(radev?.quote).not.toContain("27,3");
    expect(radev?.quote).toContain("24%");
  });

  it("never lets a backward window cross into the PREVIOUS label's own sentence", () => {
    const text =
      "Цецка Цачева с 27,3% от заявилите. Пламен Орешарски беше упоменат, но нищо не се каза за неговия резултат.";
    const claims = extractCandidateSharesBySentenceRule(text);
    // Орешарски has no percentage anywhere near it (forward window empty,
    // backward window would otherwise reach into Цачева's own 27,3% two
    // sentences back) — must produce NO claim, not a wrong one borrowed
    // from the previous candidate.
    expect(claims.find((c) => c.label === "Пламен Орешарски")).toBeUndefined();
  });

  it("never lets a backward window duplicate the PRECEDING label's own forward-consumed number, even within the SAME sentence", () => {
    // Real defect found in review: Radev's forward claim (46.8%) and
    // Gerdzhikov's empty forward window sit in ONE sentence with no
    // period between them — a naive backward scan bounded only by
    // Radev's NAME end (not by where his 46.8% itself ends) re-reads the
    // same number and duplicates it onto Gerdzhikov. Phrasing built
    // directly from this rule's own real 2021 caller ("следвана от").
    const text =
      "Румен Радев води с 46.8%, следван на далечно разстояние от Анастас Герджиков, който не успя да мобилизира допълнителна подкрепа.";
    const claims = extractCandidateSharesBySentenceRule(text);
    const radev = claims.find((c) => c.label === "Румен Радев");
    const gerdzhikov = claims.find((c) => c.label === "Анастас Герджиков");
    expect(radev?.value).toBe(46.8);
    // Герджиков has no percentage of his OWN anywhere near him — this
    // must be a refusal (no claim), never a duplicate of Radev's number.
    expect(gerdzhikov).toBeUndefined();
  });

  it("consumes a hyphen-joined ticket pair as ONE match, returning only the president half as the label", () => {
    const text =
      "Двойката Румен Радев-Илияна Йотова заема лидерската позиция в подреждането с 46.8%, следвана от Анастас Герджиков-Невяна Митева с 24.4% от гласуващите.";
    const claims = extractCandidateSharesBySentenceRule(text);
    expect(claims.map((c) => [c.label, c.value])).toEqual([
      ["Румен Радев", 46.8],
      ["Анастас Герджиков", 24.4],
    ]);
    // The VP half must never appear as its own, independent claim.
    expect(claims.some((c) => c.label.includes("Йотова"))).toBe(false);
    expect(claims.some((c) => c.label.includes("Митева"))).toBe(false);
  });

  it("excludes a narrator word ('Следват'/'Двойката') from the label rather than absorbing it", () => {
    const text = "Следват Костадин Костадинов-Елена Гунчева с 3.1%, ";
    const claims = extractCandidateSharesBySentenceRule(text);
    expect(claims).toEqual([
      {
        label: "Костадин Костадинов",
        value: 3.1,
        quote: "Костадин Костадинов-Елена Гунчева с 3.1%, ",
      },
    ]);
  });

  it("matches the fixed abstention phrase and folds a capitalized, sentence-initial spelling too", () => {
    const text1 = "Опцията „не подкрепям никого“ е с дял от 7,1%.";
    expect(
      extractCandidateSharesBySentenceRule(text1).map((c) => [
        c.label,
        c.value,
      ]),
    ).toEqual([["не подкрепям никого", 7.1]]);

    const text2 = "Не подкрепям никого се отбелязва с 5%.";
    expect(
      extractCandidateSharesBySentenceRule(text2).map((c) => [
        c.label,
        c.value,
      ]),
    ).toEqual([["Не подкрепям никого", 5]]);
  });

  it("refuses (no claim) when the forward window carries more than one percentage", () => {
    const text = "Цецка Цачева от 22% на 20,4% пада в новото проучване.";
    expect(extractCandidateSharesBySentenceRule(text)).toEqual([]);
  });

  it("refuses (no claim) when BOTH windows are empty", () => {
    const text = "Цецка Цачева не коментира резултата от проучването.";
    expect(extractCandidateSharesBySentenceRule(text)).toEqual([]);
  });

  it("produces claims that pass gateSharesEitherDirection against the same source text", () => {
    const text =
      "Цецка Цачева с 27,3% от заявилите, че ще гласуват. След нея с 24% се нарежда подкрепеният от БСП претендент Румен Радев.";
    const claims = extractCandidateSharesBySentenceRule(text);
    const gated = gateSharesEitherDirection(claims, text);
    expect(gated.refused).toEqual([]);
    expect(gated.accepted.map((c) => [c.label, c.value])).toEqual([
      ["Цецка Цачева", 27.3],
      ["Румен Радев", 24],
    ]);
  });
});
