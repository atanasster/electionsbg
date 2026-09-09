import { describe, expect, it } from "vitest";
import { normKey, resolveActualKey, stripCoalitionPrefix } from "./aliases";

describe("normKey", () => {
  it("folds every dash variant to a plain hyphen", () => {
    expect(normKey("ГЕРБ – СДС")).toBe("ГЕРБ-СДС");
    expect(normKey("ГЕРБ - СДС")).toBe("ГЕРБ-СДС");
    expect(normKey("ГЕРБ-СДС")).toBe("ГЕРБ-СДС");
  });
});

describe("resolveActualKey", () => {
  it("resolves the two entries this change added to POLL_TO_ACTUAL", () => {
    expect(resolveActualKey("Има такъв народ", new Set(["ИТН"]))).toBe("ИТН");
    expect(
      resolveActualKey("Алиансът за права и свободи", new Set(["АПС"])),
    ).toBe("АПС");
  });

  it("resolves a label whose CASE differs from the alias table's own spelling", () => {
    // sentence_rule.ts's LABEL_RE is deliberately case-insensitive, so a
    // headline-cased label reaching this function must still resolve.
    expect(resolveActualKey("ИМА ТАКЪВ НАРОД", new Set(["ИТН"]))).toBe("ИТН");
    expect(resolveActualKey("прогресивна българия", new Set(["ПрБ"]))).toBe(
      "ПрБ",
    );
  });

  it("resolves the ДПС / ДПС-НН cross-cycle rename either direction", () => {
    expect(resolveActualKey("ДПС", new Set(["ДПС-НН"]))).toBe("ДПС-НН");
    expect(resolveActualKey("ДПС-НН", new Set(["ДПС"]))).toBe("ДПС");
  });

  it("resolves the БСП / БСП-ОЛ cross-cycle rename either direction", () => {
    expect(resolveActualKey("БСП", new Set(["БСП-ОЛ"]))).toBe("БСП-ОЛ");
    expect(resolveActualKey("БСП-ОЛ", new Set(["БСП"]))).toBe("БСП");
  });

  it("strips a 'Коалиция ' prefix before resolving", () => {
    expect(
      resolveActualKey("Коалиция Прогресивна България", new Set(["ПрБ"])),
    ).toBe("ПрБ");
  });

  it("returns null for a party the actual results don't list — noise, not a wrong match", () => {
    expect(resolveActualKey("Никаква партия", new Set(["ПрБ"]))).toBeNull();
  });
});

describe("stripCoalitionPrefix", () => {
  it("strips the prefix case-insensitively and trims the rest", () => {
    expect(stripCoalitionPrefix("Коалиция Прогресивна България")).toBe(
      "Прогресивна България",
    );
    expect(stripCoalitionPrefix("коалиция ГЕРБ-СДС")).toBe("ГЕРБ-СДС");
  });

  it("returns the input unchanged when there is no prefix to strip", () => {
    expect(stripCoalitionPrefix("Прогресивна България")).toBe(
      "Прогресивна България",
    );
  });
});
