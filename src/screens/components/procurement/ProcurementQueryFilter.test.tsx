// Component guard for the shared procurement-query filter — the narrowing controls
// must fire the right granular callback with the right shape (a comma CPV box → a
// string[], a €/date field → the matching range edge, the funding select → the
// euFunded tri-state). A wrong wiring here silently narrows a dossier by the wrong
// dimension. AwarderSearch (used by the thread rows) fetches, so fetch is stubbed.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProcurementQueryFilter } from "./ProcurementQueryFilter";
import type { ProcurementQuery } from "@/data/procurement/projectFile";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({}) }) as Response),
  );
});

const base: ProcurementQuery = { search: [{ terms: "рехабилитация" }] };

const noop = () => {};
const handlers = () => ({
  onThreadTerms: vi.fn(),
  onAddThread: vi.fn(),
  onRemoveThread: vi.fn(),
  onThreadBuyer: vi.fn(),
  onThreadContractor: vi.fn(),
  onCpvIn: vi.fn(),
  onDateRange: vi.fn(),
  onAmountRange: vi.fn(),
  onEuFunded: vi.fn(),
});

describe("ProcurementQueryFilter — narrowing controls", () => {
  it("renders a row per thread", () => {
    render(
      <ProcurementQueryFilter
        value={{ search: [{ terms: "a" }, { terms: "b" }] }}
        bg
        {...handlers()}
      />,
    );
    expect(screen.getByLabelText("Дума за търсене 1")).toHaveValue("a");
    expect(screen.getByLabelText("Дума за търсене 2")).toHaveValue("b");
  });

  it("parses the comma CPV box into a string[] on blur", () => {
    const h = handlers();
    render(<ProcurementQueryFilter value={base} bg {...h} />);
    const cpv = screen.getByPlaceholderText("45, 71");
    fireEvent.change(cpv, { target: { value: "45, 71 , " } });
    fireEvent.blur(cpv);
    expect(h.onCpvIn).toHaveBeenCalledWith(["45", "71"]);
  });

  it("fires the amount edge as a number (min), leaving max untouched", () => {
    const h = handlers();
    render(
      <ProcurementQueryFilter
        value={{ ...base, maxAmountEur: 9000 }}
        bg
        {...h}
      />,
    );
    fireEvent.change(screen.getByLabelText("Мин. стойност €"), {
      target: { value: "1000" },
    });
    expect(h.onAmountRange).toHaveBeenCalledWith(1000, 9000);
  });

  it("fires the date range edge (from), leaving to untouched", () => {
    const h = handlers();
    render(
      <ProcurementQueryFilter
        value={{ ...base, dateTo: "2022-12-31" }}
        bg
        {...h}
      />,
    );
    fireEvent.change(screen.getByLabelText("От дата"), {
      target: { value: "2021-01-01" },
    });
    expect(h.onDateRange).toHaveBeenCalledWith("2021-01-01", "2022-12-31");
  });

  it("keeps an in-progress CPV edit when the value object is recreated", () => {
    // The host re-parses ?q= (JSON.parse) on every mutateSpec, so `value.cpvIn` is
    // a fresh array reference with the same content — the re-sync must NOT clobber
    // an uncommitted edit (FINDING-001).
    const h = handlers();
    const { rerender } = render(
      <ProcurementQueryFilter
        value={{ search: [{ terms: "x" }], cpvIn: ["45"] }}
        bg
        {...h}
      />,
    );
    const cpv = screen.getByPlaceholderText("45, 71");
    fireEvent.change(cpv, { target: { value: "45, 71" } }); // typed, not committed
    rerender(
      <ProcurementQueryFilter
        value={{ search: [{ terms: "x" }], cpvIn: ["45"] }} // new ref, same content
        bg
        {...h}
      />,
    );
    expect(cpv).toHaveValue("45, 71");
  });

  it("maps the funding select to the euFunded tri-state", () => {
    const h = handlers();
    render(<ProcurementQueryFilter value={base} bg {...h} />);
    const sel = screen.getByLabelText("Финансиране");
    fireEvent.change(sel, { target: { value: "eu" } });
    expect(h.onEuFunded).toHaveBeenLastCalledWith(true);
    fireEvent.change(sel, { target: { value: "nat" } });
    expect(h.onEuFunded).toHaveBeenLastCalledWith(false);
    fireEvent.change(sel, { target: { value: "all" } });
    expect(h.onEuFunded).toHaveBeenLastCalledWith(undefined);
  });

  it("reflects an existing narrowing value in the controls", () => {
    render(
      <ProcurementQueryFilter
        value={{ ...base, cpvIn: ["45"], euFunded: false }}
        bg
        onThreadTerms={noop}
        onAddThread={noop}
        onRemoveThread={noop}
        onThreadBuyer={noop}
        onThreadContractor={noop}
        onCpvIn={noop}
        onDateRange={noop}
        onAmountRange={noop}
        onEuFunded={noop}
      />,
    );
    expect(screen.getByPlaceholderText("45, 71")).toHaveValue("45");
    expect(screen.getByLabelText("Финансиране")).toHaveValue("nat");
  });
});
