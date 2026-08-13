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

const renderTile = () =>
  render(
    <MemoryRouter>
      <VikContractorHhiTile suppliers={suppliers} totalEur={1000} />
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
