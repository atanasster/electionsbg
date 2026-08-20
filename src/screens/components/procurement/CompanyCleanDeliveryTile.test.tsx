// Component guard for the ИСУН clean-delivery tile.
//
// What it locks is the ONE property that keeps this dataset from becoming an
// accusation: the tile must never render a zero. ИСУН publishes who delivered
// WITHOUT a financial correction; it publishes no complement, and OLAF's IMS —
// where individual irregularities actually go — is confidential. So „0 clean
// contracts" on a named company would assert something no source supports.
//
// Hermetic: `t` is not needed (the tile uses an inline BG/EN helper), and fetch
// is never reached (vitest.setup throws on an unstubbed one).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  CompanyCleanDeliveryTile,
  type CleanDeliveryInfo,
} from "./CompanyCleanDeliveryTile";

// The tile picks its copy from i18n.language directly (inline BG/EN helper), so
// the language must be pinned or the assertions test whichever branch happens to
// be default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

const CAVEAT =
  "Отсъствието от тези списъци НЕ означава наложена финансова корекция — " +
  "проектът може да е приключил със закъснение, да е прекратен или още да е в проверка.";

const info = (over: Partial<CleanDeliveryInfo> = {}): CleanDeliveryInfo => ({
  eik: "812013273",
  name: "ДИНГ-ПАВЛОВИ И СИЕ СД",
  on_time_contracts: 16,
  clean_contracts: 9,
  programmes: ["Програма за морско дело и рибарство"],
  absence_meaning: CAVEAT,
  ...over,
});

describe("CompanyCleanDeliveryTile", () => {
  it("renders both counts, which are allowed to differ", () => {
    // 16 on-time vs 9 uncorrected is the real shape: „в срок" is a stricter test
    // than „no correction", so the two populations do not reconcile.
    render(<CompanyCleanDeliveryTile info={info()} />);
    expect(screen.getByText("16")).toBeInTheDocument();
    expect(
      screen.getByText(/9 проекта без наложена финансова корекция/),
    ).toBeInTheDocument();
  });

  it("renders the caveat verbatim from the server", () => {
    // Rendered, not restated: the page and the database must not drift on what
    // absence means. A tile that dropped it would leave the number unbounded.
    render(<CompanyCleanDeliveryTile info={info()} />);
    expect(
      screen.getByText(new RegExp("НЕ означава наложена финансова корекция")),
    ).toBeInTheDocument();
  });

  it("NEVER renders a zero — the safety property", () => {
    // A row with no clean delivery must produce no tile at all, not a „0".
    const { container } = render(
      <CompanyCleanDeliveryTile
        info={info({ on_time_contracts: 0, clean_contracts: 0 })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("still renders when only ONE of the two counts is positive", () => {
    // Non-vacuity for the guard above: it must suppress only the all-zero case,
    // not any row with a zero in it. A beneficiary listed as correction-free with
    // no on-time contract is a real state.
    render(
      <CompanyCleanDeliveryTile
        info={info({ on_time_contracts: 0, clean_contracts: 3 })}
      />,
    );
    expect(
      screen.getByText(/3 проекта без наложена финансова корекция/),
    ).toBeInTheDocument();
  });

  it("survives a null programmes array and a null caveat", () => {
    // Both are nullable in the payload; neither may crash the page.
    render(
      <CompanyCleanDeliveryTile
        info={info({ programmes: null, absence_meaning: null })}
      />,
    );
    expect(screen.getByText("16")).toBeInTheDocument();
  });

  it("caps the programme chips and says how many are hidden", () => {
    render(
      <CompanyCleanDeliveryTile
        info={info({ programmes: ["a", "b", "c", "d", "e", "f"] })}
      />,
    );
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});
