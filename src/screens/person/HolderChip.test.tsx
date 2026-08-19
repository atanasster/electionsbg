// The chip that stopped asserting a family relationship.
//
// `declaration_asset.is_spouse` is named for the form's dominant case but proves only „not
// the declarant" — a minor child's and a cohabiting partner's holdings are filed on the
// same form. Seven surfaces rendered it as „съпруг/а", i.e. a claim about a named public
// figure's family that the data does not establish; on /mp-cars and /declarations/crypto it
// was the VALUE of a column headed „Притежател".
//
// What is under test is the distinction: print the register's own holder NAME when there is
// one, and a neutral label when there is not — never a relationship.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { HolderChip } from "./HolderChip";

describe("HolderChip", () => {
  it("renders nothing when the row is the declarant's own", () => {
    const { container } = render(
      <HolderChip asset={{ isSpouse: false, holderName: "Иван Петров" }} />,
    );
    // Not even an empty span: a chip on every row makes the marker meaningless.
    expect(container).toBeEmptyDOMElement();
  });

  it("names the holder the register named", () => {
    render(
      <HolderChip
        asset={{ isSpouse: true, holderName: "Теодора Стоянова Копринкова" }}
      />,
    );
    expect(screen.getByText("Теодора Стоянова Копринкова")).toBeInTheDocument();
    // The relationship claim is what this component exists to remove.
    expect(screen.queryByText("pp_decl_spouse")).not.toBeInTheDocument();
  });

  it("falls back to a neutral label, never to a relationship", () => {
    // /mp-cars and /declarations/crypto carry the flag and no name at all.
    render(<HolderChip asset={{ isSpouse: true, holderName: null }} />);
    expect(screen.getByText("pp_decl_holder_other")).toBeInTheDocument();
  });

  it("treats a blank holder name as no name", () => {
    // The register's holder cell is free text and is sometimes whitespace; rendering it
    // would produce an empty chip that reads as a rendering bug.
    render(<HolderChip asset={{ isSpouse: true, holderName: "   " }} />);
    expect(screen.getByText("pp_decl_holder_other")).toBeInTheDocument();
  });

  it("works on a payload that never selected holderName", () => {
    render(<HolderChip asset={{ isSpouse: true }} />);
    expect(screen.getByText("pp_decl_holder_other")).toBeInTheDocument();
  });
});
