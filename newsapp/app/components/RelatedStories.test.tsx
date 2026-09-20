import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { RelatedStoryRow } from "../data";
import { RelatedStories } from "./RelatedStories";

const story = (
  id: string,
  outlets: number,
  date: string | null,
): RelatedStoryRow => ({
  id,
  title_bg: `Заглавие ${id}`,
  title_en: null,
  first_published: date,
  outlet_count: outlets,
});

describe("RelatedStories", () => {
  it("renders nothing for an empty relationship set", () => {
    const { container } = render(
      <MemoryRouter>
        <RelatedStories stories={[]} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders ordered accessible links and honest metadata", () => {
    render(
      <MemoryRouter>
        <RelatedStories
          stories={[
            story("first", 1, "2026-08-21T10:00:00Z"),
            story("second", 3, null),
          ]}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Свързани истории" }),
    ).toBeVisible();
    const items = screen.getAllByRole("listitem");
    expect(
      within(items[0]).getByRole("link", { name: "Заглавие first" }),
    ).toHaveAttribute("href", "/story/first");
    expect(within(items[0]).getByText(/1 медия ·/)).toBeVisible();
    expect(within(items[1]).getByText("3 медии")).toBeVisible();
    expect(items[1]).not.toHaveTextContent("2026");
  });
});
