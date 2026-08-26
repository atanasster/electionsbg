// SummaryPair — the Bulgarian summary and the English one behind a disclosure.
//
// The rubric produces BOTH for every analysed record. There are two places a
// summary is read (the story page and the article page), and the failure this
// component exists to prevent is one of them quietly ceasing to render the
// English — which is invisible to anyone reading in Bulgarian, i.e. everyone
// who tests it.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SummaryPair } from "./SummaryPair";

describe("SummaryPair", () => {
  it("renders the Bulgarian summary as the primary text", () => {
    render(
      <SummaryPair bg="Кабинетът отложи решението." en="Cabinet delayed." />,
    );
    expect(screen.getByText("Кабинетът отложи решението.")).toBeVisible();
  });

  it("keeps the English reachable and labelled", () => {
    render(<SummaryPair bg="Български текст." en="English text." />);
    // present and labelled...
    expect(screen.getByText("Резюме на английски")).toBeVisible();
    // ...and inside a disclosure, so it reads as secondary rather than as a
    // second lede
    const details = screen.getByText("Резюме на английски").closest("details");
    expect(details).not.toBeNull();
    expect(details).toContainElement(screen.getByText("English text."));
  });

  it("marks the English paragraph's language for a screen reader", () => {
    // The document is lang="bg"; one paragraph in another language is exactly
    // what this attribute is for.
    render(<SummaryPair bg="Български." en="English." />);
    expect(screen.getByText("English.")).toHaveAttribute("lang", "en");
  });

  it("renders nothing at all when there is no summary", () => {
    const { container } = render(<SummaryPair bg={null} en={null} />);
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = render(<SummaryPair bg={undefined} en="" />);
    expect(c2).toBeEmptyDOMElement();
  });

  it("renders the Bulgarian alone when there is no English", () => {
    render(<SummaryPair bg="Само български." en={null} />);
    expect(screen.getByText("Само български.")).toBeVisible();
    expect(screen.queryByText("Резюме на английски")).not.toBeInTheDocument();
  });

  it("still shows the English when the Bulgarian is missing, and says so", () => {
    // An EN-only record is an upstream defect, not a reason to render a blank
    // where a summary belongs.
    render(<SummaryPair bg={null} en="English only." />);
    expect(screen.getByText("Резюме на английски")).toBeVisible();
    // ⚠️ The TEXT, not just the label. Asserting only the disclosure's
    // heading let the English paragraph be made conditional on `bg` with the
    // whole suite green — which is the one regression this component exists
    // to prevent.
    expect(screen.getByText("English only.")).toBeInTheDocument();
    expect(screen.getByText("Липсва резюме на български.")).toBeVisible();
  });

  it("passes its spacing through to the wrapper", () => {
    // The margin moved from the paragraph to a caller-supplied wrapper when
    // this was extracted, so the contract is now a prop and defaults to NO
    // margin. Dropping the prop entirely left every other test passing.
    const { container } = render(
      <SummaryPair bg="Текст." en="Text." className="mt-3" />,
    );
    expect(container.firstElementChild).toHaveClass("mt-3");
  });
});
