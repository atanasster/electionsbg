// Component guard for the group-selection wiring (§0f — the DIY builder's per-
// thread scope pickers). One instance searches BUYERS (`awarders`, default), a
// second searches CONTRACTORS (`companies`); both hit the same procurement-search
// endpoint and must read the CORRECT response group + show the matching labels. A
// typo in the group key or the label map would silently point a contractor picker
// at buyers — this pins that it doesn't.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AwarderSearch } from "./AwarderSearch";

// The endpoint returns BOTH groups; a picker must render ONLY its own group.
const searchResponse = {
  awarders: [{ eik: "176481459", name: "Централна избирателна комисия" }],
  companies: [{ eik: "130199580", name: "Сиела Норма АД" }],
};

let lastUrl = "";

beforeEach(() => {
  lastUrl = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      lastUrl = url;
      return { json: async () => searchResponse } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("AwarderSearch — buyer/contractor group selection", () => {
  it("group='companies' reads the companies group + uses contractor labels", async () => {
    render(
      <AwarderSearch value={null} onChange={() => {}} bg group="companies" />,
    );
    // Contractor labels, not buyer ones.
    const input = screen.getByLabelText("Търси изпълнител");
    expect(input).toHaveAttribute(
      "placeholder",
      expect.stringContaining("Изпълнител"),
    );
    type("Търси изпълнител", "Сиела");
    // The contractor from the `companies` group appears…
    expect(await screen.findByText("Сиела Норма АД")).toBeInTheDocument();
    // …and the `awarders`-group entry does NOT leak into a contractor picker.
    expect(
      screen.queryByText("Централна избирателна комисия"),
    ).not.toBeInTheDocument();
  });

  it("defaults to the awarders group + buyer labels (behavior-preserving)", async () => {
    render(<AwarderSearch value={null} onChange={() => {}} bg />);
    type("Търси възложител", "ЦИК");
    expect(
      await screen.findByText("Централна избирателна комисия"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Сиела Норма АД")).not.toBeInTheDocument();
  });

  it("renders a chip with the group's label when a value is selected", () => {
    render(
      <AwarderSearch
        value={{ eik: "130199580", name: "Сиела Норма АД" }}
        onChange={() => {}}
        bg
        group="companies"
      />,
    );
    expect(screen.getByText(/Изпълнител:/)).toBeInTheDocument();
    expect(screen.getByText("Сиела Норма АД")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Изчисти изпълнителя" }),
    ).toBeInTheDocument();
  });

  it("does not fire the search below the 2-char minimum", () => {
    render(<AwarderSearch value={null} onChange={() => {}} bg />);
    type("Търси възложител", "с");
    expect(lastUrl).toBe(""); // fetch never called for a 1-char term
  });
});
