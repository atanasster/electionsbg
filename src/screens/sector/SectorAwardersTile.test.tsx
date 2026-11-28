import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SectorAwardersTile } from "./SectorAwardersTile";
import { SECTOR_DASHBOARDS } from "./sectorDashboards";
import { EDU_INSTITUTION_COUNT } from "@/lib/educationReferenceData";

describe("SectorAwardersTile — one chip per institution", () => {
  it("renders Свищов once and counts institutions, not EIKs", () => {
    render(
      <MemoryRouter>
        <SectorAwardersTile config={SECTOR_DASHBOARDS.edu} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/Ценов/)).toHaveLength(1);
    expect(
      screen.getByText(new RegExp(`\\(${EDU_INSTITUTION_COUNT}\\)`)),
    ).toBeTruthy();
    expect(SECTOR_DASHBOARDS.edu.members.length).toBe(
      EDU_INSTITUTION_COUNT + 1,
    );
  });
});

describe("SectorMembersSearch — its label counts institutions too", () => {
  it("agrees with the awarders heading", async () => {
    const { SectorMembersSearch } = await import("./SectorMembersSearch");
    render(
      <MemoryRouter>
        <SectorMembersSearch config={SECTOR_DASHBOARDS.edu} bg />
      </MemoryRouter>,
    );
    expect(
      screen.getAllByText(new RegExp(`\\(${EDU_INSTITUTION_COUNT}\\)`)).length,
    ).toBeGreaterThan(0);
  });
});
