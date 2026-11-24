// The curated-entity path of entityMentions (docs/plans/insait-gap-v1.md §2).
// The fixture mirrors what the live routes returned on 2026-11-24 for the three
// queries a reader actually tried — „INSAIT", „ИНСАЙТ" and „INSAIT, ИНСАЙТ" —
// and the assertion is that all three give the SAME, correct answer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchData, fetchDb } from "./dataClient";
import { ENTITY_ALIASES } from "./entityAliases";
import { aliasMentioned, entityMentions, resolveAliases } from "./mentions";

vi.mock("./dataClient", () => ({ fetchDb: vi.fn(), fetchData: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const SU = 'Софийски университет "СВ.КЛИМЕНТ Охридски"';
const insait = ENTITY_ALIASES.find((a) => a.id === "insait")!;

const contract = (
  key: string,
  title: string,
  awarderName: string,
  amountEur: number,
) => ({
  key,
  title,
  date: "2025-09-26",
  awarderName,
  contractorName: "Доставчик ЕООД",
  amountEur,
});

// What procurement-search returns per needle.
const searchFor = (q: string) => {
  if (q === "INSAIT")
    return {
      contracts: [
        contract(
          "c1",
          "Доставка на сървъри за нуждите на Институт (INSAIT) към СУ",
          SU,
          1_760_378,
        ),
        // Names the institute, but another buyer — not INSAIT's purchase.
        contract("c9", "Обучение по модели на INSAIT", "Община Пловдив", 9_000),
      ],
      tenders: [
        {
          unp: "u1",
          subject: "Доставка на хардуер за INSAIT",
          publicationDate: "2025-11-11",
          buyerName: SU,
          estimatedValueEur: 554_900,
        },
      ],
      funds: [
        {
          contractNumber: "f1",
          title: "Изчислителна инфраструктура за INSAIT",
          beneficiaryEik: "000670680",
          beneficiaryName: SU,
          programName: "ПВУ",
          totalEur: 2_000_000,
        },
        // An excluded "insight" firm's project — must never read as INSAIT's.
        {
          contractNumber: "f2",
          title: "Дигитализация в ДАТА ИНСАИТ И БИЗНЕС",
          beneficiaryEik: "203637591",
          beneficiaryName: "ДАТА ИНСАИТ И БИЗНЕС",
          programName: "ПКИП",
          totalEur: 40_000,
        },
      ],
      interreg: [
        {
          keepId: 77,
          title: "Cross-border AI with INSAIT",
          programmeBg: "Interreg RO-BG",
          period: "2021-2027",
          bgBudgetEur: 300_000,
          partnerHit: "Община Русе",
        },
      ],
      companies: [],
    };
  if (q === "ИНИОКН")
    return {
      contracts: [
        contract(
          "c2",
          "Сървър за Института за научни изследвания в областта на компютърните науки (ИНИОКН)",
          SU.toUpperCase(),
          49_805,
        ),
      ],
    };
  if (q === "ИНСАЙТ")
    return {
      contracts: [
        contract("c8", "Доставка на абокатери", "УМБАЛ Свети Георги", 4_500),
      ],
    };
  return {};
};

const companiesFor = (global: string) =>
  global === "INSAIT"
    ? [
        { uic: "203637591", name: "ДАТА ИНСАИТ И БИЗНЕС", legalForm: "EOOD" },
        { uic: "131231159", name: "ИНСАИТ ИН", legalForm: "EOOD" },
        // Not on the exclude list: only the verified-ЕИК rule keeps it out.
        { uic: "111111111", name: "ИНСАИТ КОНСУЛТ", legalForm: "EOOD" },
      ]
    : global === "ИНСАЙТ"
      ? [
          { uic: "121396326", name: "АГЕНЦИЯ ИНСАЙТ", legalForm: "EOOD" },
          {
            uic: "207211849",
            name: "ИНСАЙТ изследвания и образование",
            legalForm: "FOUND",
          },
        ]
      : [];

const mockRoutes = () => {
  vi.mocked(fetchData).mockResolvedValue(null);
  vi.mocked(fetchDb).mockImplementation(
    async (route: string, params?: Record<string, unknown>) => {
      const p = params ?? {};
      if (route === "procurement-search") return searchFor(String(p.q));
      if (route === "agri-search")
        return String(p.q) === "ИНСАЙТ"
          ? [
              {
                eik: "205144615",
                name: "ИНСАЙТ АГРО ООД",
                oblast: "Стара Загора",
                totalEur: 825_900,
              },
            ]
          : String(p.q) === "INSAIT"
            ? [
                {
                  eik: "222222222",
                  name: "ИНСАИТ ФАРМ",
                  oblast: "Плевен",
                  totalEur: 120_000,
                },
              ]
            : [];
      if (route === "vote-item-search") return { items: [] };
      if (route === "zdoi-search")
        return {
          items:
            String(p.q) === "INSAIT"
              ? [
                  {
                    appId: 8905,
                    regNo: "1702480122-13.12.2023",
                    body: "Министерство на образованието и науката",
                    status: "Одобрено",
                    submittedOn: "2023-12-13",
                    subjectExcerpt:
                      "Информация за проекта за изчислителен център на INSAIT",
                  },
                ]
              : [],
          coverage: {
            requests: 22000,
            firstSubmitted: "2019-01-02",
            lastSubmitted: "2026-11-23",
          },
        };
      if (route === "entity-appropriations")
        return {
          named: [
            {
              fiscalYear: 2026,
              section: "priority",
              projectCode: "NP-25.002-0048",
              title: "Изчислителен център за изкуствен интелект",
              institution: "Министерство на образованието и науката",
              dvIdMat: "241000",
              year: 2026,
              kind: "appropriation",
              amountEur: 3_500_000,
            },
            {
              fiscalYear: 2026,
              section: "priority",
              projectCode: "NP-25.002-0048",
              title: "Изчислителен център за изкуствен интелект",
              institution: "Министерство на образованието и науката",
              dvIdMat: "241000",
              year: 2028,
              kind: "forecast",
              amountEur: 4_000_000,
            },
          ],
          decrees: [
            {
              idMat: 156315,
              decreeNo: 67,
              decreeDate: "2021-02-25",
              budgetOf: "Министерството на образованието и науката",
              seq: 1,
              amountEur: 3_989_201.52,
              upTo: false,
              purpose: "за Софийския университет",
            },
          ],
        };
      if (route === "table") {
        const req = JSON.parse(String(p.q));
        if (req.resource === "companies")
          return { rows: companiesFor(req.filters.global) };
        return { rows: [] };
      }
      return {};
    },
  );
};

const ctx = { lang: "bg", election: "2026_04_19" } as const;

describe("resolveAliases", () => {
  it("resolves every spelling a reader used to the same entity", () => {
    for (const v of ["INSAIT", "ИНСАИТ", "ИНСАЙТ", "insait", "ИНИОКН"])
      expect(resolveAliases([v]).aliases.map((a) => a.id)).toEqual(["insait"]);
  });
  it("resolves once for several spellings and keeps other names plain", () => {
    expect(resolveAliases(["INSAIT", "ИНСАЙТ", "Google"])).toEqual({
      aliases: [insait],
      rest: ["Google"],
    });
  });
  it("does not resolve a longer name that merely contains the word", () => {
    expect(resolveAliases(["АГЕНЦИЯ ИНСАЙТ"]).aliases).toEqual([]);
  });
});

describe("aliasMentioned", () => {
  it("needs the institute named AND the parent as buyer for procurement", () => {
    expect(aliasMentioned(insait, "Хардуер за INSAIT", SU)).toBe(true);
    expect(aliasMentioned(insait, "Хардуер за INSAIT", "Община Пловдив")).toBe(
      false,
    );
    expect(aliasMentioned(insait, "Хардуер за INSAIT", null)).toBe(false);
  });
  it("never treats the word „инсайт“ as the institute", () => {
    expect(aliasMentioned(insait, "ИНСАЙТ АГРО ООД")).toBe(false);
    expect(aliasMentioned(insait, "ДАТА ИНСАИТ И БИЗНЕС")).toBe(true); // a name match…
  });
});

describe("entityMentions — INSAIT", () => {
  const run = async (term: string) => {
    mockRoutes();
    const env = await entityMentions({ term }, ctx);
    const rows = (env.rows ?? []) as Record<string, string>[];
    return { env, subjects: rows.map((r) => r.subject) };
  };

  it.each(["INSAIT", "ИНСАЙТ", "INSAIT, ИНСАЙТ"])(
    "„%s“ gives the same correct answer",
    async (term) => {
      const { env, subjects } = await run(term);
      // the institute's purchases, including the old-acronym one
      expect(subjects.some((s) => s.includes("(INSAIT) към СУ"))).toBe(true);
      expect(subjects.some((s) => s.includes("ИНИОКН"))).toBe(true);
      expect(
        subjects.some((s) => s.includes("Доставка на хардуер за INSAIT")),
      ).toBe(true);
      // the foundation, by verified ЕИК
      expect(subjects).toContain("ИНСАЙТ изследвания и образование");
      // …and none of the noise
      // its parent's EU-funds project that names it
      expect(subjects).toContain("Изчислителна инфраструктура за INSAIT");
      // These are all returned by the INSAIT-needle searches above, so they reach
      // the filter: a firm, a beneficiary or a subsidy recipient is never INSAIT
      // on a name match, and a title naming it under another buyer is not its.
      for (const noise of [
        "ДАТА ИНСАИТ И БИЗНЕС",
        "ИНСАИТ ИН",
        "ИНСАИТ КОНСУЛТ",
        "ИНСАИТ ФАРМ",
        "Дигитализация в ДАТА ИНСАИТ И БИЗНЕС",
        "Cross-border AI with INSAIT",
        "Обучение по модели на INSAIT",
      ])
        expect(subjects).not.toContain(noise);
      expect(env.facts?.resolved_entity).toMatch(/000670680/);
      expect(env.facts?.farm_subsidy_recipients).toBe(0);
    },
  );

  it("finds the ЗДОИ request by the institute's NAME, labelled as the body's answer", async () => {
    const { env } = await run("ИНСАЙТ");
    const asked = vi
      .mocked(fetchDb)
      .mock.calls.filter(([route]) => route === "zdoi-search")
      .map(([, p]) => String(p?.q));
    expect(asked).toContain("INSAIT");
    // the broad search phrase would pull in other institutes' requests
    expect(asked).not.toContain("изследвания в областта на компютърните науки");
    expect(env.cellLinks).toContainEqual(
      expect.objectContaining({
        href: "https://pitay.government.bg/application/8905/view",
      }),
    );
    expect(env.facts?.access_to_information_requests).toBe(1);
    expect(String(env.facts?.access_to_information_note)).toMatch(
      /отговорът е на самата институция/,
    );
    expect(String(env.facts?.access_to_information_coverage)).toMatch(
      /подадени през ПДОИ/,
    );
  });

  it("does not claim ЗДОИ was searched when the corpus is not there", async () => {
    mockRoutes();
    const inner = vi.mocked(fetchDb).getMockImplementation()!;
    vi.mocked(fetchDb).mockImplementation(async (route, p) =>
      route === "zdoi-search" ? { items: [], coverage: null } : inner(route, p),
    );
    const env = await entityMentions({ term: "INSAIT" }, ctx);
    expect(String(env.facts?.coverage_note)).not.toMatch(/ЗДОИ/);
    expect(env.facts?.access_to_information_coverage).toBeUndefined();
  });

  it("shows the law line and the decree, never summing a forecast into the appropriation", async () => {
    const { env, subjects } = await run("INSAIT");
    const asked = vi
      .mocked(fetchDb)
      .mock.calls.filter(([route]) => route === "entity-appropriations")
      .map(([, p]) => p);
    expect(asked).toEqual([
      {
        lines: "2025:NP-25.001-0048,2025:NP-25.002-0048,2026:NP-25.002-0048",
        decrees: "156315",
      },
    ]);
    expect(subjects.some((s) => s.startsWith("NP-25.002-0048"))).toBe(true);
    expect(subjects.some((s) => s.startsWith("ПМС № 67/2021"))).toBe(true);
    const parties = (env.rows ?? []).map((r) => String(r.party));
    expect(parties.some((p) => /прогноза за 2028/.test(p))).toBe(true);
    expect(env.cellLinks).toContainEqual(
      expect.objectContaining({
        href: "https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=156315",
      }),
    );
    // 3.5M appropriated; the 4M forecast is shown as a row but never added in
    expect(String(env.facts?.budget_law_appropriated)).toMatch(/3[,.]5/);
    expect(String(env.facts?.budget_law_appropriated)).not.toMatch(/7[,.]5/);
    expect(String(env.facts?.appropriations_note)).toMatch(/не е преведено/);
  });

  it("states the authorised totals in the summary line, labelled as not paid out", async () => {
    const { env } = await run("INSAIT");
    expect(env.subtitle).toMatch(/заложени по закон 3[,.]5 млн € \(2026\)/);
    expect(env.subtitle).toMatch(/по ПМС 4 млн €/);
    expect(env.subtitle).toMatch(/одобрени, не преведени/);
  });

  const withAppropriations = (body: unknown) => {
    mockRoutes();
    const inner = vi.mocked(fetchDb).getMockImplementation()!;
    vi.mocked(fetchDb).mockImplementation(async (route, p) =>
      route === "entity-appropriations"
        ? typeof body === "function"
          ? body()
          : body
        : inner(route, p),
    );
    return entityMentions({ term: "INSAIT" }, ctx);
  };
  const decree = {
    idMat: 156315,
    decreeNo: 67,
    decreeDate: "2021-02-25",
    budgetOf: "МОН",
    seq: 1,
    amountEur: 3_989_201.52,
    upTo: false,
    purpose: null,
  };

  it("publishes no appropriated total when the law only forecasts or lists a reserve", async () => {
    const env = await withAppropriations({
      named: [
        {
          fiscalYear: 2025,
          section: "reserve",
          projectCode: "NP-25.002-0048",
          title: "Изчислителен център",
          institution: "МОН",
          dvIdMat: "230000",
          year: 2025,
          kind: "indicative",
          amountEur: 15_952_000,
        },
      ],
      decrees: [decree],
    });
    expect(env.facts?.budget_law_appropriated).toBeUndefined();
  });

  it("treats a decree with no parsed amount as no data, never €0", async () => {
    const env = await withAppropriations({
      named: [],
      decrees: [{ ...decree, seq: null, amountEur: null, upTo: null }],
    });
    expect(env.facts?.decrees_authorised).toBeUndefined();
    expect(String(env.facts?.decrees_without_amount)).toMatch(/не 0/);
  });

  it("keeps a ceiling a ceiling in the total", async () => {
    const env = await withAppropriations({
      named: [],
      decrees: [{ ...decree, upTo: true }],
    });
    expect(String(env.facts?.decrees_authorised)).toMatch(/^до /);
  });

  it("says the curated money could not be loaded, rather than that there is none", async () => {
    const env = await withAppropriations(() => {
      throw new Error("500");
    });
    expect(String(env.facts?.appropriations_unavailable)).toMatch(
      /няма данни, а не „няма средства“/,
    );
    expect(String(env.facts?.coverage_note)).not.toMatch(/ПМС/);
    expect(env.subtitle).toMatch(/поименните средства не можаха да се заредят/);
  });

  it("asks for no appropriations when the entity has none curated", async () => {
    mockRoutes();
    await entityMentions({ term: "Google" }, ctx);
    expect(
      vi
        .mocked(fetchDb)
        .mock.calls.some(([route]) => route === "entity-appropriations"),
    ).toBe(false);
  });

  it("names the excluded „insight“ firms instead of dropping them silently", async () => {
    const { env } = await run("INSAIT");
    expect(String(env.facts?.similar_names_not_included)).toMatch(
      /ДАТА ИНСАИТ И БИЗНЕС/,
    );
  });
});

describe("entityMentions — without the alias entry", () => {
  // Mutation check: the „ИНСАЙТ" fixtures above are only reachable when the
  // spelling is NOT resolved. Removing the entry must bring the noise back —
  // otherwise the INSAIT assertions could pass for a reason other than the alias.
  it("„ИНСАЙТ“ falls back to a plain name search full of look-alikes", async () => {
    const i = ENTITY_ALIASES.indexOf(insait);
    ENTITY_ALIASES.splice(i, 1);
    try {
      mockRoutes();
      const env = await entityMentions({ term: "ИНСАЙТ" }, ctx);
      const subjects = (env.rows ?? []).map((r) => r.subject);
      expect(subjects).toContain("АГЕНЦИЯ ИНСАЙТ");
      expect(subjects).toContain("ИНСАЙТ АГРО ООД");
      expect(subjects.some((s) => String(s).includes("INSAIT"))).toBe(false);
    } finally {
      ENTITY_ALIASES.splice(i, 0, insait);
    }
  });
});

describe("entityMentions — plain names", () => {
  it("caps organisations AFTER the word check, so look-alikes cannot crowd out a match", async () => {
    vi.mocked(fetchData).mockResolvedValue(null);
    const noise = Array.from({ length: 30 }, (_, i) => ({
      uic: String(100000000 + i),
      name: `АА Фирма ${i}`,
      legalForm: "EOOD",
    }));
    vi.mocked(fetchDb).mockImplementation(
      async (route: string, params?: Record<string, unknown>) => {
        if (route === "table") {
          const req = JSON.parse(String(params?.q));
          if (req.resource === "companies")
            return {
              rows: [
                ...noise,
                { uic: "999999999", name: "Зебра Медия", legalForm: "OOD" },
              ].slice(0, req.pageSize),
            };
          return { rows: [] };
        }
        if (route === "vote-item-search") return { items: [] };
        if (route === "agri-search") return [];
        return {};
      },
    );
    const env = await entityMentions({ term: "Зебра Медия" }, ctx);
    expect((env.rows ?? []).map((r) => r.subject)).toEqual(["Зебра Медия"]);
  });
});
