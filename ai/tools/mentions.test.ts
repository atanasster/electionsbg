import { describe, expect, it } from "vitest";
import {
  aroundAmount,
  clipToMatch,
  mentionsTerm,
  termVariants,
} from "./mentions";
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

describe("clipToMatch", () => {
  const terms = ["INSAIT", "ИНИОКН"];
  it("keeps a name that sits past the cut visible", () => {
    const title =
      "Покана 44.1: „Периодична доставка и монтаж на мебели за нуждите на учебни сгради и бази към Софийски университет „Св. Климент Охридски” - ИНИОКН";
    const out = clipToMatch(title, terms, 100);
    expect(out).toContain("ИНИОКН");
    expect(out.startsWith("Покана 44.1")).toBe(true);
    expect(out).toContain(" … ");
    expect(out.length).toBeLessThanOrEqual(130);
  });
  it("shows the INSAIT clause at the end of a long ЗДОИ subject", () => {
    const subject =
      "Aвтоматизацията на дейности в Министерството на иновациите и растежа (МИР) и на Информационната система за управление и наблюдение на средствата от ЕС в България 2020 (ИСУН 2020), извършвана съвместно с ИНСАИТ (INSAIT)";
    expect(clipToMatch(subject, terms, 140)).toMatch(
      /съвместно с ИНСАИТ \(INSAIT\)$/,
    );
  });
  it("cuts as before when the name is already inside the cut, or absent", () => {
    const early = "Доставка за INSAIT " + "x".repeat(200);
    expect(clipToMatch(early, terms, 50)).toBe(early.slice(0, 49) + "…");
    const none = "y".repeat(200);
    expect(clipToMatch(none, terms, 50)).toBe(none.slice(0, 49) + "…");
  });
  it("needs the whole word, as the search does", () => {
    const t = "z ".repeat(80) + "INSAS програма";
    expect(clipToMatch(t, ["INSAIT"], 60)).not.toContain("INSAS");
  });
});

describe("aroundAmount", () => {
  it("quotes a short excerpt whole, keeping its own ellipses", () => {
    expect(
      aroundAmount("…сумата от 100 млн. лв., заложена…", "100 млн. лв."),
    ).toBe("„…сумата от 100 млн. лв., заложена…“");
  });
  it("keeps the amount in view when it has to cut", () => {
    const long = `${"а ".repeat(150)}сумата от 7 876 741 лв. е изплатена${" б".repeat(150)}`;
    const q = aroundAmount(long, "7 876 741 лв.", 80);
    expect(q).toContain("7 876 741 лв.");
    expect(q.startsWith("„…")).toBe(true);
    expect(q.endsWith("…“")).toBe(true);
    expect(q.length).toBeLessThanOrEqual(80 + 4);
  });
});
