import { describe, it, expect } from "vitest";
import {
  beneficiaryItemList,
  buildFundsTables,
  buildFundsDescription,
  compactEur,
  fundsThemeTableRows,
  topBeneficiaryNames,
} from "./fundsTables";

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

describe("compactEur", () => {
  it("shortens to what a title has room for", () => {
    expect(compactEur(2228915357, "bg")).toBe("€2.23 млрд.");
    expect(compactEur(2228915357, "en")).toBe("€2.23bn");
    expect(compactEur(111180402, "bg")).toBe("€111.2 млн.");
    expect(compactEur(25520, "en")).toBe("€26k");
    expect(compactEur(0, "bg")).toBe("€0");
  });

  it("picks the rung after rounding, not before", () => {
    // A round-then-classify order emitted "€1000 хил." and "€1000.0m" — the
    // overflow is at the rung's own rounding boundary, not at .6 of it.
    expect(compactEur(999600, "bg")).toBe("€1.0 млн.");
    expect(compactEur(999600, "en")).toBe("€1.0m");
    expect(compactEur(999960000, "en")).toBe("€1.00bn");
    expect(compactEur(999600000, "en")).toBe("€999.6m");
  });
});

describe("topBeneficiaryNames", () => {
  const mk = (amounts: number[]) => ({
    topBeneficiaries: amounts.map((totalEur, i) => ({
      beneficiaryEik: String(i),
      beneficiaryName: `Ф${i}`,
      contractCount: 1,
      totalEur,
      paidEur: totalEur,
    })),
  });

  it("names the leaders of a varied scheme", () => {
    expect(topBeneficiaryNames(mk([900, 500, 100, 50]), 3)).toEqual([
      "Ф0",
      "Ф1",
      "Ф2",
    ]);
  });

  it("says nothing about a flat scheme", () => {
    // BG16RFOP002-2.089 paid all 4,356 beneficiaries exactly €25,520, so the
    // "largest recipients" were just the alphabetical tie-break — arbitrary
    // names presented as a finding.
    expect(topBeneficiaryNames(mk([25520, 25520, 25520, 25520]), 3)).toEqual(
      [],
    );
  });

  it("says nothing about a near-flat scheme either", () => {
    // BG-RRP-1.014's top four span €0.46 on €1.77M. An exact-equality test
    // called that varied and published the tie-break as a finding — the same
    // defect as 2.089, one decimal place down.
    expect(
      topBeneficiaryNames(
        mk([1770530.68, 1770530.67, 1770530.27, 1770530.22]),
        3,
      ),
    ).toEqual([]);
  });

  it("suppresses a tie at a grant cap for the same reason", () => {
    // Naming three of four recipients all pinned to the €200k ceiling reports
    // the sort order, not a fact about them.
    expect(
      topBeneficiaryNames(mk([200000, 200000, 200000, 200000]), 3),
    ).toEqual([]);
  });

  it("ranks when the leader is materially clear of the field", () => {
    expect(topBeneficiaryNames(mk([500, 495, 490, 400]), 3)).toEqual([
      "Ф0",
      "Ф1",
      "Ф2",
    ]);
  });

  it("returns [] when there are no beneficiaries at all", () => {
    expect(topBeneficiaryNames({}, 3)).toEqual([]);
  });
});

describe("buildFundsDescription", () => {
  const opts = {
    lead: "процедура X (Програма Y)",
    contracts: 4356,
    beneficiaries: 4356,
    totalEur: 111180402,
    paidEur: 111180402,
    names: ["Алфа ЕООД", "Бета АД"],
  };

  it("leads with the question and puts the names before the figures", () => {
    const d = buildFundsDescription("bg", opts);
    expect(d.startsWith("Кой получи парите по")).toBe(true);
    expect(d).toContain("€111.2 млн.");
    // The names are the point of the rewrite, so they must land early enough to
    // survive Google's truncation — behind the figures they began past 160.
    expect(d.indexOf("Алфа ЕООД")).toBeLessThan(120);
    expect(d.indexOf("Алфа ЕООД")).toBeLessThan(d.indexOf("€111.2 млн."));
  });

  it("omits the recipients clause when there is nothing honest to say", () => {
    const d = buildFundsDescription("bg", { ...opts, names: [] });
    expect(d).not.toContain("Най-големи получатели");
    expect(d).toContain("по данни от ИСУН 2020.");
  });

  it("agrees with the noun on a count of one", () => {
    const d = buildFundsDescription("bg", {
      ...opts,
      contracts: 1,
      beneficiaries: 1,
    });
    expect(d).toContain("1 договор на 1 бенефициент,");
    const en = buildFundsDescription("en", {
      ...opts,
      contracts: 1,
      beneficiaries: 1,
    });
    expect(en).toContain("1 contract across 1 beneficiary,");
  });
});

describe("beneficiaryItemList", () => {
  const mk = (amounts: number[]) => ({
    topBeneficiaries: amounts.map((totalEur, i) => ({
      beneficiaryEik: String(100000000 + i),
      beneficiaryName: `Ф${i}`,
      contractCount: 1,
      totalEur,
      paidEur: totalEur,
    })),
  });
  const URL = "https://electionsbg.com/funds/programme/X";

  it("states the ranking as Organizations with their EIK", () => {
    const [list] = beneficiaryItemList(mk([900, 500, 100]), URL) as [
      {
        numberOfItems: number;
        itemListOrder: string;
        itemListElement: Array<{
          position: number;
          item: { name: string; identifier?: string; url?: string };
        }>;
      },
    ];
    expect(list.numberOfItems).toBe(3);
    expect(list.itemListOrder).toContain("Descending");
    expect(list.itemListElement[0].position).toBe(1);
    expect(list.itemListElement[0].item.name).toBe("Ф0");
    expect(list.itemListElement[0].item.identifier).toBe("100000000");
  });

  it("emits nothing for a flat scheme", () => {
    // A structured ItemList asserting a "position" over four identical amounts
    // is a STRONGER claim than the prose version, not a weaker one.
    expect(beneficiaryItemList(mk([25520, 25520, 25520, 25520]), URL)).toEqual(
      [],
    );
  });

  it("emits nothing when there are no beneficiaries", () => {
    expect(beneficiaryItemList({}, URL)).toEqual([]);
  });

  it("points at /en/company for the English page", () => {
    const [list] = beneficiaryItemList(mk([900, 500, 100]), URL, "en") as [
      { itemListElement: Array<{ item: { url?: string } }> },
    ];
    expect(list.itemListElement[0].item.url).toBe("/en/company/100000000");
  });
});
