import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => Reflect.deleteProperty(window, "naiasnoNewsAnalytics"));
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

  it("records the comparison task without headline or outlet ids", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    render(
      <MemoryRouter>
        <HeadlineComparison
          members={[
            member("one.bg", "Частно заглавие едно"),
            member("two.bg", "Частно заглавие две"),
          ]}
          outletNames={new Map()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: /едно/ }));
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_outcome",
        task: "comparison",
        outcome: "available",
      }),
    );
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_task",
        task: "compare_coverage",
        signal: "completed",
      }),
    );
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/one\.bg|Частно/);
  });

  it("records when a comparison is unavailable without exposing the source", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    render(
      <MemoryRouter>
        <HeadlineComparison
          members={[member("private.bg", "Самотно заглавие")]}
          outletNames={new Map()}
        />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_outcome",
        task: "comparison",
        outcome: "unavailable",
      }),
    );
    expect(JSON.stringify(sink.mock.calls)).not.toContain("private.bg");
  });
});
