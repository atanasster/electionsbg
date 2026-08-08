import { describe, it, expect } from "vitest";
import { naceDivisionFromLabel } from "./naceLabel";

describe("naceDivisionFromLabel — version-disambiguation (the whole point)", () => {
  // These labels carry codes whose Rev.1.1 vs Rev.2 division numbers disagree; the
  // classifier must return the correct КИД-2008 (Rev.2) division from the WORDS,
  // regardless of the ambiguous code that precedes them.
  it("wholesale → 46 (never 51/air-transport, the Rev.1.1 code trap)", () => {
    expect(
      naceDivisionFromLabel(
        "Група по НКИД: 51.90 Клас по НКИД: Друга търговия на едро",
      ),
    ).toBe("46");
    expect(
      naceDivisionFromLabel(
        "Група по НКИД: 5146 Клас по НКИД: Търговия на едро с фармацевтични стоки",
      ),
    ).toBe("46");
  });

  it("construction → 41 (never 45/motor-trade, the Rev.1.1 code trap)", () => {
    expect(
      naceDivisionFromLabel(
        "Група по НКИД: 45.21 Клас по НКИД: Строителство на жилищни и нежилищни сгради",
      ),
    ).toBe("41");
  });

  it("motor-vehicle trade → 45 (the Rev.2 sense)", () => {
    expect(
      naceDivisionFromLabel(
        "Група по НКИД: 45.11 Клас по НКИД: Търговия с леки и лекотоварни автомобили до 3.5 т",
      ),
    ).toBe("45");
  });

  it("automotive-fuel retail → 47, not motor-trade 45", () => {
    expect(
      naceDivisionFromLabel(
        "Търговия на дребно с автомобилни горива и смазочни материали",
      ),
    ).toBe("47");
  });

  it("engineering → 71; management consulting → 70; R&D → 72 (distinct)", () => {
    expect(
      naceDivisionFromLabel("Инженерни дейности и технически консултации"),
    ).toBe("71");
    expect(
      naceDivisionFromLabel(
        "Консултантска дейност по стопанско и друго управление",
      ),
    ).toBe("70");
    expect(
      naceDivisionFromLabel(
        "Научноизследователска и развойна дейност в областта на техническите науки",
      ),
    ).toBe("72");
  });

  it("electrical-equipment MANUFACTURE → 27, power GENERATION → 35", () => {
    // Both contain "електрическа енергия"; the device noun disambiguates.
    expect(
      naceDivisionFromLabel(
        "Производство на апарати за управление и разпределение на електрическа енергия",
      ),
    ).toBe("27");
    expect(naceDivisionFromLabel("Производство на електрическа енергия")).toBe(
      "35",
    );
  });

  it("common sectors resolve to their Rev.2 division", () => {
    expect(naceDivisionFromLabel("Товарен автомобилен транспорт")).toBe("49");
    expect(naceDivisionFromLabel("Счетоводни и одиторски дейности")).toBe("69");
    expect(naceDivisionFromLabel("Архитектурни дейности")).toBe("71");
    expect(
      naceDivisionFromLabel("Дейност на лекари по дентална медицина"),
    ).toBe("86");
    expect(
      naceDivisionFromLabel(
        "Дейност на ресторанти и заведения за бързо обслужване",
      ),
    ).toBe("56");
    expect(naceDivisionFromLabel("Компютърно програмиране")).toBe("62");
  });

  it("the '-nec' (некласифицирани другаде) manufacturing classes still resolve", () => {
    // Words between "производство на" and the noun must not defeat the match.
    expect(naceDivisionFromLabel("Производство на други мебели")).toBe("31");
    expect(
      naceDivisionFromLabel(
        "Производство на други метални изделия, некласифицирани другаде",
      ),
    ).toBe("25");
  });

  it("CONSERVATIVE: no confident match → null (never a guess)", () => {
    expect(naceDivisionFromLabel(null)).toBeNull();
    expect(naceDivisionFromLabel("")).toBeNull();
    expect(
      naceDivisionFromLabel("Група по НКИД: 74.90 Клас по НКИД:"),
    ).toBeNull();
    expect(
      naceDivisionFromLabel("нещо съвсем непознато и неспецифично"),
    ).toBeNull();
  });

  it("'спорт' does not match inside 'транспорт' (the substring-bleed trap)", () => {
    // A transport label must NOT resolve to sports (div 93).
    expect(naceDivisionFromLabel("Транспортни услуги")).toBe("49");
    expect(naceDivisionFromLabel("Товарен автомобилен транспорт")).toBe("49");
    expect(
      naceDivisionFromLabel("Спомагателни дейности в железопътния транспорт"),
    ).toBe("52");
    // Genuine sports still resolves.
    expect(naceDivisionFromLabel("Дейност на спортни клубове")).toBe("93");
    expect(naceDivisionFromLabel("Фитнес и спортни съоръжения")).toBe("93");
  });

  it("essential oils → chemicals (20), not food (10)", () => {
    expect(naceDivisionFromLabel("Производство на етерични масла")).toBe("20");
    expect(
      naceDivisionFromLabel("Производство на растителни и животински масла"),
    ).toBe("10");
  });

  it("does not confuse manufacture with trade of the same goods", () => {
    // "производство на …" anchors manufacturing; wholesale of metal goods is 46.
    expect(naceDivisionFromLabel("Търговия на едро с метални изделия")).toBe(
      "46",
    );
    expect(naceDivisionFromLabel("Производство на метални изделия")).toBe("25");
  });
});
