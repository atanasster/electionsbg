// Component guard for the declared-stakes-with-public-contracts block (audit T3.8).
//
// This block attaches "owns a company holding public contracts" to a named person, so the
// controls here are editorial as much as functional:
//
//   · it must SELF-HIDE on an empty payload — most people have no confirmed stake, and an
//     empty conflict-of-interest heading on a profile is itself an insinuation;
//   · the caveat must always render, because the framing ("declared, lawful, matched") is
//     what keeps the block descriptive rather than accusatory;
//   · a company with a zero ALIGNED figure must still show its lifetime figure, and the two
//     must stay distinguishable — collapsing them would imply an overlap with the person's
//     tenure that the data explicitly says did not happen.
//
// Hermetic: fetch stubbed.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { StakeProcurementRow } from "./usePersonStakeProcurement";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { PersonStakeProcurement } from "./PersonStakeProcurement";

const row = (o: Partial<StakeProcurementRow> = {}): StakeProcurementRow => ({
  eik: "112028994",
  companyName: "РАДИО СОТ",
  declaredName: "РАДИО СОТ ООД",
  shareSize: "1",
  firstYear: 2020,
  lastYear: 2021,
  contractCount: 75,
  totalEur: 949329,
  whileDeclaredCount: 9,
  whileDeclaredEur: 66001,
  ...o,
});

const stub = (rows: StakeProcurementRow[]) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => rows }) as Response),
  );

const draw = (slug = "x") =>
  render(
    <MemoryRouter>
      <PersonStakeProcurement slug={slug} />
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("PersonStakeProcurement", () => {
  it("renders a confirmed stake with both money figures and links to the company", async () => {
    stub([row()]);
    draw();
    await waitFor(() =>
      expect(screen.getByText("pp_stake_proc_title")).toBeInTheDocument(),
    );
    const link = screen.getByRole("link", { name: "РАДИО СОТ" });
    expect(link).toHaveAttribute("href", "/company/112028994");
    // The VALUES, not the labels. Asserting only that two labels exist would pass even if
    // both figures were rendered from the same field, which is the regression that matters.
    // formatEurCompact renders compact notation ("€66 хил." / "€66K"), so match the
    // currency-plus-magnitude prefix rather than the full digits.
    expect(screen.getByText(/^€66\b/)).toBeInTheDocument(); // aligned  66,001
    expect(screen.getByText(/^€949\b/)).toBeInTheDocument(); // lifetime 949,329
  });

  // The registry's name is the headline; the declarant's own spelling is shown beneath so a
  // reader can check the inferred match themselves.
  it("shows the registry name as the link and the declared spelling alongside", async () => {
    stub([row()]);
    draw();
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "РАДИО СОТ" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/РАДИО СОТ ООД/)).toBeInTheDocument();
  });

  // share_size is free text holding percentages, share counts, fractions and capital amounts
  // indistinguishably. A bare "5000" beside a percentage is nonsense, so only a parseable
  // percentage may render.
  it("renders a percentage share but suppresses an unlabelled number", async () => {
    stub([row({ shareSize: "50 %" })]);
    const { unmount } = draw();
    await waitFor(() => expect(screen.getByText(/50%/)).toBeInTheDocument());
    unmount();

    stub([row({ shareSize: "5000" })]);
    draw();
    await waitFor(() =>
      expect(screen.getByText("pp_stake_proc_title")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/5000/)).not.toBeInTheDocument();
  });

  // The framing caveat is not decoration — it is what makes the block descriptive.
  it("always renders the caveat", async () => {
    stub([row()]);
    draw();
    await waitFor(() =>
      expect(screen.getByText("pp_stake_proc_caveat")).toBeInTheDocument(),
    );
  });

  // An empty heading on a profile reads as "we looked and found something".
  it("renders nothing when the person has no confirmed stakes", async () => {
    stub([]);
    const { container } = draw();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText("pp_stake_proc_title")).not.toBeInTheDocument();
  });

  // A company sold before it won anything must not read as a tenure overlap: the lifetime
  // figure still shows, the aligned figure stays zero, and the row remains legible.
  it("keeps a zero aligned figure distinct from the lifetime figure", async () => {
    stub([
      row({ whileDeclaredEur: 0, whileDeclaredCount: 0, totalEur: 319087 }),
    ]);
    draw();
    await waitFor(() =>
      expect(screen.getByText("pp_stake_proc_title")).toBeInTheDocument(),
    );
    // €0 aligned AND the lifetime figure must both appear — the row is not suppressed, and
    // the two numbers must not collapse into one.
    expect(screen.getByText("€0")).toBeInTheDocument();
    expect(screen.getByText(/^€319\b/)).toBeInTheDocument();
  });
});
