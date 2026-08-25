// /culture/funds/<arm> — the four source detail pages.
//
// ⚠️ WHAT THIS FILE IS FOR. A reader can land on one of these pages from a
// search result and never see the parent's „these four figures do not sum"
// warning, so the rule has to travel ONTO the page. These assert that it does:
// the basis card states what one row is, how the rows were reached and what the
// arm cannot answer; the cross-arm strip names the other three with the
// non-summation sentence attached; and no total across arms is ever rendered.
//
// Language is driven explicitly rather than left to the harness default, for the
// reason CultureFundsScreen.test.tsx states: the screen branches on
// `i18n.language` and ships both strings by hand, and the default here is `en`,
// so the Bulgarian half is the one that would silently go unchecked.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import type { CultureHubStats } from "@/data/culture/hubStats";
import { CULTURE_FUND_SOURCES } from "./cultureFundSources";

let lang = "en";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: lang }, t: (k: string) => k }),
}));
vi.mock("@/screens/components/procurement/SectorBreadcrumb", () => ({
  SectorBreadcrumb: () => null,
}));
vi.mock("@/ux/Title", () => ({
  Title: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));
/** What the stubbed table hands back to `onData`, and the REQUEST it claims
 *  produced it. `null` = the table never responds (the pre-load state).
 *
 *  ⚠️ The request matters as much as the rows: the head's evidence list is only
 *  a top-N while the table is in its DEFAULT state, so the screen refuses a
 *  response produced by a reader-applied sort, search or filter. A stub that
 *  always sent an empty request could never exercise that. */
let tableResponse: {
  rows: unknown[];
  page?: number;
  request?: Record<string, unknown>;
} | null = null;

// The table is a server-backed component; this file is about the COPY around it
// and the head's derived list, and an unstubbed fetch throws in jsdom.
vi.mock("@/ux/data_table/DbDataTable", () => ({
  DbDataTable: ({
    onData,
  }: {
    onData?: (
      resp: { rows: unknown[]; page: number },
      request: Record<string, unknown>,
    ) => void;
  }) => {
    // ⚠️ IN AN EFFECT, NOT DURING RENDER. `onData` calls `setTop`, so calling it
    // in the render body re-renders the parent, which re-renders this stub,
    // which calls it again — an infinite loop that HANGS the run rather than
    // failing it. The real component invokes it through a ref after a fetch
    // resolves, which is a post-render event; the effect is the closest
    // equivalent. The empty dep array fires it once per mount, which is what a
    // single response is.
    useEffect(() => {
      if (tableResponse && onData)
        onData(
          { rows: tableResponse.rows, page: tableResponse.page ?? 0 },
          tableResponse.request ?? {},
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="table" />;
  },
}));

const STATS: CultureHubStats = {
  generatedAt: "2026-08-25",
  procurement: {
    contracts: 972,
    eur: 166_898_550,
    buyers: 59,
    suppliers: 449,
    singleBid: 281,
    bidKnown: 695,
    nationalSingleBid: 108_766,
    nationalBidKnown: 265_746,
    firstDate: "2011-01-19",
  },
  risk: { grades: {} },
  funds: {
    eikExactEur: 105_920_570,
    eikExactProjects: 47,
    byNameEur: 147_024_687,
    byNameProjects: 1560,
    byNameNames: 1475,
    byNameTopProgram: {
      code: "2021BG-RRP",
      name: "Национален план за възстановяване и устойчивост",
      projects: 1292,
      eur: 117_274_067,
    },
    chitalishtaEur: 22_080_751,
    eikExactAlsoByName: 46,
  },
  agri: { chitalishtaEur: 18_341_814, chitalishtaRows: 264 },
  interreg: {
    thematicEur: 48_807_847,
    partnerRows: 202,
    partners: 168,
    rowsWithEik: 37,
  },
  people: { culturalInstituteRoles: 224 },
};

let statsFixture: CultureHubStats | null = STATS;

vi.mock("@/data/culture/hubStats", () => ({
  useCultureHubStats: () => ({ data: statsFixture, isLoading: false }),
}));

const { CultureFundsSourceScreen } = await import("./CultureFundsSourceScreen");

const mount = (sourceId: string) =>
  render(
    <MemoryRouter initialEntries={[`/culture/funds/${sourceId}`]}>
      <CultureFundsSourceScreen sourceId={sourceId} />
    </MemoryRouter>,
  );

const ARMS = CULTURE_FUND_SOURCES.map((s) => s.id);

describe("CultureFundsSourceScreen", () => {
  beforeEach(() => {
    lang = "en";
    statsFixture = STATS;
    tableResponse = null;
  });

  it.each(ARMS)("renders all three basis lines for %s", (id) => {
    lang = "bg";
    const { container } = mount(id);
    const text = container.textContent ?? "";
    // The three labelled lines, and the third — what the arm cannot answer — is
    // the one that must never be dropped for space.
    // The labels are uppercased by CSS (`uppercase`), so textContent carries the
    // authored casing — asserting the shouted form would pass only by accident.
    expect(text).toContain("Основа");
    expect(text).toContain("Как се стига до тези редове");
    expect(text).toContain("Какво този ред НЕ отговаря");
    const src = CULTURE_FUND_SOURCES.find((s) => s.id === id)!;
    expect(text).toContain(src.basis.bg);
    expect(text).toContain(src.identity.bg);
    expect(text).toContain(src.limit(STATS, "bg").bg);
  });

  it.each(ARMS)("names the other three arms from %s, with the rule", (id) => {
    lang = "bg";
    const { container } = mount(id);
    const text = container.textContent ?? "";
    expect(text).toContain("не се събират");
    for (const other of CULTURE_FUND_SOURCES)
      expect(
        text,
        `${id} does not name ${other.id} — a reader who arrived here from a ` +
          `search result has no route to the other three, and no reason to ` +
          `doubt that this figure is the whole story`,
      ).toContain(other.short.bg);
  });

  it.each(ARMS)("links to the other three and not to itself, from %s", (id) => {
    const { container } = mount(id);
    const hrefs = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    for (const other of CULTURE_FUND_SOURCES)
      if (other.id === id)
        expect(
          hrefs.filter((h) => h === other.to),
          `${id} links to itself in the strip`,
        ).toEqual([]);
      else expect(hrefs).toContain(other.to);
  });

  it.each(ARMS)("never renders a total across arms on %s", (id) => {
    lang = "bg";
    const { container } = mount(id);
    const text = container.textContent ?? "";
    // §0's rule. „общо"/"total" beside four figures is exactly the reading the
    // page family exists to prevent.
    expect(text).not.toMatch(/\bобщо\b/i);
    expect(text).not.toMatch(/\btotal\b/i);
  });

  it("states the programme that dominates the name arm", () => {
    lang = "bg";
    const { container } = mount("isun-name");
    const text = container.textContent ?? "";
    // The finding, not the limit: without it a reader takes €147m for a broad
    // mix of European culture programmes.
    expect(text).toContain("2021BG-RRP");
    // Comma in Bulgarian, point in English — formatPct, never toFixed.
    expect(text).toMatch(/82,8\s*%/);
    expect(text).toMatch(/79,8\s*%/);
  });

  it("says nothing about the top programme when the blob predates the field", () => {
    // The blob ships via bucket:sync, on a different command from the bundle, so
    // this is an ordinary deploy state. An unsupported claim is worse than a
    // missing one.
    statsFixture = {
      ...STATS,
      funds: { ...STATS.funds, byNameTopProgram: undefined },
    };
    lang = "bg";
    const { container } = mount("isun-name");
    expect(container.textContent ?? "").not.toContain("2021BG-RRP");
  });

  it("says nothing about the EIK↔name overlap when the blob predates the field", () => {
    // The trap the field's own contract names: defaulting the absent case to
    // „all of them overlap" publishes „0 of its projects carry no culture word"
    // beside a claim that the arms are not nested.
    statsFixture = {
      ...STATS,
      funds: { ...STATS.funds, eikExactAlsoByName: undefined },
    };
    lang = "bg";
    const { container } = mount("isun-eik");
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/NaN|undefined/);
    expect(text).not.toContain("не се съдържа изцяло");
    // The rest of the limit sentence still stands.
    expect(text).toContain("Само институциите с ЕИК в регистъра");
  });

  it("uses the singular for the one missed project, in both languages", () => {
    // 47 − 46 = 1 today, and the whole finding is that single row. Neither
    // language pluralises by template.
    lang = "bg";
    expect(mount("isun-eik").container.textContent).toContain(
      "един проект от списъка по ЕИК няма културна дума",
    );
    lang = "en";
    expect(mount("isun-eik").container.textContent).toContain(
      "one EIK-listed project carries no culture word in its name",
    );
  });

  it("drops the not-contained clause when the arms turn out to be nested", () => {
    statsFixture = {
      ...STATS,
      funds: {
        ...STATS.funds,
        eikExactAlsoByName: STATS.funds.eikExactProjects,
      },
    };
    lang = "bg";
    const text = mount("isun-eik").container.textContent ?? "";
    expect(text).toContain("Този ред се съдържа изцяло в него");
    expect(text).not.toContain("не се съдържа изцяло");
  });

  it("renders without figures, and without inventing any, before the blob loads", () => {
    // A checkout that never ran the generator, and the first paint of every
    // page. The basis card is static prose and must still be there; a 0 would be
    // a claim.
    statsFixture = null;
    lang = "bg";
    const text = mount("dfz").container.textContent ?? "";
    expect(text).toContain("Основа");
    expect(text).not.toMatch(/NaN|undefined|€0/);
  });

  it("refuses an unknown arm instead of throwing", () => {
    // There is no error boundary anywhere in src/, so an uncaught render throw
    // unmounts the React root and blanks the whole SPA rather than one page.
    lang = "bg";
    expect(() => mount("chitalishta")).not.toThrow();
    expect(mount("chitalishta").container.textContent).toContain(
      "Непознат източник",
    );
  });

  // ── the head's evidence list ─────────────────────────────────────────────
  //
  // Derived from the TABLE's own first page rather than from a second query, so
  // the ranked list and the rows beneath it cannot disagree. That premise holds
  // only in the default state, and these pin the refusals.

  const ISUN_ROWS = [
    {
      contractNumber: "BG-RRP-11.006-0001",
      beneficiaryEik: "130418031",
      beneficiaryName: 'Национален фонд "Култура"',
      title: "Развитие на културния и творческия сектор",
      grantEur: 39_158_424,
      totalEur: 39_158_424,
    },
    {
      contractNumber: "BG-RRP-11.007-0002",
      beneficiaryEik: "130418031",
      beneficiaryName: 'Национален фонд "Култура"',
      title: "Втори проект на същия бенефициент",
      grantEur: 1_700_000,
      totalEur: 1_700_000,
    },
  ];

  it("labels evidence rows by the PROJECT, not by the beneficiary", () => {
    // ⚠️ The rows are a ranking of PROJECTS. Labelled by beneficiary, one body
    // appeared TWICE in the top five with two different figures, under a heading
    // that reads as a recipient ranking — a visible contradiction.
    lang = "bg";
    tableResponse = { rows: ISUN_ROWS };
    const aside = mount("isun-eik").container.querySelector("aside");
    const text = aside?.textContent ?? "";
    expect(text).toContain("Развитие на културния и творческия сектор");
    expect(text).toContain("Втори проект на същия бенефициент");
    // The heading names what a row IS, in the PLAIN plural („проекти"), not the
    // бройна форма („проекта") which needs a numeral in front of it.
    expect(text).toContain("Най-големите проекти");
    expect(text).not.toContain("Най-големите проекта");
  });

  it("links an evidence row to the project, not to the beneficiary's page", () => {
    tableResponse = { rows: ISUN_ROWS };
    const aside = mount("isun-eik").container.querySelector("aside");
    const hrefs = [...(aside?.querySelectorAll("a") ?? [])].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("/funds/contract/BG-RRP-11.006-0001");
    expect(hrefs.some((h) => h?.startsWith("/company/"))).toBe(false);
  });

  it("withdraws the list when the reader sorts, rather than re-ranking it", () => {
    // ⚠️ A sort resets the page index to 0, so a page-only guard passes while the
    // heading still says „Най-големите" and the basis still names the money
    // column. Sorting by a column the server cannot sort (title, scheme) falls
    // through to the bare paging tiebreak and would publish five arbitrary rows
    // as „the largest".
    tableResponse = {
      rows: ISUN_ROWS,
      page: 0,
      request: { sort: [{ id: "totalEur", desc: true }] },
    };
    expect(mount("isun-eik").container.querySelector("aside")).toBeNull();
  });

  it("withdraws the list when a search term is active", () => {
    // The heading is unqualified — „Най-големите", not „най-големите сред
    // намерените".
    tableResponse = {
      rows: ISUN_ROWS,
      page: 0,
      request: { filters: { global: "театър" } },
    };
    expect(mount("isun-eik").container.querySelector("aside")).toBeNull();
  });

  it("withdraws the list when a column filter is active", () => {
    tableResponse = {
      rows: ISUN_ROWS,
      page: 0,
      request: { filters: { columns: [{ id: "program_code", value: ["x"] }] } },
    };
    expect(mount("isun-eik").container.querySelector("aside")).toBeNull();
  });

  it("ignores a response for any page but the first", () => {
    tableResponse = { rows: ISUN_ROWS, page: 1 };
    expect(mount("isun-eik").container.querySelector("aside")).toBeNull();
  });

  it("renders an evidence row with no figure as a dash, never as zero", () => {
    // „€0" is a claim that the amount was zero; the table renders „—" for the
    // same cell, and on Interreg the source distinguishes a published zero from
    // an absence.
    tableResponse = {
      rows: [{ ...ISUN_ROWS[0], grantEur: null }],
    };
    const aside = mount("isun-eik").container.querySelector("aside");
    const text = aside?.textContent ?? "";
    expect(text).toContain("—");
    expect(text).not.toMatch(/€\s*0\b/);
  });

  it("states the ranking basis beside the heading", () => {
    lang = "bg";
    tableResponse = { rows: ISUN_ROWS };
    const text =
      mount("isun-eik").container.querySelector("aside")?.textContent ?? "";
    // „Най-големите" alone is answerable three ways on this arm (grant,
    // contracted, paid).
    expect(text).toContain("по безвъзмездна помощ");
  });
});
