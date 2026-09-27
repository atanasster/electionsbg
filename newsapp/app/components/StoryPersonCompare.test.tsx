import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryMember } from "../data";

const m = (domain: string, id: string, bucket_index: number): StoryMember =>
  ({
    domain,
    article_id: id,
    published: `2026-09-2${id}`,
    persons: [{ id: "mp-5142", name: "Румен Радев", value: 0, bucket_index }],
  }) as unknown as StoryMember;

const draw = async (members: StoryMember[], withPage: boolean) => {
  vi.resetModules();
  vi.doMock("../data", async (orig) => ({
    ...(await orig<typeof import("../data")>()),
    usePersonsIndex: () => ({
      data: { persons: withPage ? [{ id: "mp-5142" }] : [] },
      error: null,
      loading: false,
    }),
  }));
  const { StoryPersonCompare } = await import("./StoryPersonCompare");
  render(
    <MemoryRouter>
      <StoryPersonCompare members={members} />
    </MemoryRouter>,
  );
};

afterEach(cleanup);

describe("StoryPersonCompare", () => {
  it("compares outlets on one person and says whether they differ", async () => {
    await draw([m("a.bg", "1", 1), m("b.bg", "2", 2)], true);
    const box = screen.getByTestId("story-person-compare");
    expect(box.textContent).toContain("Изданията представят човека различно.");
    expect(screen.getByRole("link", { name: "Румен Радев" })).toHaveAttribute(
      "href",
      "/person/mp-5142",
    );
  });

  it("links the person only when they have a page", async () => {
    await draw([m("a.bg", "1", 1), m("b.bg", "2", 2)], false);
    expect(screen.queryByRole("link", { name: "Румен Радев" })).toBeNull();
  });

  it("renders nothing when only one outlet scored the person", async () => {
    await draw([m("a.bg", "1", 1), m("a.bg", "2", 3)], true);
    expect(screen.queryByTestId("story-person-compare")).toBeNull();
  });
});
