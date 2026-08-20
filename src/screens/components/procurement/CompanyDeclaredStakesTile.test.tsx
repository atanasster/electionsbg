// Component tests for the declared-stakes block on /company/:eik.
//
// EVERY ASSERTION HERE IS ABOUT A CLAIM MADE ABOUT A NAMED PERSON, which is what makes this
// tile worth testing at the rendering layer at all. Three of them are the specific ways the
// page it replaces got it wrong:
//
//   • a management ROLE labelled „прехвърлен" — that word describes a share sale, and on a
//     role row table 11 means "held before taking office, not since". The past-tense label is
//     kind-dependent, and getting it backwards publishes a disposal that never happened.
//   • a role rendered under a „дялове" heading — an ownership claim the filing does not make.
//   • a SPOUSE's holding rendered as the office-holder's own — the family arm exists to keep
//     those apart, and the attribution has to survive into the DOM or it has not.
//
// The fixture's field shapes are taken from a real company_declared_stakes() payload (177), so
// a server-side rename shows up here as a failing test rather than as a blank column.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import bg from "@/locales/bg/translation.json";
import en from "@/locales/en/translation.json";
import type {
  DeclaredStakeGroup,
  DeclaredStakesPayload,
} from "./CompanyDeclaredStakesTile";

const dict = bg as Record<string, string>;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "bg" },
    t: (k: string) => dict[k] ?? k,
  }),
}));

const { CompanyDeclaredStakesTile } =
  await import("./CompanyDeclaredStakesTile");

const group = (over: Partial<DeclaredStakeGroup>): DeclaredStakeGroup => ({
  personId: 1,
  slug: "ivan-ivanov-abc123",
  name: "Иван Иванов Иванов",
  stakeKind: "share",
  held: true,
  shareSize: "50%",
  valueEur: 1234.5,
  itemType: null,
  holderIsDeclarant: true,
  holderName: null,
  years: [2023],
  filings: [
    {
      year: 2023,
      institution: "Народно събрание",
      sourceUrl: "https://register.cacbg.bg/2023/A.xml",
    },
  ],
  ...over,
});

const payload = (groups: DeclaredStakeGroup[]): DeclaredStakesPayload => ({
  uic: "125537379",
  groups,
});

const draw = (groups: DeclaredStakeGroup[]) =>
  render(
    <MemoryRouter>
      <CompanyDeclaredStakesTile data={payload(groups)} />
    </MemoryRouter>,
  );

describe("CompanyDeclaredStakesTile — what each row claims", () => {
  it("links the person by slug and shows the size, value and source", () => {
    draw([group({})]);
    const link = screen.getByRole("link", { name: "Иван Иванов Иванов" });
    expect(link).toHaveAttribute("href", "/person/ivan-ivanov-abc123");
    expect(screen.getByText("50%")).toBeInTheDocument();
    // The link's ACCESSIBLE NAME names the document, not the bare year it displays — a
    // screen-reader user hearing "2023" out of context cannot tell two filings apart.
    expect(
      screen.getByRole("link", {
        name: /Декларация · 2023 · Народно събрание/,
      }),
    ).toHaveAttribute("href", "https://register.cacbg.bg/2023/A.xml");
  });

  it("a still-held stake carries no past-tense label", () => {
    draw([group({ held: true })]);
    expect(screen.queryByText(/прехвърлен/)).not.toBeInTheDocument();
    expect(screen.queryByText(/преди встъпване/)).not.toBeInTheDocument();
  });

  it("a released SHARE reads prehvarlen (transferred)", () => {
    draw([group({ held: false, stakeKind: "share" })]);
    expect(screen.getByText(/прехвърлен/)).toBeInTheDocument();
  });

  it("a released ROLE reads before-taking-office, never transferred", () => {
    // The kind-dependent label. „прехвърлен" on a directorship describes a share sale that
    // never happened — the exact mislabel the retired page shipped before the split.
    draw([group({ held: false, stakeKind: "role", shareSize: "Управител" })]);
    expect(screen.getByText(/преди встъпване/)).toBeInTheDocument();
    expect(screen.queryByText(/прехвърлен/)).not.toBeInTheDocument();
  });

  it("a released SOLE TRADERSHIP reads before-taking-office, never transferred", () => {
    // The third kind. Measured: released sole traderships carry a transferee on 0 of 84
    // rows, so „прехвърлен" here describes a disposal the register does not record. Before
    // this test, a not-a-role complement passed the whole suite.
    draw([group({ held: false, stakeKind: "sole_trader", shareSize: null })]);
    expect(screen.getByText(/преди встъпване/)).toBeInTheDocument();
    expect(screen.queryByText(/прехвърлен/)).not.toBeInTheDocument();
  });

  it("a family row with no holder name is still attributed away from the person", () => {
    // The blank-holder case. Gating the attribution on the NAME let this row render with no
    // attribution at all — i.e. as the office-holder's own holding.
    draw([group({ holderIsDeclarant: false, holderName: null })]);
    expect(
      screen.getByText(new RegExp(dict.company_declared_by_other_unnamed)),
    ).toBeInTheDocument();
  });

  it("a group citing no document is not rendered at all", () => {
    const { container } = draw([group({ filings: [] })]);
    expect(container).toBeEmptyDOMElement();
  });

  it("a family row names the holder and is not presented as the person's own", () => {
    draw([
      group({
        holderIsDeclarant: false,
        holderName: "Мария Иванова Иванова",
      }),
    ]);
    expect(screen.getByText(/Мария Иванова Иванова/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(dict.company_declared_by_other)),
    ).toBeInTheDocument();
  });
});

describe("CompanyDeclaredStakesTile — which card a kind lands in", () => {
  it("a ROLE never renders under the stakes heading", () => {
    draw([group({ stakeKind: "role", shareSize: "Управител" })]);
    const stakes = screen.queryByText(
      new RegExp(dict.company_declared_stakes_title),
    );
    expect(stakes).not.toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(dict.company_roles_declared)),
    ).toBeInTheDocument();
  });

  it("a SOLE TRADERSHIP sits with the holdings and is labelled, not silently absorbed", () => {
    // 089's CHECK has three kinds. Counting roles as "not a share" filed every ЕТ under
    // „ръководни длъжности"; an ЕТ is the declarant's own business, so it belongs with the
    // holdings — but it is not a shareholding either, so it says what it is.
    draw([group({ stakeKind: "sole_trader", shareSize: null })]);
    // Asserted WITHOUT scoping by a Tailwind class — a styling change must not break a
    // correctness test. The holdings heading being the only heading present is exactly the
    // claim: the ЕТ landed in that card and nowhere else.
    expect(
      screen.getByText(new RegExp(dict.company_declared_stakes_title)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(dict.company_declared_sole_trader)),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(new RegExp(dict.company_roles_declared)),
    ).not.toBeInTheDocument();
  });

  it("the two cards count their OWN rows, not the payload total", () => {
    draw([
      group({ personId: 1, stakeKind: "share" }),
      group({ personId: 2, stakeKind: "role", shareSize: "Член на СД" }),
      group({ personId: 3, stakeKind: "sole_trader", shareSize: null }),
    ]);
    expect(
      screen.getByText(
        new RegExp(`${dict.company_declared_stakes_title}\\s*\\(\\s*2`),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(`${dict.company_roles_declared}\\s*\\(\\s*1`),
      ),
    ).toBeInTheDocument();
  });
});

describe("CompanyDeclaredStakesTile — the copy has to keep saying the caveat", () => {
  // A COPY-PROPERTY GATE, not a snapshot. These two notes are the only place the reader is
  // told what the block's ABSENCE means and that a role is not a holding. Both are one
  // editorial pass away from being trimmed into something shorter and false, and neither
  // corpus has any other gate on them.
  const both = (k: string) => [
    (bg as Record<string, string>)[k],
    (en as Record<string, string>)[k],
  ];

  it("the stakes note still says an unlinked declaration is not shown", () => {
    for (const copy of both("company_declared_stakes_note")) {
      expect(copy).toBeTruthy();
      // The narrowing: only declarations the registry independently confirms are linked,
      // so absence is not "nobody declared anything".
      expect(copy).toMatch(/Търговски|Commerce Registry/);
      expect(copy).toMatch(/не се показва|not shown/);
    }
  });

  it("the roles note still says a role is not an ownership stake", () => {
    for (const copy of both("company_roles_declared_note")) {
      expect(copy).toBeTruthy();
      expect(copy).toMatch(/не е дялово участие|not an ownership stake/);
    }
  });

  it("no string on this block calls the population MPs", () => {
    // G17: the population is public office-holders of every tier. The ONE permitted mention
    // is the ЗПК чл. 35 clause in the roles note, which is a statement about the law and
    // says so — it is excluded by name rather than by a loose match.
    for (const k of [
      "company_declared_stakes_title",
      "company_declared_stakes_note",
      "company_declared_sole_trader",
      "company_declared_by_other",
      "company_declared_by_other_unnamed",
    ]) {
      for (const copy of both(k)) {
        expect(copy).not.toMatch(/народни представители|\bMPs?\b/);
      }
    }
  });
});

describe("CompanyDeclaredStakesTile — what it refuses to draw", () => {
  it("renders nothing at all when there are no groups", () => {
    // Absence means „nothing survived 096's gates", NOT „nobody declared a stake here".
    // A „0 декларирани дялове" state would assert the second from the first, about a named
    // company, at a 200. It has to be unreachable rather than merely unused.
    const { container } = draw([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("never prints a raw i18n key", () => {
    const { container } = draw([
      group({}),
      group({ personId: 2, stakeKind: "role", shareSize: "Управител" }),
    ]);
    expect(container.textContent).not.toMatch(/company_declared_|stake_role_/);
  });
});
