import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Outlet } from "../data";
import { StorySourcePreview } from "./StorySourcePreview";
import { selectStorySources } from "./storySourceSelection";

const outlet = (domain: string, label: string, rank: number | null): Outlet =>
  ({ domain, outlet: label, rank }) as Outlet;

const outlets = [
  outlet("alpha.bg", "Алфа", 20),
  outlet("beta.bg", "Бета", 10),
  outlet("gamma.bg", "Гама", null),
  outlet("delta.bg", "Делта", null),
];

describe("selectStorySources", () => {
  it("sorts by story contribution, registry rank and localized name", () => {
    expect(
      selectStorySources(
        { "gamma.bg": 1, "alpha.bg": 2, "beta.bg": 2, "delta.bg": 1 },
        outlets,
        4,
      ).visible.map((source) => source.label),
    ).toEqual(["Бета", "Алфа", "Гама", "Делта"]);
  });

  it("falls back to the domain and always keeps at least one source", () => {
    expect(selectStorySources({ "missing.bg": 1 }, outlets, 0).visible).toEqual(
      [{ domain: "missing.bg", label: "missing.bg", articleCount: 1 }],
    );
  });
});

describe("StorySourcePreview", () => {
  it("renders a single publication without a redundant count", () => {
    const { container } = render(
      <StorySourcePreview
        byDomain={{ "alpha.bg": 1 }}
        articleCount={1}
        outlets={outlets}
      />,
    );

    expect(container.querySelector(".sm\\:hidden")).toHaveTextContent("Алфа");
    expect(screen.queryByText(/публикаци/)).toBeNull();
    expect(screen.getByText("Източници:").parentElement).toHaveClass("sr-only");
  });

  it("shows top publications and the honest number of remaining outlets", () => {
    const { container } = render(
      <StorySourcePreview
        byDomain={{
          "alpha.bg": 1,
          "beta.bg": 2,
          "gamma.bg": 1,
          "delta.bg": 1,
        }}
        articleCount={5}
        outlets={outlets}
      />,
    );

    expect(container.querySelector(".sm\\:hidden")).toHaveTextContent(
      "Бета · +3 още · 5 публикации",
    );
    expect(container.querySelector(".hidden.sm\\:inline")).toHaveTextContent(
      "Бета · Алфа · +2 още · 5 публикации",
    );
    expect(screen.getByText(", и още 2 медии").parentElement).toHaveClass(
      "sr-only",
    );
    expect(screen.getByText("; общо 5 публикации").parentElement).toHaveClass(
      "sr-only",
    );
  });

  it("omits the duplicate-article suffix when counts describe only outlets", () => {
    render(
      <StorySourcePreview
        byDomain={{ "alpha.bg": 1, "beta.bg": 1 }}
        articleCount={2}
        outlets={outlets}
      />,
    );

    expect(screen.queryByText("2 публикации")).toBeNull();
    expect(screen.getByText("Източници:").parentElement).toHaveClass("sr-only");
  });

  it("allows an unbroken fallback domain to wrap inside a card", () => {
    const { container } = render(
      <StorySourcePreview
        byDomain={{
          "an-extremely-long-unregistered-publication-domain-without-breaks.example": 1,
        }}
        articleCount={1}
        outlets={outlets}
      />,
    );

    expect(container.querySelector("p")).toHaveClass(
      "min-w-0",
      "max-w-full",
      "break-words",
      "[overflow-wrap:anywhere]",
    );
  });
});
