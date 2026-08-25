// Three states, and the value of this component is that all three are wrong somewhere in
// the code it replaces: silence over a truncated list (CompanyTopAwardersTile with a null
// href — measured live, 10 of 270 awarders with nothing said), a see-all promising more
// when nothing is hidden (CompanyTopContractsTile, un-guarded), and a bare cap with no
// total (the old „Топ 8" chip). Each is pinned here.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ⚠️ The mock ECHOES an unknown key rather than answering every key with valid text.
// A catch-all mock (`k === "pp_breakdown_top_n" ? … : "Виж всички"`) makes a RENAMED key
// still render plausible copy, so a broken lookup passes — the shape this repo's own
// `t`-echo convention exists to avoid. Both keys are verified present in
// src/locales/{bg,en}/translation.json.
const KEYS: Record<string, (o?: { n?: number }) => string> = {
  pp_breakdown_top_n: (o) => `Топ ${o?.n}`,
  procurement_tile_see_all: () => "Виж всички",
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { n?: number }) => KEYS[k]?.(o) ?? k,
  }),
}));

import { TileTopNNote } from "./TileTopNNote";

const show = (props: {
  shown: number;
  total?: number;
  hasMore?: boolean;
  seeAllHref?: string | null;
  className?: string;
}) =>
  render(
    <MemoryRouter>
      <TileTopNNote {...props} />
    </MemoryRouter>,
  );

describe("TileTopNNote", () => {
  it("says NOTHING when the list is complete", () => {
    // A „Топ 10" chip over ten of ten is not merely noise — it implies a cap that does
    // not bind, i.e. tells the reader something is missing when nothing is.
    const { container } = show({ shown: 10, total: 10, seeAllHref: "/x" });
    expect(container.firstChild).toBeNull();
  });

  it("says nothing when fewer rows exist than the cap", () => {
    const { container } = show({ shown: 3, total: 3, seeAllHref: "/x" });
    expect(container.firstChild).toBeNull();
  });

  it("links with the FULL count when there is somewhere to go", () => {
    show({ shown: 10, total: 149, seeAllHref: "/company/1/contracts" });
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/company/1/contracts");
    // The number the reader is missing is visible BEFORE the click.
    expect(link.textContent).toContain("149");
    expect(link.textContent).toContain("Виж всички");
  });

  it("links WITHOUT a number when the caller cannot know the total", () => {
    // CompanyTopContractsTile's case: `contractCount` counts a different population from
    // the rows it renders, so no honest denominator exists. A link with no number beats a
    // link with the wrong one.
    show({ shown: 10, hasMore: true, seeAllHref: "/company/1/contracts" });
    const link = screen.getByRole("link");
    expect(link.textContent).toContain("Виж всички");
    expect(link.textContent).not.toMatch(/\d/);
  });

  it("says nothing when hasMore is false and no total is given", () => {
    const { container } = show({
      shown: 10,
      hasMore: false,
      seeAllHref: "/x",
    });
    expect(container.firstChild).toBeNull();
  });

  it("DEGRADES rather than going silent on an impossible total < shown", () => {
    // This is the regression that shipped: `CompanyTopContractsTile` was wired to
    // `contractCount` (4) while rendering `topContracts` (25 shipped, 10 shown), so the
    // naive `total <= shown → null` hid a link on 146 entities that had more to show.
    // A mis-wired caller must fall back to the un-counted link, never to silence.
    show({ shown: 10, total: 4, hasMore: true, seeAllHref: "/x" });
    const link = screen.getByRole("link");
    expect(link).toBeInTheDocument();
    expect(link.textContent).not.toContain("4");
  });

  it("falls back to a Топ N / M chip when there is NO page to link to", () => {
    // The defect this replaced: `seeAllHref={null}` rendered nothing at all, so 10 of
    // 270 awarders read as the complete list under a heading naming the whole set.
    show({ shown: 10, total: 270, seeAllHref: null });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/Топ 10 \/ 270/)).toBeInTheDocument();
  });

  it("treats an omitted href the same as an explicit null", () => {
    show({ shown: 8, total: 70 });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/Топ 8 \/ 70/)).toBeInTheDocument();
  });

  it("shows the cap even when the total is only one larger", () => {
    // The boundary: 10 of 11 is still an incomplete list.
    show({ shown: 10, total: 11, seeAllHref: null });
    expect(screen.getByText(/Топ 10 \/ 11/)).toBeInTheDocument();
  });

  it("gives both branches the same type scale and alignment", () => {
    // They sit in adjacent tiles' CardTitles, so a divergence shows up as one note a
    // pixel off from its neighbour's — invisible in review, obvious on the page.
    const a = show({ shown: 1, total: 9, seeAllHref: "/x" });
    const linkCls = screen.getByRole("link").className;
    a.unmount();
    show({ shown: 1, total: 9, seeAllHref: null });
    const chipCls = screen.getByText(/Топ 1/).className;
    for (const c of ["text-[11px]", "whitespace-nowrap", "ml-auto"]) {
      expect(linkCls).toContain(c);
      expect(chipCls).toContain(c);
    }
  });

  it("lets a caller override the default ml-auto", () => {
    // ProcurementBreakdownTile's card holds three sections and only one is capped, so
    // its note must stay beside the „CPV" chip rather than float to the far right.
    show({ shown: 6, total: 10, seeAllHref: null, className: "ml-0" });
    const chip = screen.getByText(/Топ 6 \/ 10/);
    expect(chip.className).toContain("ml-0");
    expect(chip.className).not.toContain("ml-auto");
  });
});
