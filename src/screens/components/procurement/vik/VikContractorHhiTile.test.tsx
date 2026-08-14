// This tile serves BOTH water universes — the holding group on
// /awarder/206086428 and the whole sector on /water — and unlike
// VikSubsidiaryTile it is handed suppliers rather than operators, so it has no
// way to tell which one it is rendering.
//
// That makes universe-neutral copy the only correct option, and it is a property
// worth a test rather than a comment: the Bulgarian caption was corrected to drop
// "на групата" while the English one kept "the group's contracted value", so for
// one commit /water asserted in English that a Veolia concession, an irrigation
// enterprise, a dams enterprise and 14 municipal operators were companies in
// Български ВиК холдинг. A caption cannot be checked in one language.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VikContractorHhiTile } from "./VikContractorHhiTile";

let lang = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: {
      get language() {
        return lang;
      },
    },
  }),
}));

const suppliers = [
  { name: "Изпълнител А", eik: "111111111", totalEur: 600, contractCount: 4 },
  { name: "Изпълнител Б", eik: "222222222", totalEur: 300, contractCount: 2 },
  { name: "Изпълнител В", eik: "333333333", totalEur: 100, contractCount: 1 },
];

const renderTile = (memberEiks?: string[]) =>
  render(
    <MemoryRouter>
      <VikContractorHhiTile
        suppliers={suppliers}
        totalEur={1000}
        memberEiks={memberEiks}
      />
    </MemoryRouter>,
  );

describe.each(["bg", "en"])("VikContractorHhiTile copy — %s", (l) => {
  it("never attributes the contracted value to a holding GROUP", () => {
    lang = l;
    const { container } = renderTile();
    // It cannot know which universe it is in, so it may not name one.
    expect(container.textContent).not.toMatch(
      /на групата|the group's|in the group/,
    );
  });

  it("still explains what the index is computed over", () => {
    lang = l;
    renderTile();
    expect(
      screen.getAllByText(
        l === "bg" ? /договорената стойност/ : /contracted value/,
      ).length,
    ).toBeGreaterThan(0);
  });
});

// The in-group label. A contractor that is itself a member of the sector is the
// state paying its own company — /sector/transport's top „изпълнител" is
// БДЖ-Пътнически превози at €980.6M, 13.5% of the sector, which is the ministry's
// rail PSO and not a supplier won on any market. Unlabelled it reads as a private
// vendor topping the sector.
//
// ⚠ Note the tension with the universe-neutrality tests above, which exist because
// this tile cannot know which universe it is rendering. The badge does assert
// membership — but only for EIKs the CALLER passed in, so the claim is the
// caller's, not the tile's. With no memberEiks the tile must stay exactly as
// neutral as it was, which is the first test here.
const IN_GROUP = /в групата|in-group/i;

describe.each(["bg", "en"])("VikContractorHhiTile in-group label — %s", (l) => {
  it("says nothing about groups when the caller passes no member set", () => {
    lang = l;
    const { container } = renderTile();
    expect(container.textContent).not.toMatch(IN_GROUP);
  });

  it("labels only the rows that are members, and explains the label", () => {
    lang = l;
    const { container } = renderTile(["222222222"]);
    // ONE of the three suppliers is a member, so exactly one badge. The count is
    // the assertion — "at least one" would pass if every row were badged, which
    // is the failure that would make the label meaningless.
    expect(screen.getAllByText(l === "bg" ? "в групата" : "in-group")).toHaveLength(1); // prettier-ignore
    // …and the badge sits on that member's row, not just anywhere in the tile.
    const badge = screen.getByText(l === "bg" ? "в групата" : "in-group");
    expect(badge.parentElement?.textContent).toContain("Изпълнител Б");
    // The footnote fires with it and says what the label means.
    expect(container.textContent).toMatch(
      l === "bg"
        ? /плаща на собственото си дружество/
        : /paying its own company/,
    );
  });

  it("shows no footnote when no displayed row is a member", () => {
    lang = l;
    // A member that exists but is not in the top-8 must not drag the note in —
    // /water is exactly this case (БВХ is a member, below the display cutoff).
    const { container } = renderTile(["999999999"]);
    expect(container.textContent).not.toMatch(IN_GROUP);
    expect(container.textContent).not.toMatch(
      l === "bg"
        ? /плаща на собственото си дружество/
        : /paying its own company/,
    );
  });

  it("does not smuggle a holding-group claim back in via the new copy", () => {
    lang = l;
    const { container } = renderTile(["222222222"]);
    // The same guard the copy tests above enforce — the label must not become a
    // statement that these contractors belong to a HOLDING.
    expect(container.textContent).not.toMatch(
      /на групата|the group's|in the group/,
    );
  });
});
