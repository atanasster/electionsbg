// The КЗП feed shouts. Measured over all 181 distinct deal titles in
// price_payloads, a first cut that lower-cased runs of 4+ capitals left 65% of
// them with a shouted short word still in place — and they are ordinary
// Bulgarian words, not units: ЗА ×20, ТИП ×5, СОС ×5, НА ×3, БОБ ×3, БЕЗ ×2,
// БЯЛ ×2, БУТ, ФИН. It rendered "Паста ЗА Зъби".

import { describe, it, expect } from "vitest";
import { sentenceCase } from "./sentenceCase";

describe("sentenceCase", () => {
  it("leaves no shouted short word behind", () => {
    expect(sentenceCase("ПАСТА ЗА ЗЪБИ AQUAFRESH")).toBe(
      "Паста за зъби Aquafresh",
    );
    expect(sentenceCase("СВИНСКИ БУТ БЕЗ КОСТ")).toBe("Свински бут без кост");
    expect(sentenceCase("БЯЛ БОБ ТИП А 1КГ")).toBe("Бял боб тип а 1кг");
  });

  it("MUTATION CHECK: a 4+ threshold fails every one of those", () => {
    // The control. If this stops differing, the rule has drifted back.
    const fourPlus = (t: string) =>
      t.replace(
        /[A-ZА-Я][A-ZА-Я]{3,}/g,
        (w) => w[0] + w.slice(1).toLowerCase(),
      );
    expect(fourPlus("ПАСТА ЗА ЗЪБИ AQUAFRESH")).toContain("ЗА");
    expect(sentenceCase("ПАСТА ЗА ЗЪБИ AQUAFRESH")).not.toContain("ЗА");
  });

  it("title-cases Latin brands rather than lowering them", () => {
    // "lurpak" reads as a typo; "Lurpak" reads as a name.
    expect(sentenceCase("МАСЛО КРАВЕ LURPAK 200 ГР")).toBe(
      "Масло краве Lurpak 200 гр",
    );
    expect(sentenceCase("90Г ШОКОЛАД LACMI МЛЕЧЕН")).toContain("Lacmi");
  });

  it("leaves short Latin runs alone — they are units and initialisms", () => {
    expect(sentenceCase("МЛЯКО BIO 3D ML")).toBe("Мляко BIO 3D ML");
  });

  it("capitalises the first WORD, not a leading quantity's unit", () => {
    // "90Г ШОКОЛАД" → raising the first letter in the string gives "90Г
    // шоколад"; the sentence starts at the next word.
    expect(sentenceCase("90Г ШОКОЛАД LACMI МЛЕЧЕН")).toBe(
      "90Г шоколад Lacmi млечен",
    );
    expect(sentenceCase("10КГ КРОМИД ЛУК 80+")).toBe("10Кг кромид лук 80+");
  });

  it("does not shout at a title that was already sentence case", () => {
    expect(sentenceCase("Фермата пилешки кренвирш, нас. Кг")).toBe(
      "Фермата пилешки кренвирш, нас. кг",
    );
  });

  it("survives punctuation, empties and pure numbers", () => {
    expect(sentenceCase("")).toBe("");
    expect(sentenceCase("123")).toBe("123");
    expect(sentenceCase("«МЛЯКО»")).toBe("«Мляко»");
  });
});
