// Tests for the module its own header calls THE RISKY HALF.
//
// It shipped without any, and that was not merely an omission: the two other
// suites assert properties of the COMMITTED ARTIFACT, so a resolver rewritten to
// be maximally greedy passes every test in the repo until an operator happens to
// re-run `--apply`. Two false resolutions were live at that point.
//
// `resolveEntry` takes its candidate set as an argument precisely so it can be
// tested with no database. Everything here is synthetic and built through
// `candidateOf`, the same constructor the loader uses — a hand-rolled second
// fold is how `councilNameKey()` diverged in CLAUDE.md.

import { describe, expect, it } from "vitest";
import { candidateOf, resolveEntry, dkiNameFold } from "./resolve";
import type { DkiEntry } from "./parse";

const entry = (name: string) => ({ name }) as DkiEntry;

describe("dkiNameFold", () => {
  it("folds the spellings the corpus actually differs by", () => {
    // ь → ъ is a real award-record spelling („Държавен куклен ТЕАТЬР - ВАРНА"),
    // and one substituted letter is enough to miss an otherwise perfect hit.
    expect(dkiNameFold("Държавен куклен театьр - варна")).toBe(
      dkiNameFold("ДЪРЖАВЕН КУКЛЕН ТЕАТЪР – ВАРНА"),
    );
    expect(dkiNameFold("ТЕАТЪР „ИВАН ВАЗОВ”")).toBe(
      dkiNameFold('Театър "Иван Вазов"'),
    );
  });
});

describe("resolveEntry refuses rather than guesses", () => {
  it("does not read ЕСО as a state opera", () => {
    // MEASURED CAPTURE, 2026-08-19. `abbrevOf` was a bare prefix test, so
    // „оператор".startsWith(„опера") widened the token match and this resolved.
    // kulturaReferenceData.ts's header names this exact collision as the reason
    // that file is a hand-classified allowlist and not a name regex.
    const c = [
      candidateOf(
        "175201304",
        "Електроенергиен системен оператор ЕАД, Управление МЕР Бургас",
      ),
    ];
    expect(resolveEntry(entry("ДЪРЖАВНА ОПЕРА – БУРГАС"), c).status).toBe(
      "unmatched",
    );
  });

  it("does not read КОМДОС as Театър „Българска армия“", () => {
    // The same bare-prefix defect, via „българска" ~ „българската".
    const c = [
      candidateOf(
        "175263817",
        "Комисия за разкриване на документите и за обявяване на принадлежност " +
          "на български граждани към Държавна сигурност и разузнавателните " +
          "служби на Българската народна армия",
      ),
    ];
    expect(resolveEntry(entry("ТЕАТЪР „БЪЛГАРСКА АРМИЯ“"), c).status).toBe(
      "unmatched",
    );
  });

  it("does not read a primary school as the national art school", () => {
    // MEASURED CAPTURE with no abbreviation involved: after WEAK strips the
    // register side, the entry reduces to «person» + «town», which one-way
    // containment accepted against any body carrying both.
    const c = [
      candidateOf("000281469", "Основно училище - Панайот Пипков - гр. Ловеч"),
    ];
    expect(
      resolveEntry(
        entry("НАЦИОНАЛНО УЧИЛИЩЕ ПО ИЗКУСТВАТА „ПАНАЙОТ ПИПКОВ”"),
        c,
      ).status,
    ).toBe("unmatched");
  });

  it("does not read a maths gymnasium as a state theatre", () => {
    const c = [
      candidateOf(
        "000842660",
        'Природо-математическа гимназия /ПМГ/ "Иван Вазов" гр. Добрич',
      ),
    ];
    expect(
      resolveEntry(entry("ДЪРЖАВЕН ТЕАТЪР „ИВАН ВАЗОВ“ – ДОБРИЧ"), c).status,
    ).toBe("unmatched");
  });

  it("refuses two EIKs rather than taking the first", () => {
    const c = [
      candidateOf("000000001", "Държавен куклен театър"),
      candidateOf("000000002", "Държавен куклен театър"),
    ];
    const r = resolveEntry(entry("ДЪРЖАВЕН КУКЛЕН ТЕАТЪР"), c);
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") expect(r.candidates).toHaveLength(2);
  });

  it("names each colliding EIK once, however many spellings it has", () => {
    const c = [
      candidateOf("000000001", "Държавен куклен театър"),
      candidateOf("000000001", "ДЪРЖАВЕН КУКЛЕН ТЕАТЪР"),
      candidateOf("000000002", "Държавен куклен театър"),
    ];
    const r = resolveEntry(entry("ДЪРЖАВЕН КУКЛЕН ТЕАТЪР"), c);
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") expect(r.candidates).toHaveLength(2);
  });

  it("refuses when nothing distinctive survives the WEAK filter", () => {
    // „театър" alone would match every theatre in the country.
    expect(
      resolveEntry(entry("ДЪРЖАВЕН ТЕАТЪР"), [
        candidateOf("1", "Държавен театър Х"),
      ]).status,
    ).toBe("unmatched");
  });

  it("refuses on a single shared distinctive token", () => {
    // The ≥2 floor. „куклен" alone is shared by every puppet theatre.
    const c = [candidateOf("000000003", "Държавен куклен театър - Пловдив")];
    expect(resolveEntry(entry("КУКЛЕН ТЕАТЪР – ВАРНА"), c).status).toBe(
      "unmatched",
    );
  });
});

describe("resolveEntry still resolves what it should", () => {
  it("takes an exact fold match outright", () => {
    const c = [
      candidateOf("831154303", "Национален учебен комплекс по култура"),
    ];
    const r = resolveEntry(entry("НАЦИОНАЛЕН УЧЕБЕН КОМПЛЕКС ПО КУЛТУРА"), c);
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.basis).toBe("exact");
  });

  it("still resolves the abbreviation the rule exists for", () => {
    // „акад." ~ „академик" is the ONE real resolution that depends on abbrevOf.
    const c = [
      candidateOf(
        "000803725",
        'Национално училище по пластични изкуства и дизайн "Академик дечко Узунов"',
      ),
    ];
    expect(
      resolveEntry(
        entry(
          "НАЦИОНАЛНО УЧИЛИЩЕ ПО ПЛАСТИЧНИ ИЗКУСТВА И ДИЗАЙН „АКАД. ДЕЧКО УЗУНОВ”",
        ),
        c,
      ).status,
    ).toBe("resolved");
  });

  it("keeps BOTH containment directions", () => {
    // Measured over the 70-entry register: both = 49 resolved,
    // register-⊂-corpus only = 46, corpus-⊂-register only = 42.
    expect(
      resolveEntry(entry("ДРАМАТИЧНО-КУКЛЕН ТЕАТЪР “ИВАН ДИМОВ”- ХАСКОВО"), [
        candidateOf("126004416", 'ДРАМАТИЧНО-КУКЛЕН Театър "Иван Димов"'),
      ]).status,
    ).toBe("resolved");
    expect(
      resolveEntry(entry("КУКЛЕН ТЕАТЪР – БУРГАС"), [
        candidateOf("000044566", "Държавен куклен театър град бургас"),
      ]).status,
    ).toBe("resolved");
  });

  it("tolerates locative noise the register does not carry", () => {
    // The rInC arm must still accept „гр", „София" and „/НГДЕК/" — those are
    // noise, not another institution. This is what the OTHER_KIND guard must
    // NOT break.
    const c = [
      candidateOf(
        "000674508",
        'Национална гимназия за древни езици и култури /Нгдек/ "Константин Кирил Философ" - София',
      ),
    ];
    expect(
      resolveEntry(
        entry(
          "НАЦИОНАЛНА ГИМНАЗИЯ ЗА ДРЕВНИ ЕЗИЦИ И КУЛТУРИ „КОНСТАНТИН-КИРИЛ ФИЛОСОФ”",
        ),
        c,
      ).status,
    ).toBe("resolved");
  });

  it("picks the corpus spelling deterministically, not by row order", () => {
    // `corpusName` goes into a COMMITTED file. Taking whatever row Postgres
    // returned first churned 26 of 49 records on a no-op re-run.
    const spellings = [
      candidateOf("000153836", "Симфониета - Видин"),
      candidateOf("000153836", "СИМФОНИЕТА - ВИДИН, гр. Видин"),
    ];
    const a = resolveEntry(entry("СИМФОНИЕТА – ВИДИН"), spellings);
    const b = resolveEntry(
      entry("СИМФОНИЕТА – ВИДИН"),
      [...spellings].reverse(),
    );
    expect(a.status).toBe("resolved");
    if (a.status === "resolved" && b.status === "resolved")
      expect(a.corpusName).toBe(b.corpusName);
  });
});
