import { describe, expect, it } from "vitest";
import { looksLikeLabelledTable } from "./ocr";

// `ocrImageFile` itself spawns the real `tesseract` binary — same untested
// boundary as scripts/council/lib/pdf_text.ts's `extractPdfText` (no test
// file exists for that wrapper either). Only the pure post-processing
// function is unit-tested here.

describe("looksLikeLabelledTable", () => {
  it("recognizes real OCR output measured against Alpha Research's Graph02.jpg", () => {
    // Verbatim tesseract output (2026-09-09, Bulgarian, --psm 6) over a real
    // captured chart — several rows are noisy, but enough are clean.
    const ocr = `ЕЛЕКТОРАЛНИ НАГЛАСИ
(сред твърдо решилите да гласуват)
м.
герв-сдс и РННННННННЯ 20 те.
пъДБ И био
Възраждане | 6.80
БСП - Обединена левица | 3.890
меч. ДД з зе,
Коалиция Сияние О1 2.47
Величие || 2.27
Алианс за права и свободи (АПС) ВВ 1.зг.
ИТН 1.74
Синя България В 1.590
Други 4.990`;
    expect(looksLikeLabelledTable(ocr)).toBe(true);
  });

  it("rejects a page with fewer than the minimum labelled rows", () => {
    const ocr = `НАМЕРЕНИЕ ЗА УЧАСТИЕ В ИЗБОРИТЕ
Да, със сигурност
По-скоро да`;
    expect(looksLikeLabelledTable(ocr)).toBe(false);
  });

  it("ignores lines with digits but no real label, and vice versa", () => {
    const ocr = `12345
абв
абвгд 1`; // only the third line has BOTH a 3+ letter run and a digit
    expect(looksLikeLabelledTable(ocr, 1)).toBe(true);
    expect(looksLikeLabelledTable(ocr, 2)).toBe(false);
  });

  it("respects a custom minRows threshold", () => {
    const ocr = `Партия А 10%\nПартия Б 20%\nПартия В 30%`;
    expect(looksLikeLabelledTable(ocr, 3)).toBe(true);
    expect(looksLikeLabelledTable(ocr, 4)).toBe(false);
  });
});
