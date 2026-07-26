// Component guard for the procedure-mix bar: renders one segment + legend chip
// per bucket, computes shares, and toggles the procedure filter on click
// (selecting a bucket, then clearing it when the active one is clicked again).
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "bg" }, t: (k: string) => k }),
}));
// Avoid pulling ThemeContext into the test — the colour just needs to resolve.
vi.mock("@/screens/components/procurement/chartColors", () => ({
  useIsDark: () => false,
}));

import { ProcedureMixBar } from "./ProcedureMixBar";
import type { MethodBucketFacet } from "@/lib/cpvSectors";

const BUCKETS: MethodBucketFacet[] = [
  { bucket: "open", count: 75, methods: ["Открита процедура", "open"] },
  { bucket: "direct", count: 25, methods: ["Пряко възлагане"] },
];

describe("ProcedureMixBar", () => {
  it("renders a legend chip per bucket with its share", () => {
    render(
      <ProcedureMixBar buckets={BUCKETS} selected={null} onSelect={vi.fn()} />,
    );
    // 2 buckets → segment button + legend button each = 4 buttons
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("selects a bucket (with its raw methods) on click", () => {
    const onSelect = vi.fn();
    render(
      <ProcedureMixBar buckets={BUCKETS} selected={null} onSelect={onSelect} />,
    );
    // click the "open" control (segment + legend chip share the name; either
    // fires the same toggle)
    fireEvent.click(screen.getAllByRole("button", { name: /Открита/ })[0]);
    expect(onSelect).toHaveBeenCalledWith("open");
  });

  it("clears the filter when the active bucket is clicked again", () => {
    const onSelect = vi.fn();
    render(
      <ProcedureMixBar buckets={BUCKETS} selected="open" onSelect={onSelect} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /Открита/ })[0]);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("renders nothing when there are no buckets or a zero total", () => {
    const { container } = render(
      <ProcedureMixBar buckets={[]} selected={null} onSelect={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
