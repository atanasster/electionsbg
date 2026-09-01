import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ArticleContributionCard } from "./ArticleContributionCard";

const renderCard = (evaluationPath: string | null, hasAnalysis = true) =>
  render(
    <MemoryRouter>
      <ArticleContributionCard
        articlePath="/article/example.bg/article-1"
        evaluationPath={evaluationPath}
        hasAnalysis={hasAnalysis}
      />
    </MemoryRouter>,
  );

describe("ArticleContributionCard", () => {
  it("offers the structured evaluator for an active task", () => {
    renderCard("/evals/article/example.bg/article-1");

    expect(
      screen.getByRole("link", { name: "Оценете тази статия" }),
    ).toHaveAttribute("href", "/evals/article/example.bg/article-1");
    const contributionLink = screen.getByRole("link", {
      name: /Добавете липсващ анализ или връзка/,
    });
    expect(contributionLink).toHaveClass("w-full", "whitespace-normal");
    expect(contributionLink).toHaveAttribute(
      "href",
      expect.stringContaining(
        "https%3A%2F%2Fnews.electionsbg.com%2Farticle%2Fexample.bg%2Farticle-1",
      ),
    );
  });

  it("offers article-bound feedback even outside the evaluation queue", () => {
    renderCard(null, false);

    expect(screen.getByText("Предложете първа оценка")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Оценете тази статия" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Добавете липсващ анализ или връзка/ }),
    ).toBeVisible();
  });
});
