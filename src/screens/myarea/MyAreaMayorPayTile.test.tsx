// Render-level gates for the tile's core rules: self-hide on no data, the
// income figure never renders as €0 when absent, and the i18n interpolation
// args (name/year/rank/population) reach the translator.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MayorPayPayload } from "@/data/officials/useMayorPay";

const tCalls: Array<[string, Record<string, unknown> | undefined]> = [];
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => {
      tCalls.push([k, o]);
      return o ? `${k}:${JSON.stringify(o)}` : k;
    },
    i18n: { language: "bg" },
  }),
}));

const mockMayorPay = vi.fn();
vi.mock("@/data/officials/useMayorPay", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useMayorPay: (o?: string) => mockMayorPay(o),
}));

import { MayorPayCard, MyAreaMayorPayTile } from "./MyAreaMayorPayTile";

const payload = (over: Partial<MayorPayPayload> = {}): MayorPayPayload =>
  ({
    obshtina: "DOB03",
    name_bg: "Балчик",
    name_en: "Balchik",
    oblast_code: "DOB",
    mayor_name: "Николай Добрев Ангелов",
    mayor_slug: "nikolai-dobrev-angelov-4b8d87",
    declaration_id: 59211,
    fiscal_year: 2025,
    source_url: "https://register.cacbg.bg/2026/x.xml",
    income_eur: 64303.13,
    population: 15958,
    income_per_1000_residents_eur: 4029.52,
    rank: 106,
    ranked_count: 249,
    ...over,
  }) as MayorPayPayload;

const renderTile = (data: MayorPayPayload | null, obshtina = "DOB03") => {
  mockMayorPay.mockReturnValue({ data, isPending: false });
  return render(
    <MemoryRouter>
      <MyAreaMayorPayTile obshtina={obshtina} />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  tCalls.length = 0;
});

describe("MyAreaMayorPayTile", () => {
  it("renders nothing when the route resolves no data", () => {
    const { container } = renderTile(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the income figure and income label args", () => {
    renderTile(payload());
    expect(screen.getByText("€64 303")).toBeVisible();
    expect(
      screen.getByText(
        'mp_tile_income_label:{"year":2025,"name":"Николай Добрев Ангелов"}',
      ),
    ).toBeVisible();
  });

  it("passes population and rank/total to the translator", () => {
    // population/rank sit as sibling text nodes on one line (no wrapping
    // element around each), so getByText — which matches a node's OWN text,
    // not a container's concatenation of several sibling text nodes — cannot
    // see either individually. Asserting on the recorded t() call args
    // sidesteps both that and any locale thousands-separator formatting.
    renderTile(payload());
    const popCall = tCalls.find(([k]) => k === "mp_tile_population");
    const rankCall = tCalls.find(([k]) => k === "mp_tile_rank");
    expect(popCall?.[1]).toMatchObject({ population: expect.any(String) });
    expect(rankCall?.[1]).toEqual({ rank: 106, total: 249 });
  });

  it("shows the no-data message and never prints €0 when income_eur is null", () => {
    renderTile(payload({ income_eur: null, rank: null }));
    expect(screen.getByText("mp_tile_no_data")).toBeVisible();
    expect(screen.queryByText(/€0/)).toBeNull();
    expect(tCalls.some(([k]) => k === "mp_tile_rank")).toBe(false);
  });

  it("links to the source declaration and the comparison page", () => {
    renderTile(payload());
    const sourceLink = screen.getByText("mp_tile_source").closest("a")!;
    expect(sourceLink).toHaveAttribute(
      "href",
      "https://register.cacbg.bg/2026/x.xml",
    );
    const compareLink = screen.getByText("mp_tile_compare").closest("a")!;
    expect(compareLink).toHaveAttribute("href", "/governance/mayor-pay");
  });

  it("omits the source link when the declaration has no source_url", () => {
    renderTile(payload({ source_url: null }));
    expect(screen.queryByText("mp_tile_source")).toBeNull();
    expect(screen.getByText("mp_tile_compare")).toBeVisible();
  });

  it("does not assign a current mayor's filing to a different person profile", () => {
    mockMayorPay.mockReturnValue({ data: payload(), isPending: false });
    const { container } = render(
      <MemoryRouter>
        <MayorPayCard
          obshtina="DOB03"
          expectedMayorSlug="former-mayor-123"
        />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("uses an explicit parent-municipality title on settlement surfaces", () => {
    mockMayorPay.mockReturnValue({ data: payload(), isPending: false });
    render(
      <MemoryRouter>
        <MayorPayCard obshtina="DOB03" scope="parentMunicipality" />
      </MemoryRouter>,
    );
    expect(screen.getByText("mp_tile_parent_municipality_title")).toBeVisible();
  });
});
