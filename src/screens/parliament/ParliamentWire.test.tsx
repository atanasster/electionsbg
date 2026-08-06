// The wire's framing decision — live recess vs dissolved parliament.
//
// The arithmetic (`daysSince`) was never the risk. The risk was the SENTENCE built on it: the
// first draft rendered „НС не заседава от 25 март (1960 дни)" for eight of the nine shipped
// parliaments, describing chambers that were dissolved years ago as failing to sit, with a
// date whose short format omitted the year — so a March five years back read as this one.
//
// i18n is mocked to echo keys, because what is under test is WHICH key the component picks.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o?.date ? `${k}|${String(o.date)}` : k,
    i18n: { language: "bg" },
  }),
}));

import { ParliamentWire } from "./ParliamentWire";

const draw = (
  wire: {
    date: string;
    items: number;
    bills: number;
    attendance: number | null;
  },
  todayIso: string,
) =>
  render(
    <MemoryRouter>
      <ParliamentWire wire={wire} todayIso={todayIso} />
    </MemoryRouter>,
  );

const SITTING = { items: 10, bills: 1, attendance: 0.64 };

describe("ParliamentWire framing", () => {
  it("says the chamber is in recess only while the recess is LIVE", () => {
    draw({ date: "2026-07-31", ...SITTING }, "2026-08-06");
    expect(screen.getByText(/nsh_wire_recess/)).toBeInTheDocument();
  });

  it("does NOT describe a dissolved parliament as failing to sit", () => {
    // The 45th last sat 2021-05-07 — 1,917 days before today's date in this test.
    draw({ date: "2021-05-07", ...SITTING }, "2026-08-06");
    expect(screen.queryByText(/nsh_wire_recess/)).not.toBeInTheDocument();
    // …and the date it does print carries the year, via the "long" label style.
    expect(screen.getByText(/nsh_wire_last_sat\|.*2021/)).toBeInTheDocument();
  });

  it("uses the LIVE_TAIL_DAYS boundary the strip beneath it uses", () => {
    // 60 days is still live news and is drawn as a gap in the strip; 61 is history. The two
    // must agree, or the sentence and the picture under it tell different stories.
    draw({ date: "2026-06-07", ...SITTING }, "2026-08-06"); // 60 days
    expect(screen.getByText(/nsh_wire_recess/)).toBeInTheDocument();
    screen.getByText(/nsh_wire_recess/);
    draw({ date: "2026-06-06", ...SITTING }, "2026-08-06"); // 61 days
    expect(screen.getAllByText(/nsh_wire_last_sat/).length).toBe(1);
  });

  it("says today-in-the-Assembly when the last sitting is today", () => {
    draw({ date: "2026-08-06", ...SITTING }, "2026-08-06");
    expect(screen.getByText("nsh_wire_today")).toBeInTheDocument();
  });
});

describe("ParliamentWire figures", () => {
  it("drops the attendance clause when the day recorded no cast votes", () => {
    // The 49th's final sitting. 0% would assert an empty chamber where the corpus says only
    // that it holds no roll call for those items.
    const { container } = draw(
      { date: "2024-06-02", items: 2, bills: 0, attendance: null },
      "2026-08-06",
    );
    expect(container.textContent).not.toContain("nsh_wire_attendance");
  });

  it("drops the bills clause — and its basis note — at zero", () => {
    const { container } = draw(
      { date: "2026-07-31", items: 5, bills: 0, attendance: 0.51 },
      "2026-08-06",
    );
    expect(container.textContent).not.toContain("nsh_num_bills");
    expect(container.textContent).not.toContain("nsh_wire_basis");
  });

  it("keeps the basis note whenever a bill figure is shown", () => {
    // „3 законопроекта" unqualified is the figure that gets quoted back as "three laws
    // passed", and §4.2 established this corpus has no adoption marker at all.
    const { container } = draw(
      { date: "2026-07-29", items: 21, bills: 3, attendance: 0.7 },
      "2026-08-06",
    );
    expect(container.textContent).toContain("nsh_num_bills");
    expect(container.textContent).toContain("nsh_wire_basis");
  });

  it("links the figures at the sitting they describe", () => {
    draw({ date: "2026-07-31", ...SITTING }, "2026-08-06");
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/votes/2026-07-31",
    );
  });
});
