// The two accountability cells. Every assertion here is an EDITORIAL rule from the plan
// (§3, §9), not a styling preference — each one is a statement the page makes about a
// named living person, and getting it wrong is the difference between a caveated figure
// and an unqualified accusation.

import { render, screen } from "@testing-library/react";
import { describe, test, expect } from "vitest";
import { PersonNetWorthCell, PersonMoneyCell } from "./PersonMoneyCells";
import type { PersonBrowseRow } from "@/data/persons/personBrowseTypes";

const row = (over: Partial<PersonBrowseRow>): PersonBrowseRow =>
  ({
    slug: "x",
    name: "Тест",
    hasDeclaration: false,
    netWorthEur: null,
    excludedAssetRows: 0,
    publicMoneyEur: null,
    trLinkBasis: null,
    ...over,
  }) as PersonBrowseRow;

describe("PersonNetWorthCell", () => {
  test("distinguishes 'filed, nothing of value' from 'nothing on record'", () => {
    // Both render a dash — the two facts are very different and the reader has to be able
    // to tell them apart, which is what the tooltip carries.
    const filed = render(
      <PersonNetWorthCell row={row({ hasDeclaration: true })} />,
    );
    expect(
      filed.container.querySelector("[title]")?.getAttribute("title"),
    ).toMatch(/без декларирано имущество/);

    const none = render(
      <PersonNetWorthCell row={row({ hasDeclaration: false })} />,
    );
    expect(
      none.container.querySelector("[title]")?.getAttribute("title"),
    ).toMatch(/Няма декларация/);
  });

  test("marks an INCOMPLETE total with an asterisk", () => {
    // excludedAssetRows > 0 means the figure understates the person's wealth by an unknown
    // amount. Presenting it bare asserts a precision that does not exist.
    render(
      <PersonNetWorthCell
        row={row({
          hasDeclaration: true,
          netWorthEur: 250000,
          excludedAssetRows: 2,
        })}
      />,
    );
    const sup = screen.getByText("*");
    expect(sup).toBeInTheDocument();
    expect(sup.getAttribute("title")).toMatch(/Непълна сума/);
  });

  test("a complete total carries no asterisk", () => {
    render(
      <PersonNetWorthCell
        row={row({ hasDeclaration: true, netWorthEur: 250000 })}
      />,
    );
    expect(screen.queryByText("*")).toBeNull();
  });

  test("renders a blank cell if the amount ever arrives as a STRING", () => {
    // The regression this guards, exercised the way it actually happens: PG `numeric` is
    // serialized by node-postgres as "250000.00", the formatter cannot multiply a string,
    // and the cell renders empty while the API response looks perfectly correct. The type
    // says number; the wire said otherwise. Casting through unknown is the point — a test
    // that passes a number cannot fail for the reason it documents.
    const { container } = render(
      <PersonNetWorthCell
        row={row({
          hasDeclaration: true,
          netWorthEur: "250000.00" as unknown as number,
        })}
      />,
    );
    expect(
      container.textContent?.trim(),
      "a string amount rendered blank — 120's money columns must be double precision, not numeric",
    ).toMatch(/\d/);
  });

  test("a NEGATIVE net worth puts the sign before the currency symbol", () => {
    // 22% of declared net worths are negative (liabilities over valued assets), and the
    // column is sortable, so one header click puts them at the top. "€-47 млн." is
    // malformed; the reader also needs to know a negative here is a real state, not a bug.
    const { container } = render(
      <PersonNetWorthCell
        row={row({ hasDeclaration: true, netWorthEur: -47_000_000 })}
      />,
    );
    expect(container.textContent).toMatch(/−/);
    expect(container.textContent).not.toMatch(/€-/);
    expect(container.querySelector("[title]")?.getAttribute("title")).toMatch(
      /задължения|liabilities/,
    );
  });

  test("zero is a figure, not an empty state", () => {
    const { container } = render(
      <PersonNetWorthCell
        row={row({ hasDeclaration: true, netWorthEur: 0 })}
      />,
    );
    expect(container.textContent?.trim()).not.toBe("—");
  });
});

describe("PersonMoneyCell", () => {
  test("a name-matched footprint carries the namesake caveat TEXT", () => {
    // Asserted on the words, not on a Tailwind class: person_namesake_disclosure is the one
    // string here with no defaultValue, so a renamed key would leave the literal key in the
    // tooltip and a class-based assertion would still pass.
    const { container } = render(
      <PersonMoneyCell
        row={row({ publicMoneyEur: 1_000_000, trLinkBasis: "name_match" })}
      />,
    );
    expect(screen.getByText("?")).toBeInTheDocument();
    expect(container.querySelector("[title]")?.getAttribute("title")).toMatch(
      /еднакво име|same name/,
    );
  });

  test("a NULL basis is treated as name-matched, not as declared", () => {
    // The fail-safe direction: an unknown provenance must caveat, never reassure.
    render(
      <PersonMoneyCell
        row={row({ publicMoneyEur: 5_000, trLinkBasis: null })}
      />,
    );
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  test("the caveat marker is reachable without a mouse", () => {
    render(
      <PersonMoneyCell
        row={row({ publicMoneyEur: 1_000_000, trLinkBasis: "name_match" })}
      />,
    );
    const marker = screen.getByText("?");
    expect(marker).toHaveAttribute("tabIndex", "0");
    expect(marker.getAttribute("aria-label")).toMatch(
      /личен доход|personal income/,
    );
  });

  test("a MIXED footprint carries it too — one curated company does not clear the rest", () => {
    // The bug this pins: collapsing 'mixed' into 'declared' drops the warning from money
    // that is partly name-derived.
    render(
      <PersonMoneyCell
        row={row({ publicMoneyEur: 1_000_000, trLinkBasis: "mixed" })}
      />,
    );
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  test("a fully declared footprint shows no namesake caveat", () => {
    const { container } = render(
      <PersonMoneyCell
        row={row({ publicMoneyEur: 1_000_000, trLinkBasis: "declared" })}
      />,
    );
    expect(screen.queryByText("?")).toBeNull();
    expect(container.querySelector(".border-dotted")).toBeNull();
  });

  test("always says the figure is the COMPANY's, not personal income", () => {
    const { container } = render(
      <PersonMoneyCell
        row={row({ publicMoneyEur: 1_000_000, trLinkBasis: "declared" })}
      />,
    );
    expect(container.querySelector("[title]")?.getAttribute("title")).toMatch(
      /не е личен доход/,
    );
  });

  test("no money distinguishes 'companies won nothing' from 'no companies'", () => {
    // 9,633 people hold companies that won nothing; ~46,100 hold none. §9 forbids one
    // column rendering two different facts identically.
    const won = render(<PersonMoneyCell row={row({ companiesN: 3 })} />);
    expect(
      won.container.querySelector("[title]")?.getAttribute("title"),
    ).toMatch(/не са печелили|won no public contracts/);

    const none = render(<PersonMoneyCell row={row({ companiesN: 0 })} />);
    expect(
      none.container.querySelector("[title]")?.getAttribute("title"),
    ).toMatch(/Няма свързани фирми|No linked companies/);

    expect(screen.queryByText("?")).toBeNull();
  });
});
