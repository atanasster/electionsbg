// Guard for the clean-delivery marks on the EU-funds project list.
//
// WHY THIS FILE EXISTS. ИСУН publishes which EU-funded contracts finished with NO
// financial correction imposed. It publishes no complement — individual
// irregularities go to OLAF's IMS, which is confidential — and a project can be
// absent from the register because it finished late, was terminated, or is still
// in verification. So marking 2 of 4 projects must never read as „the other 2 were
// corrected", which is an accusation against a named company and the exact defect
// `CompanyCleanDeliveryTile` was rewritten to remove. The badge↔caveat coupling is
// what prevents it here, and before this file nothing held it: any edit that moved
// the footnote inside `{projects.length > 0 && …}`, reordered the JSX, or narrowed
// its gate would have shipped green.
//
// Two gates are separate on purpose and both are tested:
//   • the BADGE clause needs a badge on screen;
//   • the ABSENCE clause must render whenever the register was consulted at all —
//     including when none of its contracts reached this preview, which is the
//     6 LARGEST by contracted value and so uncorrelated with clean status.
//
// Hermetic: `t` is stubbed, `i18n.language` is pinned (the tile branches on it),
// and the tile renders `<Link>`, so every render goes through a MemoryRouter.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  CompanyFundsTile,
  type CompanyFunds,
  type FundProjectRow,
} from "./CompanyFundsTile";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

const CAVEAT_BG =
  "Отсъствието от този списък НЕ означава наложена финансова корекция — " +
  "проектът може да е приключил със закъснение, да е прекратен или още да е в проверка. " +
  "Индивидуалните нередности се докладват в системата IMS на OLAF и не са публични.";

const funds: CompanyFunds = {
  name: "БУЛГЕД ООД",
  org_type: "Компания",
  contract_count: 4,
  contracted_eur: 1185450,
  paid_eur: 720123,
};

const project = (
  contract_number: string,
  title: string,
  total_eur = 100000,
): FundProjectRow => ({
  contract_number,
  title,
  program_name: "Иновации и конкурентоспособност",
  total_eur,
  paid_eur: total_eur / 2,
  status: "Приключен (към датата на приключване)",
  duration_months: 12,
});

const PROJECTS = [
  project("BG16RFOP002-2.001-0450", "Подобряване на производствения капацитет"),
  project("BG-RRP-3.008-0282", "Подкрепа за прехода към кръгова икономика"),
  project("BG16RFOP002-2.083-0185", "Ваучерна схема за ИКТ услуги"),
];

const draw = (
  cleanContracts?: ReadonlySet<string> | null,
  absenceMeaning: string | null = CAVEAT_BG,
) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <CompanyFundsTile
          eik="130714137"
          funds={funds}
          projects={PROJECTS}
          cleanContracts={cleanContracts}
          absenceMeaning={absenceMeaning}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );

// Scoped to the ROW badges: the hover card carries its own presence line, and a
// bare text query would count both.
const badges = () =>
  screen.queryAllByText("без корекция").filter((e) => e.tagName === "SPAN");

describe("CompanyFundsTile — clean-delivery marks", () => {
  it("marks exactly the projects ИСУН names, and no others", () => {
    draw(new Set(["BG-RRP-3.008-0282"]));
    expect(badges()).toHaveLength(1);
    const marked = badges()[0].closest("li") as HTMLElement;
    expect(marked.innerHTML).toContain("BG-RRP-3.008-0282");
    expect(marked.innerHTML).not.toContain("BG16RFOP002-2.001-0450");
  });

  it("renders the absence caveat whenever any mark renders", () => {
    // The invariant. A badge without it turns the two unmarked rows into the
    // register's negative space.
    draw(new Set(["BG-RRP-3.008-0282"]));
    expect(badges().length).toBeGreaterThan(0);
    expect(
      screen.getByText(/НЕ означава наложена финансова корекция/),
    ).toBeInTheDocument();
  });

  it("renders the caveat verbatim from the register, OLAF clause included", () => {
    // Passed, not restated: the same sentence renders on CompanyCleanDeliveryTile
    // from the same column, and the first draft of a local literal here silently
    // dropped the clause explaining why no complement exists anywhere.
    draw(new Set(["BG-RRP-3.008-0282"]));
    expect(screen.getByText(new RegExp("IMS на OLAF"))).toBeInTheDocument();
  });

  it("renders the caveat even when NO mark landed in this preview", () => {
    // ⚠️ The reachable state the narrower gate missed: the list is the 6 LARGEST
    // projects and „largest" has nothing to do with „clean", so a company whose
    // clean contracts are all small shows only unmarked rows here while the
    // clean-delivery tile names those contracts elsewhere on the page.
    draw(new Set(["BG05M9OP001-4.001-0126"]));
    expect(badges()).toHaveLength(0);
    expect(
      screen.getByText(/НЕ означава наложена финансова корекция/),
    ).toBeInTheDocument();
    // …but the clause that explains a badge is withheld, since none is on screen.
    expect(
      screen.queryByText(/„Без корекция“ идва от/),
    ).not.toBeInTheDocument();
  });

  it("renders no badge and no caveat when the register was not consulted", () => {
    // A payload from a database whose 175 predates the rewrite, or a company in
    // neither register. Saying nothing is correct; a caveat with nothing to bound
    // raises a question the page has not posed.
    draw(undefined);
    expect(badges()).toHaveLength(0);
    expect(
      screen.queryByText(/НЕ означава наложена финансова корекция/),
    ).not.toBeInTheDocument();
  });

  it("treats an empty Set as 'not consulted', not as 'named nothing'", () => {
    // The two are indistinguishable on screen, which is why cleanContractNumbersOf
    // returns undefined rather than an empty Set — see its own test.
    draw(new Set());
    expect(badges()).toHaveLength(0);
    expect(
      screen.queryByText(/НЕ означава наложена финансова корекция/),
    ).not.toBeInTheDocument();
  });

  it("never publishes a count or ratio of marked rows", () => {
    // The subtraction guard, stated as an assertion: „1 от 3" invites 3 − 1 = 2
    // corrected, which inverts the register.
    const { container } = draw(new Set(["BG-RRP-3.008-0282"]));
    expect(container.textContent).not.toMatch(
      /\b1\s*(от|of|\/)\s*3\b|отбелязан[аи]?\s*\d|\d+\s*marked/i,
    );
  });

  it("keeps the badge outside the clamped title box", () => {
    // Inline at the end of `line-clamp-2`, a two-line title pushes the badge to
    // line three and clips it away — leaving a caveat about a mark nobody can see,
    // and a clean project rendered identically to an unmarked one.
    draw(new Set(["BG-RRP-3.008-0282"]));
    const badge = badges()[0];
    expect(badge.closest(".line-clamp-2")).toBeNull();
  });

  it("ties each badge to the sentence that bounds it", () => {
    // Sighted readers get the pairing by proximity; a screen reader gets it only
    // if the caveat is reachable from the badge.
    draw(new Set(["BG-RRP-3.008-0282"]));
    const describedBy = badges()[0].getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toMatch(
      /НЕ означава наложена финансова корекция/,
    );
  });

  it("falls back to a local sentence rather than leaving the marks unbounded", () => {
    // A database with no coverage row must not produce badges with no caveat.
    draw(new Set(["BG-RRP-3.008-0282"]), null);
    expect(badges().length).toBeGreaterThan(0);
    expect(
      screen.getByText(/НЕ означава наложена финансова корекция/),
    ).toBeInTheDocument();
  });
});
