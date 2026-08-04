import { describe, test, expect } from "vitest";
import { classifyDocName, isExtractable, pickSpec } from "./eop_doc_kind";

describe("classifyDocName", () => {
  // Real filenames from the 2026-08-03 sample (plan §2.2) — kept verbatim, including
  // the buyer's own typos ("служеби"), because those are what the classifier meets.
  test.each([
    ["Приложение_1_Техническа спецификация_Хранителни стоки за служеби офиси_2026.pdf", "spec"],
    ["Част II -Техническа спецификация автомобил.docx", "spec"],
    ["ТЕХНИЧЕСКИ СПЕЦИФИКАЦИИ.docx", "spec"],
    ["Техническа спецификация за STEM - 30062025.doc", "spec"],
    ["Приложение_2_Методика за оценка_Хранителни стоки за служебни офиси_2026.pdf", "methodology"],
    ["Приложение_5.1_Договор_ОП1_храни_2026.pdf", "contract_draft"],
    ["ПРОЕКТ -Договор охрана.docx", "contract_draft"],
    ["Документация_Хранителни стоки за служебни офиси_2026.pdf", "documentation"],
    ["Част I- Указания за участие автомобил.docx", "documentation"],
    ["ЕЕДОП ОБЩИНА СВИЛЕНГРАД.pdf", "espd"],
    ["ОБРАЗЕЦ №1 - ТЕХНИЧЕСКО ПРЕДЛОЖЕНИЕ.doc", "form"],
    ["Позиция 6 осветление Страцин.xls", "unclassified"],
  ])("%s → %s", (name, kind) => {
    expect(classifyDocName(name)).toBe(kind);
  });

  // Order-sensitivity is the whole risk in a first-match-wins rule list: a spec that
  // is also an "Приложение" must not fall through to `form`, and a spec named
  // "…спецификация…договор…" must not be read as a contract draft.
  test("spec wins over the generic patterns it co-occurs with", () => {
    expect(classifyDocName("Приложение № 1 - Техническа спецификация.pdf")).toBe("spec");
    expect(classifyDocName("Техническа спецификация към проект на договор.pdf")).toBe("spec");
  });

  test("unclassified is a real answer, not a fallback to `documentation`", () => {
    expect(classifyDocName("scan0001.pdf")).toBe("unclassified");
    expect(classifyDocName("1.pdf")).toBe("unclassified");
  });
});

describe("isExtractable", () => {
  test("office formats yes, archives and images no", () => {
    for (const e of [".pdf", ".doc", ".docx", ".PDF"]) expect(isExtractable(e)).toBe(true);
    // Archives are 6.5% of files and 88% of bytes — tier B must never fetch one.
    for (const e of [".zip", ".rar", ".7z", ".dwg", ".jpg", null, undefined, ""])
      expect(isExtractable(e)).toBe(false);
  });
});

describe("pickSpec", () => {
  test("picks the spec and ignores everything else", () => {
    const got = pickSpec([
      { Name: "Документация.pdf", Extension: ".pdf", Size: 900 },
      { Name: "Техническа спецификация.pdf", Extension: ".pdf", Size: 100 },
      { Name: "Проект на договор.pdf", Extension: ".pdf", Size: 800 },
    ]);
    expect(got?.Name).toBe("Техническа спецификация.pdf");
  });

  test("breaks ties on size — the substance is in the bigger file", () => {
    const got = pickSpec([
      { Name: "Техническа спецификация - приложение.pdf", Extension: ".pdf", Size: 10 },
      { Name: "Техническа спецификация.pdf", Extension: ".pdf", Size: 5000 },
    ]);
    expect(got?.Size).toBe(5000);
  });

  test("a spec inside an archive is NOT picked — tier B cannot extract it", () => {
    expect(
      pickSpec([{ Name: "Техническа спецификация.zip", Extension: ".zip", Size: 999 }]),
    ).toBeNull();
  });

  test("returns null when no spec-named file exists (the ~32% case)", () => {
    expect(
      pickSpec([{ Name: "Документация.pdf", Extension: ".pdf", Size: 10 }]),
    ).toBeNull();
  });
});
