// The generic 100%-stacked filter bar, extracted from ProcedureMixBar so /persons and the
// procurement browsers share one implementation of the stacking, dimming and legend.
//
// The invariant worth pinning is the SHARE ARITHMETIC: widths are percentages of the summed
// total, so a caller feeding overlapping categories gets widths adding past 100%. That is
// documented in the component and guarded here by asserting the shares of a known set.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, test, expect, vi } from "vitest";
import { MixBar } from "./MixBar";

const SEGMENTS = [
  { key: "a", label: "Alpha", count: 75, color: "#111" },
  { key: "b", label: "Beta", count: 25, color: "#222" },
];

describe("MixBar", () => {
  test("renders nothing when there is no data", () => {
    const { container } = render(
      <MixBar segments={[]} selected={null} onSelect={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing when every segment is zero", () => {
    // A total of 0 would make every width NaN%.
    const { container } = render(
      <MixBar
        segments={[{ key: "a", label: "Alpha", count: 0, color: "#111" }]}
        selected={null}
        onSelect={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("segment widths are shares of the total", () => {
    render(<MixBar segments={SEGMENTS} selected={null} onSelect={() => {}} />);
    const alpha = screen.getByRole("button", { name: /Alpha · 75 \(75%\)/ });
    expect(alpha).toHaveStyle({ width: "75%" });
  });

  test("clicking a segment selects it; clicking the active one clears", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <MixBar segments={SEGMENTS} selected={null} onSelect={onSelect} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Alpha · 75/ }));
    expect(onSelect).toHaveBeenCalledWith("a");

    onSelect.mockClear();
    rerender(<MixBar segments={SEGMENTS} selected="a" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Alpha · 75/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  test("the legend is a second hit target for the same keys", async () => {
    // Narrow segments are unclickable in practice, which is the whole reason the legend
    // chips filter too.
    const onSelect = vi.fn();
    render(<MixBar segments={SEGMENTS} selected={null} onSelect={onSelect} />);
    const legendBeta = screen
      .getAllByRole("button")
      .filter((b) => b.textContent?.includes("Beta"));
    expect(legendBeta.length).toBeGreaterThan(0);
    await userEvent.click(legendBeta[legendBeta.length - 1]);
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  test("a selection dims the other segments and marks itself pressed", () => {
    render(<MixBar segments={SEGMENTS} selected="a" onSelect={() => {}} />);
    const alpha = screen.getByRole("button", { name: /Alpha · 75/ });
    const beta = screen.getByRole("button", { name: /Beta · 25/ });
    expect(alpha).toHaveAttribute("aria-pressed", "true");
    expect(beta).toHaveAttribute("aria-pressed", "false");
    expect(beta).toHaveStyle({ opacity: "0.35" });
  });
});
