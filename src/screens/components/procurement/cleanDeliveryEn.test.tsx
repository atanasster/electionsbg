// The ENGLISH side of the clean-delivery caveat, in its own file because the
// `react-i18next` mock is module-scoped and the two sibling suites pin „bg".
//
// WHY IT NEEDS COVERING AT ALL. `ABSENCE_MEANING_EN` is the one mirror with NO
// server counterpart — `isun_clean_delivery_coverage` carries only Bulgarian, so
// there is nothing for it to track and nothing to notice if it drifts. It is
// therefore the copy most exposed, and until this file it was the copy no test
// rendered: the static gate beside it checks the string exists in the SOURCE, not
// that it reaches a reader. An English reader had nothing standing between them
// and a caveat-less tile.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ABSENCE_MEANING_BG_FALLBACK,
  CompanyCleanDeliveryTile,
} from "./CompanyCleanDeliveryTile";
import { CompanyFundsTile } from "./CompanyFundsTile";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

const wrap = (node: React.ReactNode) =>
  render(
    <MemoryRouter>
      <TooltipProvider>{node}</TooltipProvider>
    </MemoryRouter>,
  );

describe("the EN caveat reaches an English reader", () => {
  it("CompanyCleanDeliveryTile renders the EN mirror, OLAF clause included", () => {
    wrap(
      <CompanyCleanDeliveryTile
        info={{
          eik: "130714137",
          name: "БУЛГЕД ООД",
          on_time_contracts: 4,
          clean_contracts: 2,
          programmes: null,
          beneficiary_listed: true,
          contracts: null,
          // The server value is BULGARIAN — the coverage row has no EN column —
          // so it must NOT leak onto an English page.
          absence_meaning: ABSENCE_MEANING_BG_FALLBACK,
        }}
      />,
    );
    expect(
      screen.getByText(/does not mean a financial correction was imposed/),
    ).toBeInTheDocument();
    expect(screen.getByText(/OLAF's IMS/)).toBeInTheDocument();
    expect(screen.queryByText(/НЕ означава/)).not.toBeInTheDocument();
  });

  it("CompanyFundsTile renders the EN mirror beside its marks", () => {
    wrap(
      <CompanyFundsTile
        eik="130714137"
        funds={{
          name: "БУЛГЕД ООД",
          org_type: "Company",
          contract_count: 1,
          contracted_eur: 248900,
          paid_eur: 124450,
        }}
        projects={[
          {
            contract_number: "BG-RRP-3.008-0282",
            title: "Circular economy transition support",
            program_name: "Recovery and Resilience Plan",
            total_eur: 248900,
            paid_eur: 124450,
            status: "Completed",
            duration_months: 8,
          },
        ]}
        cleanContracts={new Set(["BG-RRP-3.008-0282"])}
        absenceMeaning={ABSENCE_MEANING_BG_FALLBACK}
      />,
    );
    expect(screen.getAllByText("no correction").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/does not mean a financial correction was imposed/),
    ).toBeInTheDocument();
    expect(screen.getByText(/OLAF's IMS/)).toBeInTheDocument();
    // The BG server sentence must not reach an English page — the EN branch
    // ignores `absenceMeaning` deliberately, because there is nothing to track.
    expect(screen.queryByText(/НЕ означава/)).not.toBeInTheDocument();
  });
});
