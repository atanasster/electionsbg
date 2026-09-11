import { afterEach, describe, expect, it, vi } from "vitest";
import { companyProfile } from "./company";
import { companyConnections } from "./people";
import { fetchDb } from "./dataClient";

vi.mock("./dataClient", () => ({ fetchDb: vi.fn() }));

afterEach(() => vi.resetAllMocks());

const ctx = { lang: "bg", election: "2026_04_19" } as const;

describe("companyProfile", () => {
  it("resolves a company name against the whole registry before loading its profile", async () => {
    vi.mocked(fetchDb)
      .mockResolvedValueOnce({
        rows: [
          {
            uic: "202930997",
            name: "Провиотик",
            legalForm: "AD",
            status: "active",
          },
        ],
      })
      .mockResolvedValueOnce({
        company: {
          uic: "202930997",
          name: "Провиотик",
          legal_form: "AD",
          seat: "БЪЛГАРИЯ, гр. София",
          subject_of_activity: "Научноизследователска дейност",
          status: "active",
          funds_amount: 50000,
          funds_currency: "BGN",
          entity_class: "company",
        },
        summary: { contracts: 0, contract_rows: 0, contracts_eur: 0 },
        officers: [{ active: true }],
        funds: null,
        subsidies: null,
      });

    const env = await companyProfile({ company: "ПроВиотик" }, ctx);

    expect(fetchDb).toHaveBeenNthCalledWith(
      1,
      "table",
      expect.objectContaining({
        q: expect.stringContaining('"resource":"companies"'),
      }),
    );
    expect(fetchDb).toHaveBeenNthCalledWith(2, "company", { eik: "202930997" });
    expect(env.title).toBe("Провиотик");
    expect(env.facts.eik_id).toBe("202930997");
    expect(env.facts.legal_form).toBe("АД");
  });

  it("does not search when the input already contains an EIK", async () => {
    vi.mocked(fetchDb).mockResolvedValueOnce({
      company: {
        uic: "202930997",
        name: "Провиотик",
        legal_form: "AD",
        seat: null,
        subject_of_activity: null,
        status: "active",
        funds_amount: null,
        funds_currency: null,
        entity_class: "company",
      },
      summary: { contracts: 0, contract_rows: 0, contracts_eur: 0 },
      officers: [],
      funds: null,
      subsidies: null,
    });

    await companyProfile({ company: "ЕИК 202930997" }, ctx);
    expect(fetchDb).toHaveBeenCalledTimes(1);
    expect(fetchDb).toHaveBeenCalledWith("company", { eik: "202930997" });
  });

  it("shows legal forms for ambiguous registry matches", async () => {
    vi.mocked(fetchDb).mockResolvedValueOnce({
      rows: [
        {
          uic: "111111111",
          name: "АЛФА",
          legalForm: "ЕООД",
          status: "active",
        },
        {
          uic: "222222222",
          name: "АЛФА",
          legalForm: "АД",
          status: "active",
        },
      ],
    });

    const env = await companyProfile({ company: "Алфа" }, ctx);

    expect(env.clarify?.options.map((option) => option.sublabel)).toEqual([
      "ЕООД · ЕИК 111111111",
      "АД · ЕИК 222222222",
    ]);
  });

  it("keeps a known EIK as the site-link target when its profile is absent", async () => {
    vi.mocked(fetchDb).mockResolvedValueOnce({
      company: null,
      summary: null,
      officers: [],
      funds: null,
      subsidies: null,
    });

    const env = await companyProfile({ company: "202930997" }, ctx);

    expect(env.facts.eik_id).toBe("202930997");
  });
});

describe("companyConnections", () => {
  it("links people and companies named inside result rows", async () => {
    vi.mocked(fetchDb).mockResolvedValueOnce({
      eik: "202930997",
      name: "Провиотик",
      legalForm: "АД",
      status: "active",
      officerRowCount: 2,
      directCount: 1,
      bridgedCount: 1,
      bridgedPathCount: 1,
      bridgeMaxCompanies: 50,
      bridgeFoldsSuppressed: 0,
      directTruncated: false,
      bridgedTruncated: false,
      direct: [
        {
          slug: "miroslava-petrova",
          name: "Мирослава Петрова Петрова",
          office: "",
          officeSource: "mp",
          officeRole: "mp",
          roles: ["manager"],
          linkBasis: "declared",
        },
      ],
      bridged: [
        {
          slug: "kostadin-petkov",
          name: "Костадин Тодоров Петков",
          office: "",
          officeSource: "official_exec",
          officeRole: "official",
          bridgeName: "Мартин Петров Драгулев",
          bridgeCompanies: 7,
          viaEik: "123456789",
          viaCompany: "Да запазим Корал",
          pathCount: 1,
        },
      ],
    });

    const env = await companyConnections({ eik: "202930997" }, ctx);

    expect(env.cellLinks).toEqual([
      {
        row: 0,
        column: "person",
        text: "Мирослава Петрова Петрова",
        href: "/person/miroslava-petrova",
      },
      {
        row: 1,
        column: "person",
        text: "Костадин Тодоров Петков",
        href: "/person/kostadin-petkov",
      },
      {
        row: 1,
        column: "link",
        text: "Мартин Петров Драгулев",
        href: expect.stringContaining("/person/"),
      },
      {
        row: 1,
        column: "link",
        text: "Да запазим Корал",
        href: "/company/123456789",
      },
    ]);
  });
});
