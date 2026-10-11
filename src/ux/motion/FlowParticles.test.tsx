import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FlowParticles } from "./FlowParticles";
import { particleCount } from "./particleCount";

const setReducedMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

const renderIn = (el: React.ReactElement) => render(<svg>{el}</svg>);

describe("particleCount", () => {
  it("is proportional to the link's share of the largest, within 1…max", () => {
    expect(particleCount(100, 100)).toBe(4);
    expect(particleCount(50, 100)).toBe(2);
    expect(particleCount(1, 100)).toBe(1);
    expect(particleCount(0, 0)).toBe(1);
  });
});

describe("FlowParticles", () => {
  it("renders one bead per count, spaced along the trip", () => {
    setReducedMotion(false);
    const { container } = renderIn(
      <FlowParticles d="M0,0L100,0" count={3} width={9} durationMs={3000} />,
    );
    const motions = [...container.querySelectorAll("animateMotion")];
    expect(motions).toHaveLength(3);
    expect(motions.map((m) => m.getAttribute("begin"))).toEqual([
      "0ms",
      "-1000ms",
      "-2000ms",
    ]);
    expect(motions[0].getAttribute("keyPoints")).toBeNull();
  });

  it("runs end → start when reversed", () => {
    setReducedMotion(false);
    const { container } = renderIn(
      <FlowParticles d="M0,0L100,0" count={1} width={4} reverse />,
    );
    const m = container.querySelector("animateMotion")!;
    expect(m.getAttribute("keyPoints")).toBe("1;0");
    expect(m.getAttribute("calcMode")).toBe("linear");
  });

  it("renders nothing under prefers-reduced-motion", () => {
    setReducedMotion(true);
    const { container } = renderIn(
      <FlowParticles d="M0,0L100,0" count={3} width={9} />,
    );
    expect(container.querySelector("circle")).toBeNull();
  });
});
