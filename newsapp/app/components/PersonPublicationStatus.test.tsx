// The methodology's statement of the person surfaces' state (§8.2, §9): the
// windows with their dates, and an unmet agreement arm said as unmet.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonPublicationStatus as Status } from "../data";

const draw = async (data: Status) => {
  vi.resetModules();
  vi.doMock("../data", async (orig) => ({
    ...(await orig<typeof import("../data")>()),
    usePersonPublication: () => ({ data, error: null, loading: false }),
  }));
  const { PersonPublicationStatus } = await import("./PersonPublicationStatus");
  render(<PersonPublicationStatus />);
};

const gate = (over: Partial<Status["gate"]> = {}): Status["gate"] => ({
  status: "UNMET",
  passed: false,
  passed_without_agreement: false,
  agreement_passed: false,
  test_pairs: 0,
  kappa: null,
  ...over,
});

afterEach(cleanup);

describe("PersonPublicationStatus", () => {
  it("lists a window with Sofia-time dates and marks an estimate", async () => {
    await draw({
      generated_at: "t",
      freezes: [
        {
          id: "pvr2026-r1",
          from: "2026-11-07T00:00:00+02:00",
          until: "2026-11-08T20:00:00+02:00",
          status: "estimated",
        },
      ],
      gate: gate(),
    });
    const box = screen.getByTestId("person-publication-status").textContent!;
    expect(box).toContain("7 ноември 2026");
    expect(box).toContain("20:00");
    expect(box).toContain("очаквана дата");
    expect(box).toContain("още не е преминала");
  });

  it("says the agreement arm is unmet rather than leaving it out", async () => {
    await draw({
      generated_at: "t",
      freezes: [],
      gate: gate({ passed_without_agreement: true }),
    });
    expect(
      screen.getByTestId("person-publication-status").textContent,
    ).toContain("съгласието между двама независими оценители");
  });
});
