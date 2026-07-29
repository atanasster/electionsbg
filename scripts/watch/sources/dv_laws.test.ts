// Unit tests for the ДВ promulgation watcher — the act classifier and the
// cumulative fingerprint (a rolling one-issue feed must NOT flip back when the
// next issue carries no budget law). No network: fetchText and readState are
// mocked. Runs in the `node` Vitest project (see docs/testing-standards.md).

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../fingerprint", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../fingerprint")>()),
  fetchText: vi.fn(),
}));
vi.mock("../state", () => ({ readState: vi.fn() }));

import { fetchText } from "../fingerprint";
import { readState } from "../state";
import {
  classifyAct,
  dvLaws,
  pendingPackages,
  type DvLawMatch,
} from "./dv_laws";

const mockedFetchText = vi.mocked(fetchText);
const mockedReadState = vi.mocked(readState);

const rss = (date: string, acts: string[]): string =>
  `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>` +
  `<title>junk</title><description>junk</description>` +
  acts
    .map(
      (a) =>
        `<item><title>Народно събрание</title><description>${a}</description>` +
        `<link>materiali.faces?idObj=12605</link>` +
        `<pubDate>${date} 00:00:00.0</pubDate></item>`,
    )
    .join("") +
  `</channel></rss>`;

const issueListHtml = (rows: [number, string][]): string =>
  rows.map(([n, d]) => `<td>Брой ${n}, ${d} г.</td>`).join("");

// Wire both upstreams: RSS first, then the issue list.
const mockUpstreams = (
  date: string,
  acts: string[],
  issues: [number, string][],
): void => {
  mockedFetchText.mockImplementation(async (url: string) =>
    url.includes("rss_newspaper") ? rss(date, acts) : issueListHtml(issues),
  );
};

const prevState = (meta: Record<string, unknown>) =>
  ({
    fingerprint: "seed",
    detail: "seed",
    meta,
    lastChecked: "2026-07-01T00:00:00.000Z",
    lastChanged: "2026-07-01T00:00:00.000Z",
  }) as ReturnType<typeof readState>;

beforeEach(() => {
  vi.resetAllMocks();
  mockedReadState.mockReturnValue(null);
});

describe("classifyAct", () => {
  it("classifies each half of the budget package", () => {
    expect(
      classifyAct("Закон за държавния бюджет на Република България за 2026 г."),
    ).toBe("ЗДБРБ");
    expect(
      classifyAct(
        "Закон за бюджета на държавното обществено осигуряване за 2026 г.",
      ),
    ).toBe("ЗБДОО");
    expect(
      classifyAct(
        "Закон за бюджета на Националната здравноосигурителна каса за 2026 г.",
      ),
    ).toBe("ЗБНЗОК");
  });

  it("classifies the удължителен bridging law", () => {
    expect(
      classifyAct(
        "Закон за събирането на приходи и извършването на разходи през 2026 г. " +
          "до приемането на Закона за държавния бюджет на Република България за 2026 г.",
      ),
    ).toBe("удължителен");
  });

  it("classifies a ЗИД of the state budget law", () => {
    expect(
      classifyAct(
        "Закон за изменение и допълнение на Закона за държавния бюджет на " +
          "Република България за 2022 г.",
      ),
    ).toBe("ЗДБРБ");
  });

  it("rejects a ПМС that merely reallocates money by budget", () => {
    expect(
      classifyAct(
        "Постановление № 90 от 23 юли 2026 г. за одобряване на допълнителни " +
          "разходи по бюджета на държавното обществено осигуряване",
      ),
    ).toBeNull();
  });

  it("rejects unrelated laws", () => {
    expect(
      classifyAct("Закон за изменение и допълнение на Закона за здравето"),
    ).toBeNull();
  });
});

describe("dvLaws.fingerprint", () => {
  it("records the budget laws promulgated in the current issue", async () => {
    mockUpstreams(
      "2026-07-28",
      [
        "Закон за бюджета на държавното обществено осигуряване за 2026 г.",
        "Закон за бюджета на Националната здравноосигурителна каса за 2026 г.",
        "Указ № 236 за награждаване на проф. Петко Станков Чобанов",
      ],
      [
        [68, "28.7.2026"],
        [67, "24.7.2026"],
      ],
    );

    const fp = await dvLaws.fingerprint();
    const matches = (fp.meta as { matches: DvLawMatch[] }).matches;
    expect(matches.map((m) => m.kind)).toEqual(["ЗБДОО", "ЗБНЗОК"]);
    expect(matches[0]).toMatchObject({ issue: 68, date: "2026-07-28" });
    expect(fp.detail).toContain("бр. 68");
    expect(fp.detail).toContain("нови: ЗБДОО, ЗБНЗОК");
    // The real ДВ бр. 68 shape: two fund laws in, ЗДБРБ still out. The missing
    // member must surface so this cannot read as a complete budget.
    expect((fp.meta as { pending: unknown }).pending).toEqual([
      { year: 2026, missing: ["ЗДБРБ"] },
    ]);
    expect(fp.detail).toContain("непълен пакет 2026: липсва ЗДБРБ");
  });

  it("keeps the fingerprint stable when the next issue carries no budget law", async () => {
    mockUpstreams(
      "2026-07-28",
      ["Закон за бюджета на държавното обществено осигуряване за 2026 г."],
      [[68, "28.7.2026"]],
    );
    const first = await dvLaws.fingerprint();

    // Next issue: an ordinary one. The rolling feed no longer shows the ЗБДОО,
    // so a naive per-issue fingerprint would flip back and report a false change.
    mockedReadState.mockReturnValue(prevState(first.meta!));
    mockUpstreams(
      "2026-07-31",
      ["Наредба № 3 от 16 юли 2026 г. за промяна на участие"],
      [
        [69, "31.7.2026"],
        [68, "28.7.2026"],
      ],
    );
    const second = await dvLaws.fingerprint();

    expect(second.value).toBe(first.value);
    expect((second.meta as { matches: DvLawMatch[] }).matches).toHaveLength(1);
  });

  it("flips again when a later issue promulgates another budget law", async () => {
    mockUpstreams(
      "2026-07-28",
      ["Закон за бюджета на държавното обществено осигуряване за 2026 г."],
      [[68, "28.7.2026"]],
    );
    const first = await dvLaws.fingerprint();

    mockedReadState.mockReturnValue(prevState(first.meta!));
    mockUpstreams(
      "2026-07-31",
      ["Закон за държавния бюджет на Република България за 2026 г."],
      [
        [69, "31.7.2026"],
        [68, "28.7.2026"],
      ],
    );
    const second = await dvLaws.fingerprint();

    expect(second.value).not.toBe(first.value);
    expect(
      (second.meta as { matches: DvLawMatch[] }).matches.map((m) => m.kind),
    ).toEqual(["ЗБДОО", "ЗДБРБ"]);
    expect(dvLaws.describe?.(prevState(first.meta!), second)).toContain(
      "ЗДБРБ (ДВ бр. 69 от 2026-07-31)",
    );
  });

  it("records issues that published between runs as permanent gaps", async () => {
    mockedReadState.mockReturnValue(prevState({ lastIssue: 66, matches: [] }));
    mockUpstreams(
      "2026-07-28",
      ["Наредба № 3 от 16 юли 2026 г. за промяна на участие"],
      [[68, "28.7.2026"]],
    );

    const fp = await dvLaws.fingerprint();
    expect((fp.meta as { gaps: number[] }).gaps).toEqual([67]);
    expect(fp.detail).toContain("неинспектирани броеве: 67");
    expect(
      dvLaws.describe?.(prevState({ lastIssue: 66, matches: [] }), fp),
    ).toContain("ДВ бр. 67 published between runs");
  });

  it("does not report a gap on the first run", async () => {
    mockUpstreams(
      "2026-07-28",
      ["Наредба № 3 от 16 юли 2026 г. за промяна на участие"],
      [[68, "28.7.2026"]],
    );
    const fp = await dvLaws.fingerprint();
    expect((fp.meta as { gaps: number[] }).gaps).toEqual([]);
  });

  it("still classifies when the issue list is unreachable", async () => {
    mockedFetchText.mockImplementation(async (url: string) => {
      if (url.includes("rss_newspaper"))
        return rss("2026-07-28", [
          "Закон за държавния бюджет на Република България за 2026 г.",
        ]);
      throw new Error("HTTP 503");
    });

    const fp = await dvLaws.fingerprint();
    const matches = (fp.meta as { matches: DvLawMatch[] }).matches;
    expect(matches.map((m) => m.kind)).toEqual(["ЗДБРБ"]);
    expect(matches[0].issue).toBe(0);
    expect(fp.detail).toContain("бр. ?");
  });

  it("throws rather than silently zeroing when the feed is empty", async () => {
    mockUpstreams("2026-07-28", [], [[68, "28.7.2026"]]);
    await expect(dvLaws.fingerprint()).rejects.toThrow(/no items/);
  });
});

describe("pendingPackages", () => {
  const m = (kind: string, title: string): DvLawMatch => ({
    date: "2026-07-28",
    issue: 68,
    kind,
    title,
  });

  it("flags the missing ЗДБРБ when only the fund laws promulgated", () => {
    expect(
      pendingPackages([
        m(
          "ЗБДОО",
          "Закон за бюджета на държавното обществено осигуряване за 2026 г.",
        ),
        m(
          "ЗБНЗОК",
          "Закон за бюджета на Националната здравноосигурителна каса за 2026 г.",
        ),
      ]),
    ).toEqual([{ year: 2026, missing: ["ЗДБРБ"] }]);
  });

  it("reports nothing once all three package laws are seen", () => {
    expect(
      pendingPackages([
        m(
          "ЗДБРБ",
          "Закон за държавния бюджет на Република България за 2026 г.",
        ),
        m(
          "ЗБДОО",
          "Закон за бюджета на държавното обществено осигуряване за 2026 г.",
        ),
        m(
          "ЗБНЗОК",
          "Закон за бюджета на Националната здравноосигурителна каса за 2026 г.",
        ),
      ]),
    ).toEqual([]);
  });

  it("does not treat the удължителен bridge as a package member", () => {
    // Its title names all three laws, but it is classified удължителен, so the
    // year stays fully pending rather than looking half-satisfied.
    expect(
      pendingPackages([
        m(
          "удължителен",
          "Закон за събирането на приходи и извършването на разходи през 2026 г. до " +
            "приемането на Закона за държавния бюджет на Република България за 2026 г.",
        ),
      ]),
    ).toEqual([]);
  });

  it("derives the year from the title when the field is absent (legacy state)", () => {
    expect(
      pendingPackages([
        {
          date: "2026-07-28",
          issue: 68,
          kind: "ЗБДОО",
          title:
            "Закон за бюджета на държавното обществено осигуряване за 2026 г.",
        },
      ]),
    ).toEqual([{ year: 2026, missing: ["ЗДБРБ", "ЗБНЗОК"] }]);
  });
});

describe("dvLaws.describe — package completeness", () => {
  const seedWith = (pending: { year: number; missing: string[] }[]) =>
    prevState({ matches: [], gaps: [], pending });

  it("calls out a partially-promulgated package as an explicit warning", () => {
    const msg = dvLaws.describe?.(seedWith([]), {
      value: "x",
      detail: "d",
      meta: {
        matches: [],
        gaps: [],
        pending: [{ year: 2026, missing: ["ЗДБРБ"] }],
      },
    });
    expect(msg).toContain("непълен бюджетен пакет за 2026 г.");
    expect(msg).toContain("липсва(т) ЗДБРБ");
    expect(msg).toContain("LAW_DV_MATERIALS");
  });

  it("announces completion when the last missing member lands", () => {
    const msg = dvLaws.describe?.(
      seedWith([{ year: 2026, missing: ["ЗДБРБ"] }]),
      {
        value: "x",
        detail: "d",
        meta: { matches: [], gaps: [], pending: [] },
      },
    );
    expect(msg).toContain("бюджетният пакет за 2026 г. вече е пълен");
  });
});
