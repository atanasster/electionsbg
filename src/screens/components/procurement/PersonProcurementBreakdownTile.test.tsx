import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Building2 } from "lucide-react";
import { describe, it, expect } from "vitest";
import {
  PersonProcurementBreakdownTile,
  type PersonBreakdownRow,
} from "./PersonProcurementBreakdownTile";

const renderTile = (rows: PersonBreakdownRow[]) =>
  render(
    <MemoryRouter>
      <PersonProcurementBreakdownTile
        title="По фирма"
        icon={Building2}
        rows={rows}
      />
    </MemoryRouter>,
  );

describe("PersonProcurementBreakdownTile", () => {
  it("self-hides when there are no rows", () => {
    const { container } = renderTile([]);
    expect(container.firstChild).toBeNull();
  });

  it("renders a linked row for a company and an UNlinked row for the national bucket", () => {
    const { getByText, getByTitle } = renderTile([
      {
        id: "131084887",
        label: "Издателство Атласи",
        href: "/company/131084887",
        totalEur: 96958,
        contractCount: 87,
      },
      {
        id: "national",
        label: "Национални възложители",
        href: null,
        totalEur: 6245,
        contractCount: 3,
      },
    ]);
    // Linked row is an <a>; the national bucket is plain text (no anchor).
    expect(getByText("Издателство Атласи").closest("a")).toHaveAttribute(
      "href",
      "/company/131084887",
    );
    expect(getByTitle("Национални възложители").closest("a")).toBeNull();
  });

  it("caps at the top 8 rows and shows the Top-N badge only when there are more", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      id: `c${i}`,
      label: `Фирма ${i}`,
      href: `/company/${i}`,
      totalEur: 1000 - i,
      contractCount: 1,
    }));
    const { queryByText, container } = renderTile(many);
    // rows 0..7 render, 8..10 do not
    expect(queryByText("Фирма 7")).not.toBeNull();
    expect(queryByText("Фирма 8")).toBeNull();
    // The "Top N" badge is present (asserted structurally, i18n-agnostic).
    expect(container.querySelector(".ml-auto")).not.toBeNull();

    // ≤ 8 rows → no badge
    const { container: c2 } = renderTile(many.slice(0, 3));
    expect(c2.querySelector(".ml-auto")).toBeNull();
  });

  it("scales bars to the leader and floors a tiny row at 3%", () => {
    const { container } = renderTile([
      {
        id: "big",
        label: "Big",
        href: "/company/1",
        totalEur: 100000,
        contractCount: 9,
      },
      {
        id: "tiny",
        label: "Tiny",
        href: "/company/2",
        totalEur: 1,
        contractCount: 1,
      },
    ]);
    const bars = container.querySelectorAll<HTMLDivElement>(".bg-primary\\/60");
    expect(bars[0].style.width).toBe("100%"); // leader
    // 1/100000 → 0.001% clamps up to the 3% floor
    expect(bars[1].style.width).toBe("3%");
  });
});
