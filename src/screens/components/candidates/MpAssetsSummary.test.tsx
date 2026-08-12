// The unvalued-items list is capped at 12 with the rest one click away. Two things are
// being guarded, and only one of them is about the cap:
//
//   1. The overflow is INTERACTIVE. It used to be `<li className="italic">+3 още</li>` —
//      no button, no handler — so the only route to the remaining items was the card's
//      "Виж детайли" link to a different page, even though every item was already in the
//      rollup this component had in hand.
//   2. The label is composed by i18next, not concatenated. `+{n} {t("mp_assets_more")}`
//      rendered "+3 още" in Bulgarian: the count outside the phrase, the word order wrong,
//      and no way for a translator to fix either. The count now sits inside a plural key.
//
// Hermetic: both data hooks stubbed, so this exercises the render and nothing else.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { MpAsset, MpAssetsRollup } from "@/data/dataTypes";

const mpAssets = vi.fn();
const mpDeclarations = vi.fn();

vi.mock("@/data/parliament/useMpAssets", () => ({
  useMpAssets: () => mpAssets(),
}));
vi.mock("@/data/parliament/useMpDeclarations", () => ({
  useMpDeclarations: () => mpDeclarations(),
}));
// Return the key plus a readable rendering of `count`, so a test can tell
// "mp_assets_show_more with count 3" from "with count 15" without loading real bundles.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "count" in o ? `${k}:${o.count}` : k,
    i18n: { language: "bg" },
  }),
}));

import { MpAssetsSummary } from "./MpAssetsSummary";

const SOURCE_URL = "https://register.cacbg.bg/2024/x.xml";

const asset = (i: number): MpAsset =>
  ({
    category: "real_estate",
    description: `имот ${i}`,
    detail: null,
    location: "София",
    municipality: null,
    areaSqm: null,
    acquiredYear: null,
    share: null,
    valueEur: null, // unvalued — the list under test
    amount: null,
    currency: null,
    isSpouse: false,
  }) as unknown as MpAsset;

// The component iterates a fixed category ORDER and reads `.count` off each, so every
// category must be present even at zero — an empty map throws rather than rendering an
// empty breakdown.
const EMPTY_BY_CATEGORY = Object.fromEntries(
  [
    "real_estate",
    "vehicle",
    "cash",
    "bank",
    "receivable",
    "debt",
    "investment",
    "security",
  ].map((c) => [c, { count: 0, valuedCount: 0, totalEur: 0 }]),
);

const DEFAULT_NAME = "Сергей Дмитриевич Станишев";

/** Point the two hooks at one person's filing. Separate from `setup` so a test can swap the
 *  person on a LIVE instance — the cached back/forward navigation that has no remount. */
const mockPerson = (
  personName: string,
  unvaluedCount: number,
  sourceUrl = SOURCE_URL,
) => {
  mpAssets.mockReturnValue({
    rollup: {
      mpId: 868,
      name: personName,
      latestDeclarationYear: 2024,
      fiscalYear: 2024,
      declarationType: "Vacate",
      sourceUrl,
      totalAssetsEur: 0,
      totalDebtsEur: 0,
      netWorthEur: 0,
      previous: null,
      byCategory: EMPTY_BY_CATEGORY,
    } as unknown as MpAssetsRollup,
    isLoading: false,
  });
  mpDeclarations.mockReturnValue({
    declarations: [
      {
        declarantName: personName,
        sourceUrl,
        assets: Array.from({ length: unvaluedCount }, (_, i) => asset(i)),
        income: [],
        ownershipStakes: [],
        events: [],
      },
    ],
    isLoading: false,
  });
};

const card = (personName = DEFAULT_NAME, linkSlug = "mp-868") => (
  <MemoryRouter>
    <MpAssetsSummary name={personName} linkSlug={linkSlug} />
  </MemoryRouter>
);

const setup = (unvaluedCount: number) => {
  mockPerson(DEFAULT_NAME, unvaluedCount);
  return render(card());
};

beforeEach(() => {
  mpAssets.mockReset();
  mpDeclarations.mockReset();
});

describe("MpAssetsSummary — unvalued items", () => {
  it("shows all of them and no toggle when they fit under the cap", () => {
    setup(12);
    expect(screen.getByText("имот 11 · София")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /mp_assets_show_more/ }),
    ).not.toBeInTheDocument();
  });

  it("caps the list and offers the remainder as a BUTTON carrying the count", async () => {
    setup(15);
    // Capped at 12: the 13th is absent…
    expect(screen.getByText("имот 11 · София")).toBeInTheDocument();
    expect(screen.queryByText("имот 12 · София")).not.toBeInTheDocument();

    // …behind a real control, not an italic dead line. The count is INSIDE the phrase —
    // `mp_assets_show_more:3`, not a "+3" glued onto a bare word.
    const more = screen.getByRole("button", { name: "mp_assets_show_more:3" });
    expect(more).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(more);

    // Everything, and nothing was refetched to get it — the items were in the rollup all
    // along, which is why the dead line was worth replacing rather than linking away from.
    expect(screen.getByText("имот 12 · София")).toBeInTheDocument();
    expect(screen.getByText("имот 14 · София")).toBeInTheDocument();

    const less = screen.getByRole("button", { name: "mp_assets_show_less" });
    expect(less).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(less);
    expect(screen.queryByText("имот 12 · София")).not.toBeInTheDocument();
  });

  it("passes count=1 when exactly one item overflows", () => {
    // 13 items = 12 shown + 1 hidden. The `_one` branch is where a missing singular form
    // would surface first, and it is unreachable from the count=3 case above.
    setup(13);
    expect(
      screen.getByRole("button", { name: "mp_assets_show_more:1" }),
    ).toBeInTheDocument();
  });

  it("points aria-controls at the list it expands", () => {
    const { container } = setup(15);
    const btn = screen.getByRole("button", { name: "mp_assets_show_more:3" });
    const id = btn.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    // The relationship must resolve to a real node, and to the list whose contents change —
    // an aria-controls pointing at nothing is worse than none, because it asserts a
    // relationship a screen reader will try to follow.
    expect(container.querySelector(`#${id}`)?.tagName).toBe("UL");
    // Derived per card, so two of these on one page do not collide.
    expect(id).toContain("mp-868");
  });

  it("collapses again when the card switches to another person", async () => {
    // The disclosure state is scoped to the FILING, not to the component instance. No render
    // site passes a `key` and the routes do not remount on a param change, so a plain
    // boolean survives a person→person navigation whenever the target is already in the
    // React Query cache — i.e. every back/forward, since staleTime is Infinity repo-wide.
    // Person B would then open pre-expanded from a click the reader made on person A.
    const { rerender } = setup(15);
    await userEvent.click(
      screen.getByRole("button", { name: "mp_assets_show_more:3" }),
    );
    expect(screen.getByText("имот 14 · София")).toBeInTheDocument();

    mockPerson("Друг Човек", 15, "https://register.cacbg.bg/2024/other.xml");
    rerender(card("Друг Човек", "mp-999"));

    expect(screen.queryByText("имот 14 · София")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "mp_assets_show_more:3" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
