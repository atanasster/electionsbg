// Branch coverage for the contract-annexes panel. The data hook is mocked so the
// test never touches the network (an unstubbed fetch throws in jsdom). Guards the
// multi-lot regression: the net-move headline chains rows[0]→rows[last], which is
// only a real value chain when every row is the same lot — across lots it would
// cross independent per-lot series and print a nonsense percentage.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ContractAnnexes } from "@/data/procurement/useContractAnnexes";

const annexesMock = vi.fn<() => ContractAnnexes>();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "bg" },
    // Return the defaultValue when given (so count-interpolated copy resolves),
    // else the key — the test asserts on numeric content, not translated strings.
    t: (k: string, o?: { defaultValue?: string; count?: number }) =>
      o?.defaultValue
        ? o.defaultValue.replace("{{count}}", String(o.count ?? ""))
        : k,
  }),
}));
vi.mock("@/data/procurement/useContractAnnexes", () => ({
  useContractAnnexes: () => ({ data: annexesMock() }),
}));

import { ContractAnnexesPanel } from "./ContractAnnexesPanel";

const row = (over: Partial<ContractAnnexes["rows"][number]>) => ({
  noticeId: 1,
  lot: null,
  publicationDate: "2024-01-01",
  lastValueEur: null,
  currentValueEur: null,
  valueDiffEur: null,
  changeReason: null,
  changeReasonDescription: null,
  changeDescription: null,
  ...over,
});

describe("ContractAnnexesPanel", () => {
  it("shows a net headline for a single-lot annex chain", () => {
    annexesMock.mockReturnValue({
      annexCount: 2,
      rows: [
        row({
          noticeId: 1,
          lastValueEur: 1_000_000,
          currentValueEur: 1_200_000,
        }),
        row({
          noticeId: 2,
          lastValueEur: 1_200_000,
          currentValueEur: 1_500_000,
        }),
      ],
    });
    const { container } = render(<ContractAnnexesPanel contractKey="abc" />);
    // Net 1.0M → 1.5M = +50%, plus the per-row +20% / +25%.
    expect(container.textContent).toContain("50%");
    expect(container.textContent).toContain("20%");
    expect(container.textContent).toContain("25%");
  });

  it("suppresses the net headline when annexes span multiple lots", () => {
    annexesMock.mockReturnValue({
      annexCount: 1, // one publication, two lots → two rows
      rows: [
        row({ lot: "1", lastValueEur: 1_000_000, currentValueEur: 1_200_000 }),
        row({ lot: "2", lastValueEur: 5_000_000, currentValueEur: 5_100_000 }),
      ],
    });
    const { container } = render(<ContractAnnexesPanel contractKey="abc" />);
    // The cross-lot net would be (5.1M-1.0M)/1.0M = +410% — must NOT appear.
    expect(container.textContent).not.toContain("410%");
    // …but the correct per-lot deltas still render.
    expect(container.textContent).toContain("20%"); // lot 1: +20%
    expect(container.textContent).toContain("2%"); // lot 2: +2%
  });

  it("renders nothing when there are no annexes", () => {
    annexesMock.mockReturnValue({ annexCount: 0, rows: [] });
    const { container } = render(<ContractAnnexesPanel contractKey="abc" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while the query is still loading (no data)", () => {
    annexesMock.mockReturnValue(undefined as unknown as ContractAnnexes);
    const { container } = render(<ContractAnnexesPanel contractKey="abc" />);
    expect(container.firstChild).toBeNull();
  });
});
