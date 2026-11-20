// T5: the research arm says „not loaded" (never 0) when the payout corpus was
// absent where the blob was built, and an error is reported as an error; the
// programme list marks every non-EU programme with its source.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { EduHubStats } from "@/data/edu/hubStats";

const hub = vi.hoisted(() => ({
  value: { data: null as unknown, isLoading: false, isError: false },
}));
vi.mock("@/data/edu/hubStats", () => ({ useEduHubStats: () => hub.value }));

import { ProgrammeList, ResearchCard } from "./EduMoneyScreen";

type Arm = NonNullable<EduHubStats["research"]>[number];
const arm = (over: Partial<Arm>): Arm => ({
  universe: "research_ssa",
  procurementEur: 1_000_000,
  procurementContracts: 10,
  grantEur: 500_000,
  grantProjects: 2,
  agriEur: 2_000_000,
  agriPayments: 5,
  agriFirstYear: 2015,
  agriLastYear: 2025,
  ...over,
});

beforeEach(() => {
  hub.value = { data: null, isLoading: false, isError: false };
});

describe("ResearchCard", () => {
  it("says the payout corpus was not loaded — never a zero", () => {
    hub.value.data = { research: [arm({ agriEur: null, agriPayments: null, agriFirstYear: null, agriLastYear: null })] }; // prettier-ignore
    const c = render(<ResearchCard />).container;
    expect(c.textContent).toMatch(/не са заредени|not loaded/);
    expect(c.textContent).not.toMatch(
      /Земеделие“?\)?: €0|Agriculture payments \(paid\): €0/,
    );
  });

  it("shows the payout with its years when loaded", () => {
    hub.value.data = { research: [arm({})] };
    const c = render(<ResearchCard />).container;
    expect(c.textContent).toMatch(/2015–2025/);
  });

  it("reports a failed fetch as a failure, not as unpublished", () => {
    hub.value = { data: undefined, isLoading: false, isError: true };
    const c = render(<ResearchCard />).container;
    expect(c.textContent).toMatch(
      /не можаха да се заредят|could not be loaded/,
    );
  });
});

describe("ProgrammeList", () => {
  const row = (code: string, name: string) => ({
    code,
    name,
    projects: 1,
    beneficiaries: 1,
    grantEur: 1000,
    paidEur: 0,
  });
  it("marks every non-EU programme and leaves the EU ones bare", () => {
    const c = render(
      <ProgrammeList
        rows={[
          row("2021BG05SFPR001", "Образование"),
          row("BNSF", "ФНИ"),
          row("DVET", "ДОМИНО"),
          row("XYZ", "Нова"),
        ]}
      />,
    ).container;
    const items = [...c.querySelectorAll("li")].map((l) => l.textContent ?? "");
    expect(items[0]).not.toMatch(/\(/);
    expect(items[1]).toMatch(/национален фонд|national fund/);
    expect(items[2]).toMatch(/Норвегия|Norway/);
    expect(items[3]).toMatch(/друг източник|other source/);
  });
});
