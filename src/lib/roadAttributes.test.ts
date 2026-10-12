import { describe, expect, it } from "vitest";
import type { ProcurementContract } from "@/data/dataTypes";
import {
  annexGrowthOf,
  buildChainageStrips,
  buildRoadsModel,
  EUR_PER_KM_MIN_N,
  eurPerKmOf,
  isPartialScope,
  lengthOf,
  MULTI_REGION,
  regionOf,
  roadRefOf,
  RUSE_VT_CORRIDOR,
  workComponentOf,
  workGroupOf,
  workTypeOf,
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

// Real titles from the АПИ corpus (measured 2026-10-12): service contracts that
// carry a motorway's chainage and used to be unit-costed as road works.
describe("non-physical work carries no €/km", () => {
  const perKmOf = (
    title: string,
    amountEur: number,
    cpv?: string,
    name?: string,
  ) =>
    eurPerKmOf(
      { amountEur, title },
      workTypeOf(title, cpv, name),
      lengthOf(title),
    );

  it.each([
    [
      "Извършване на пълно спасително археологическо проучване – разкопки на Обект № 9 от км 51+600 до км 52+040 по трасето на обект: АМ „Русе – Велико Търново“",
      "71351914",
    ],
    [
      "„Пълно спасително археологическо проучване – разкопки на Обект №5 от км 165+300 и км 166+160 по проект 2015 г. и от км 166+700 до 167+560 по нов проект“",
      "71351914",
    ],
    [
      '„Извършване на археологическо проучване на обект № 16 ( от км 419+670 до км 420+384) по трасето на автомагистрала "Струма", Лот 3.3”.',
      "71351914",
    ],
    // No CPV at all: the title alone decides.
    [
      "Извършване на археологическо проучване на обекти от км 39+300 до км 39+480 и от км 57+500 до км 57+700 по трасето",
      undefined,
    ],
  ])("archaeology: %s", (title, cpv) => {
    const wt = workTypeOf(title, cpv);
    expect(wt).toBe("archaeology");
    expect(workGroupOf(wt)).toBe("other");
    expect(workComponentOf(title, cpv, wt)).toBe("archaeology");
    expect(perKmOf(title, 1_700_000, cpv)).toBeUndefined();
  });

  it("a works lot merely sited at an archaeological object stays physical", () => {
    const t =
      "Изготвяне на технически проект и изграждане на подпорна стена при археологически Обект № 15 по трасето на АМ „Струма“";
    expect(workTypeOf(t, "45233120")).not.toBe("archaeology");
  });

  it("supervision titled after the works lot it oversees (CPV 71521000)", () => {
    // ДЗЗД „Лидер консулт", €6.5M — same title as the €448.2M build lot.
    const t =
      "Обособена позиция № 1: Участък Русе – Бяла от км 0+400 до км 40+640";
    expect(workTypeOf(t, "71521000", 'Дружество по ЗЗД "Лидер консулт"')).toBe(
      "supervision",
    );
    expect(perKmOf(t, 6_510_000, "71521000")).toBeUndefined();
    // …while the construction lot on the identical title keeps its €/km.
    const works = perKmOf(t, 448_160_000, "45233120");
    expect(works?.eurPerKm).toBeGreaterThan(10e6);
  });

  it("a supervision ДЗЗД with no CPV is read from its name", () => {
    const t =
      'Лот 3.2.1, участък "Крупник - Кресна" – ляво платно от км 375+860 до км 389+100 и пътни връзки';
    expect(workTypeOf(t, undefined, "ДЗЗД КОНСУЛТАНТИ СТРУМА 1")).toBe(
      "supervision",
    );
  });

  it("a builders' consortium with a „…консулт“ member and CPV 45 stays works", () => {
    const t =
      "„Проектиране и строителство на Автомагистрала „Струма“ Лот 3.1. участък от км 373+300 до км 376+000";
    const wt = workTypeOf(
      t,
      "45233120",
      "Обединение: АБ АД, Алве консулт ЕООД",
    );
    expect(wt).toBe("new_build");
  });

  it("a CPV-71 design-and-build (инженеринг) stays works", () => {
    expect(
      workTypeOf(
        "„Определяне на изпълнител за Проектиране и строителство (инженеринг) на нови пътни връзки и мерки за укрепване",
        "71311220",
      ),
    ).toBe("new_build");
  });

  it.each([
    [
      '„Супервизия на проектиране и строителство на автомагистрала "Струма" Лот 3.3',
      "71520000",
    ],
    [
      'Изготвяне на идеен проект за доизграждане на автомагистрала "Хемус" (етап 2)',
      "71311000",
    ],
    [
      "Изработване на технически проект за основен ремонт на „Път II-15 Враца – Борован от км 0+000 до км 40+000",
      "71320000",
    ],
  ])("CPV-71 service: %s", (title, cpv) => {
    const wt = workTypeOf(title, cpv);
    expect(workGroupOf(wt)).toBe("design");
    expect(workComponentOf(title, cpv, wt)).toBe("design_supervision");
  });

  it("a design job with no CPV is still design", () => {
    expect(
      workTypeOf(
        "Изработване на технически проект за основен ремонт на път I-3 от км 38+800 до км 88+842",
      ),
    ).toBe("design");
  });

  it("a repair of a structure is rehab, not new build", () => {
    expect(
      workTypeOf(
        "„Извършване на ремонтно – възстановителни дейности на виадукти при км 33+910, км 34+220 и км 36+450 на АМ Хемус",
        "45233110",
      ),
    ).toBe("rehab");
  });
});

describe("partial-scope contracts carry no €/km", () => {
  it.each([
    "Избор на изпълнител за извършване на строителни работи на Обект: „АМ ”СТРУМА” ЛОТ №1 „ДОЛНА ДИКАНЯ – ДУПНИЦА ОТ КМ 305+220 ДО КМ 322+000” Подобект № 1",
    'Определяне на изпълнител за извършване на допълнителни строителни работи на обект: "АМ "СТРУМА" ЛОТ №1 ДОЛНА ДИКАНЯ – ДУПНИЦА ОТ КМ 305+220 ДО КМ 322+000"',
    "„Изпълнение на допълнително възникнали видове СМР относно Обект: Лот 15: Рехабилитация на път ІІІ-181 от км 0+000 до км 20+000",
  ])("%s", (t) => {
    expect(isPartialScope(t)).toBe(true);
    expect(
      eurPerKmOf({ amountEur: 3_000_000, title: t }, "new_build", lengthOf(t)),
    ).toBeUndefined();
  });

  it("„допълнително проектиране и строителство“ is a MAIN contract and keeps it", () => {
    const t =
      "„Определяне на изпълнител за допълнително проектиране и строителство на обект: Път I-1 (E-79) „Мездра – Ботевград“ Лот 2 от км 161+367 до км 174+800“";
    expect(isPartialScope(t)).toBe(false);
    expect(
      eurPerKmOf({ amountEur: 113_750_000, title: t }, "new_build", lengthOf(t))
        ?.eurPerKm,
    ).toBeGreaterThan(8e6);
  });
});

describe("corridor €/km median is over ONE work class", () => {
  const ruseVt = [
    // The two construction lots (mediapool.bg 2022-11-05: 876.5M лв / 40.2 km,
    // 660.4M лв / 35.4 km) …
    row({
      title:
        "Обособена позиция № 1: Участък Русе – Бяла от км 0+400 до км 40+640",
      amountEur: 448_160_000,
      cpv: "45233120",
    }),
    row({
      title: "ОП №2: Обход на гр. Бяла от км 40+640 до км 76+040",
      amountEur: 337_670_000,
      cpv: "45233120",
    }),
    // … their supervision on the identical titles …
    row({
      title:
        "Обособена позиция № 1: Участък Русе – Бяла от км 0+400 до км 40+640",
      amountEur: 6_510_000,
      cpv: "71521000",
      contractorName: 'Дружество по ЗЗД "Лидер консулт"',
    }),
    row({
      title:
        "Обособена позиция № 2: Обход на гр. Бяла от км 40+640 до км 76+040“,",
      amountEur: 5_530_000,
      cpv: "71521000",
      contractorName: 'Дружество по ЗЗД "Лидер консулт"',
    }),
    // … and two archaeology digs on the route.
    ...[
      [51, 52],
      [46, 47],
    ].map(([a, b]) =>
      row({
        title: `Извършване на пълно спасително археологическо проучване – разкопки на Обект от км ${a}+600 до км ${b}+040 по трасето на обект: АМ „Русе – Велико Търново“`,
        amountEur: 1_650_000,
        cpv: "71351914",
      }),
    ),
  ];

  it("Русе – В. Търново keeps only its two works lots — too few to publish", () => {
    const m = buildRoadsModel(ruseVt);
    const c = m.corridors.find((x) => x.corridor === RUSE_VT_CORRIDOR)!;
    const perKm = m.rows
      .filter((r) => r.ref?.corridor === RUSE_VT_CORRIDOR && r.perKm)
      .map((r) => r.perKm!.eurPerKm);
    expect(perKm).toHaveLength(2);
    expect(Math.min(...perKm)).toBeGreaterThan(5e6);
    // Before: n=6, median 0.16 M€/km. Now: below the floor, not published.
    expect(c.eurPerKmN).toBe(2);
    expect(c.eurPerKmMedian).toBeUndefined();
    expect(c.eurPerKmClass).toBeUndefined();
  });

  it("build wins when it has enough rows; repair rows stay out of its median", () => {
    const lot = (from: number, eur: number, verb: string) =>
      row({
        title: `${verb} на АМ „Хемус“ от км ${from}+000 до км ${from + 10}+000`,
        amountEur: eur,
        cpv: "45233110",
      });
    const m = buildRoadsModel([
      lot(10, 30_000_000, "Изграждане"),
      lot(30, 40_000_000, "Изграждане"),
      lot(50, 50_000_000, "Изграждане"),
      lot(70, 2_000_000, "Рехабилитация"),
      lot(90, 3_000_000, "Рехабилитация"),
    ]);
    const c = m.corridors[0];
    expect(c.eurPerKmClass).toBe("build");
    expect(c.eurPerKmN).toBe(3);
    expect(c.eurPerKmMedian).toBe(4_000_000);
  });

  it("falls back to the repair class, never to a mix", () => {
    const m = buildRoadsModel(
      [10, 30, 50].map((from) =>
        row({
          title: `Рехабилитация на път II-18 от км ${from}+000 до км ${from + 10}+000`,
          amountEur: 2_000_000,
        }),
      ),
    );
    expect(m.corridors[0].eurPerKmClass).toBe("rehab");
    expect(m.corridors[0].eurPerKmMedian).toBe(200_000);
  });
});
