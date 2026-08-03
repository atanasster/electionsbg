import { describe, it, expect } from "vitest";
import { buildFundsTables, fundsThemeTableRows } from "./fundsTables";

const SITE = "https://electionsbg.com";
const caps = { beneficiaries: 2, contracts: 2, munis: 2 };
const names = (code: string) =>
  ({ S22: "София (столица)", BGS04: "Бургас" })[code];

const full = {
  statusBreakdown: [
    {
      status: "completed",
      rollup: { contractCount: 4349, totalEur: 111180402, paidEur: 111180402 },
    },
  ],
  topBeneficiaries: [
    {
      beneficiaryEik: "203740812",
      beneficiaryName: "Фонд мениджър ЕАД",
      contractCount: 2,
      totalEur: 289026480,
      paidEur: 286955694,
    },
  ],
  topContracts: [
    {
      contractNumber: "BG16RFOP002-2.007-0001",
      title: "Управление на ФнФ",
      beneficiaryName: "Фонд мениджър ЕАД",
      totalEur: 237523795,
      paidEur: 235580174,
      status: "В изпълнение",
    },
  ],
  topMunis: [{ muni: "S22", contractCount: 10720, totalEur: 328299176 }],
};

describe("buildFundsTables", () => {
  it("renders the four ranked lists with links into company and contract", () => {
    const html = buildFundsTables(full, "bg", SITE, names, caps);
    expect(html).toContain("<table>");
    expect(html).toContain(`${SITE}/company/203740812`);
    expect(html).toContain(`${SITE}/funds/contract/BG16RFOP002-2.007-0001`);
    // The status key is spelled out — "completed" tells a crawler nothing.
    expect(html).toContain("Приключени");
    // Municipality codes resolve to names.
    expect(html).toContain("София (столица)");
  });

  it("uses the English labels, names and /en link base", () => {
    const html = buildFundsTables(full, "en", SITE, () => "Sofia (city)", caps);
    expect(html).toContain("Top beneficiaries");
    expect(html).toContain("Completed");
    expect(html).toContain(`${SITE}/en/company/203740812`);
    expect(html).toContain("Sofia (city)");
  });

  it("escapes ИСУН text, which routinely carries quotes and angle brackets", () => {
    const html = buildFundsTables(
      {
        ...full,
        topBeneficiaries: [
          {
            beneficiaryEik: '123"><script>alert(1)</script>',
            beneficiaryName: 'НК "ЖИ" <b>x</b> & Co',
            contractCount: 1,
            totalEur: 1,
            paidEur: 1,
          },
        ],
      },
      "bg",
      SITE,
      names,
      caps,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&quot;ЖИ&quot;");
    expect(html).toContain("&amp; Co");
  });

  it("honours the per-list caps", () => {
    const many = {
      topBeneficiaries: Array.from({ length: 9 }, (_, i) => ({
        beneficiaryEik: String(i),
        beneficiaryName: `Ф${i}`,
        contractCount: 1,
        totalEur: 1,
        paidEur: 1,
      })),
    };
    const html = buildFundsTables(many, "bg", SITE, names, caps);
    expect((html.match(/<tr><td>/g) ?? []).length).toBe(caps.beneficiaries);
  });

  it("omits a table whose list is empty rather than emitting a bare header", () => {
    const html = buildFundsTables({}, "bg", SITE, names, caps);
    expect(html).toBe("");
  });

  it("survives a partial shard — it runs at module scope, outside any try", () => {
    const partial = {
      statusBreakdown: [
        { status: "signed", rollup: undefined },
        { status: "completed", rollup: { contractCount: 1 } },
      ],
      topBeneficiaries: [{ beneficiaryEik: null, contractCount: 1 }],
      topContracts: [
        { contractNumber: "X-1.001-0001" },
        { title: "no number" },
      ],
      topMunis: [{ muni: "BGS04" }, {}],
    } as unknown as Parameters<typeof buildFundsTables>[0];
    const html = buildFundsTables(partial, "bg", SITE, names, caps);
    // The row missing its rollup / number is dropped; the rest still render.
    expect(html).toContain("Приключени");
    expect(html).toContain("X-1.001-0001");
    expect(html).toContain("Бургас");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });
});

describe("fundsThemeTableRows", () => {
  it("maps the theme shard's eik/name onto the shared shape", () => {
    // The theme builder emits `eik`/`name`; the programme and procedure shards
    // emit `beneficiaryEik`/`beneficiaryName`.
    const rows = fundsThemeTableRows({
      topBeneficiaries: [
        {
          eik: "123456789",
          name: "ЗП",
          contractCount: 373,
          totalEur: 56776539,
          paidEur: 24940884,
        },
      ],
    });
    expect(rows.topBeneficiaries?.[0]).toMatchObject({
      beneficiaryEik: "123456789",
      beneficiaryName: "ЗП",
      contractCount: 373,
    });
  });

  it("tolerates a shard with no lists at all", () => {
    expect(fundsThemeTableRows({})).toEqual({
      topBeneficiaries: [],
      topContracts: undefined,
      topMunis: undefined,
    });
  });
});
