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
  companyName: "РАДИО СОТ ООД",
  shareSize: "1",
  firstYear: 2020,
  lastYear: 2021,
  contractCount: 75,
  totalEur: 949329,
  whileDeclaredCount: 9,
  whileDeclaredEur: 66001,
  firstContract: "2011-04-06",
  lastContract: "2026-05-08",
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
    const link = screen.getByRole("link", { name: "РАДИО СОТ ООД" });
    expect(link).toHaveAttribute("href", "/company/112028994");
    // Both figures present and distinct: aligned vs lifetime.
    expect(
      screen.getByText("pp_stake_proc_while_declared"),
    ).toBeInTheDocument();
    expect(screen.getByText("pp_stake_proc_total")).toBeInTheDocument();
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
    // The lifetime figure is still rendered — the row is not suppressed.
    expect(screen.getByText("pp_stake_proc_total")).toBeInTheDocument();
    expect(
      screen.getByText("pp_stake_proc_while_declared"),
    ).toBeInTheDocument();
  });
});
