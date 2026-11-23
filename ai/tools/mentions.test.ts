import { describe, expect, it } from "vitest";
import { mentionsTerm, termVariants } from "./mentions";
import { nameResembles } from "./fiscal";

describe("mentionsTerm", () => {
  it("matches the name as a whole word, in either script", () => {
    expect(mentionsTerm("Хардуер за Институт (INSAIT) към СУ", "INSAIT")).toBe(
      true,
    );
    expect(mentionsTerm("ДАТА ИНСАИТ И БИЗНЕС", "INSAIT")).toBe(true);
    expect(mentionsTerm("Institute INSAIT", "ИНСАИТ")).toBe(true);
  });
  it("rejects look-alikes", () => {
    expect(mentionsTerm("Инсас ООД", "INSAIT")).toBe(false);
    expect(mentionsTerm("Инсайд БГ ООД", "INSAIT")).toBe(false);
    expect(mentionsTerm("ИНСАЙТ изследвания", "INSAIT")).toBe(false);
  });
});

describe("termVariants", () => {
  it("dedupes the same name in two scripts", () => {
    expect(termVariants("INSAIT, ИНСАИТ")).toEqual(["INSAIT"]);
  });
  it("keeps distinct names and never splits on „и“", () => {
    expect(termVariants("INSAIT / ИНСАЙТ")).toEqual(["INSAIT", "ИНСАЙТ"]);
    expect(termVariants("Министерство на труда и социалната политика")).toEqual(
      ["Министерство на труда и социалната политика"],
    );
  });
});

describe("nameResembles", () => {
  it.each([
    ["Кауфланд България ЕООД ЕНД КО КД", "Кауфланд"],
    ["Софарма Трейдинг АД", "Sofarma Trading"],
    ["Софарма Трейдинг АД", "Софарма трейдинг"],
  ])("%s ≈ %s", (name, q) => {
    expect(nameResembles(name, q)).toBe(true);
  });
  it("INSAIT is not Инсас ООД", () => {
    expect(nameResembles("Инсас ООД", "INSAIT")).toBe(false);
  });
});
