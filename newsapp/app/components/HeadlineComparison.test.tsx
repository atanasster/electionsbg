import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { StoryMember } from "../data";
import { distinctiveHeadlineTerms } from "../headlineDifferences";
import { HeadlineComparison } from "./HeadlineComparison";

const member = (domain: string, title: string): StoryMember => ({
  domain,
  article_id: domain,
  url: `https://${domain}/story`,
  title,
  published: "2026-09-01T08:00:00Z",
  leaning: null,
  russia_stance: null,
  first_seen: null,
  scoop_lag_hours: null,
  first_here: false,
  scoop_decidable: false,
});

describe("HeadlineComparison", () => {
  it("highlights only bounded headline-specific terms", () => {
    const terms = distinctiveHeadlineTerms([
      "Парламентът прие новия бюджет днес",
      "Парламентът отхвърли спорния бюджет днес",
    ]);
    expect(terms[0]).toContain("прие");
    expect(terms[1]).toContain("отхвърли");
    expect(terms[0]).not.toContain("парламентът");
    expect(terms[0].size).toBeLessThanOrEqual(6);
    expect(distinctiveHeadlineTerms(["Единствено заглавие"])[0].size).toBe(0);
  });

  it("labels lexical differences without claiming bias", () => {
    render(
      <MemoryRouter>
        <HeadlineComparison
          members={[
            member("one.bg", "Парламентът прие новия бюджет"),
            member("two.bg", "Парламентът отхвърли спорния бюджет"),
          ]}
          outletNames={
            new Map([
              ["one.bg", "Първа медия"],
              ["two.bg", "Втора медия"],
            ])
          }
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("прие", { selector: "mark" })).toBeVisible();
    expect(screen.getByText("отхвърли", { selector: "mark" })).toBeVisible();
    expect(screen.getByText(/лексикална разлика/)).toBeVisible();
    expect(screen.getByRole("link", { name: /прие новия/ })).toHaveAttribute(
      "href",
      "/article/one.bg/one.bg",
    );
  });
});
