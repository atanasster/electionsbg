import { describe, expect, it } from "vitest";
import type { ProcurementContract } from "@/data/dataTypes";
import {
  annexGrowthOf,
  buildChainageStrips,
  buildRoadsModel,
  EUR_PER_KM_MIN_N,
  MULTI_REGION,
  regionOf,
  roadRefOf,
  RUSE_VT_CORRIDOR,
} from "./roadAttributes";

let seq = 0;
const row = (p: Partial<ProcurementContract>): ProcurementContract =>
  ({
    key: `k${seq++}`,
    tag: "contract",
    date: "2024-03-01",
    awarderEik: "000695089",
    awarderName: "АПИ",
    contractorEik: `1${seq}`,
    contractorName: `Фирма ${seq}`,
    amountEur: 1_000_000,
    title: "",
    ...p,
  }) as ProcurementContract;

describe("roadRefOf — АМ „Русе – Велико Търново“ (R7)", () => {
  it.each([
    "Обособена позиция № 1: Участък Русе – Бяла от км 0+400 до км 40+640",
    "„Извършване на пълно археологическо проучване … по трасето на АМ „Русе – Велико Търново“ …",
    "Обособена позиция № 1: „Автомагистрала „Русе-Велико Търново“, участък „Русе-Бяла“",
    "Обособена позиция № 2: “Обход на гр. Бяла от км 40+640 до км 76+040”",
  ])("%s → the motorway", (t) => {
    expect(roadRefOf(t)?.corridor).toBe(RUSE_VT_CORRIDOR);
  });

  it("leaves the OLD road I-5 „Русе – Бяла – Велико Търново“ on I-5", () => {
    expect(
      roadRefOf(
        "Пътен възел „Трапезица“ при км 101+000 на път I-5 „Русе – Бяла – Велико Търново“",
      )?.corridor,
    ).toBe("I-5");
  });

  it("puts the Железница tunnel lot on Струма", () => {
    expect(
      roadRefOf(
        "Подучастък № 2 от км 366+720 до км 369+000, включително обслужващ тунелен път при южния портал на тунел „Железница“",
      )?.corridor,
    ).toBe("Струма");
  });
});

describe("regionOf — the directorate named after „ОПУ“ (R12)", () => {
  it("a lot naming several ОПУ is MULTI_REGION, not the longest oblast", () => {
    expect(
      regionOf(
        "Обособена позиция 3: АМ „Тракия“ на територията на ОПУ София, ОПУ Пазарджик, ОПУ Пловдив, ОПУ Стара Загора, ОПУ Сливен, ОПУ Ямбол и ОПУ Бургас",
      ),
    ).toBe(MULTI_REGION);
  });

  it("a single ОПУ lot keeps its oblast", () => {
    expect(regionOf("Обособена позиция №4 – ОПУ Хасково")).toBe("Хасково");
    expect(regionOf("ОПУ Велико Търново")).toBe("Велико Търново");
  });

  it("„Граница ОПУ-X“ is a road endpoint, not the directorate", () => {
    expect(
      regionOf(
        "Основен ремонт на път II-11 „Граница ОПУ-Видин – Лом – Граница ОПУ-Враца“ … област Монтана",
      ),
    ).toBe("Монтана");
  });

  it("no ОПУ → undefined", () => {
    expect(regionOf("Път I-1 София – Видин")).toBeUndefined();
  });
});

describe("buildRoadsModel — consortium members (R10)", () => {
  it("drops €0 member rows from every count and single-bid share, € unchanged", () => {
    const carrier = row({
      title: "Зимно поддържане ОПУ Варна",
      amountEur: 3_000_000,
      numberOfTenderers: 2,
      consortiumRole: "carrier",
    });
    // Two members inherit the carrier's procedure — but say „1 bidder" here to
    // prove they no longer vote in the share at all.
    const members = [1, 2].map(() =>
      row({
        title: "Зимно поддържане ОПУ Варна",
        amountEur: 0,
        numberOfTenderers: 1,
        consortiumRole: "member",
      }),
    );
    const m = buildRoadsModel([carrier, ...members]);
    expect(m.rows).toHaveLength(1);
    expect(m.totalEur).toBe(3_000_000);
    expect(m.singleBidShare).toBe(0);
    const winter = m.components.find((c) => c.component === "winter_maint");
    expect(winter?.contractCount).toBe(1);
    expect(winter?.singleBidShare).toBe(0);
  });
});

describe("€/km median floor (R13)", () => {
  const build = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      row({
        title: `Изграждане на АМ „Струма“ от км ${10 + i * 5}+000 до км ${12 + i * 5}+000`,
        amountEur: 20_000_000,
      }),
    );

  it(`publishes no median below ${EUR_PER_KM_MIN_N} rows, but keeps the count`, () => {
    const c = buildRoadsModel(build(EUR_PER_KM_MIN_N - 1)).corridors[0];
    expect(c.eurPerKmN).toBe(EUR_PER_KM_MIN_N - 1);
    expect(c.eurPerKmMedian).toBeUndefined();
  });

  it("publishes it at the floor", () => {
    const c = buildRoadsModel(build(EUR_PER_KM_MIN_N)).corridors[0];
    expect(c.eurPerKmMedian).toBe(10_000_000);
  });
});

describe("annex growth on the time spine (R8)", () => {
  it("is current − signing value, booked to the signing year", () => {
    expect(annexGrowthOf({ amountEur: 150, signingAmountEur: 100 })).toBe(50);
    expect(annexGrowthOf({ amountEur: 90, signingAmountEur: 100 })).toBe(0);
    expect(annexGrowthOf({ amountEur: 90 })).toBe(0);
    const m = buildRoadsModel([
      row({ date: "2024-05-01", amountEur: 150, signingAmountEur: 100 }),
      row({ date: "2024-06-01", amountEur: 10 }),
    ]);
    expect(m.years[0]).toMatchObject({
      year: "2024",
      totalEur: 160,
      growthEur: 50,
    });
  });
});

describe("buildChainageStrips (R14, R15)", () => {
  const struma = (from: number, to: number, eur = 50_000_000) =>
    row({
      title: `Изграждане на АМ „Струма“ Лот от км ${from}+000 до км ${to}+000`,
      amountEur: eur,
    });

  it("places Struma construction lots on the I-1 axis instead of rejecting them", () => {
    const m = buildRoadsModel([
      struma(305, 322),
      struma(322, 359),
      struma(359, 376),
    ]);
    const strips = buildChainageStrips(m.rows);
    expect(strips).toHaveLength(1);
    expect(strips[0].axis.axisKey).toBe("Струма I-1");
    expect(strips[0].contracts).toBe(3);
  });

  it("coverage is a share of the WHOLE axis, and near-€0 work does not cover it", () => {
    const audits = [
      [103, 139],
      [122, 139],
      [222, 268],
    ].map(([a, b]) =>
      row({
        title: `Одит за пътна безопасност на АМ „Хемус“ от км ${a}+000 до км ${b}+000`,
        amountEur: 1_000,
      }),
    );
    const strips = buildChainageStrips(buildRoadsModel(audits).rows);
    expect(strips[0].axis.corridor).toBe("Хемус");
    expect(strips[0].coveredPct).toBe(0);
  });

  it("a maintenance lot shades the bins but covers nothing", () => {
    const lots = [
      [0, 56],
      [56, 120],
      [120, 166],
    ].map(([a, b]) =>
      row({
        title: `Поддържане на АМ „Струма“ от км ${a}+000 до км ${b}+000`,
        amountEur: 40_000_000,
      }),
    );
    const [strip] = buildChainageStrips(buildRoadsModel(lots).rows);
    expect(strip.axis.axisKey).toBe("Струма");
    expect(strip.maxBin).toBeGreaterThan(1);
    expect(strip.coveredPct).toBe(0);
  });
});
