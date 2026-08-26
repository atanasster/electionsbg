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

describe("a withheld summary", () => {
  // ⚠️ „Липсва" AND „ЗАДЪРЖАНО" ARE DIFFERENT FACTS. The first says the
  // pipeline produced nothing; the second says we produced one and refused
  // to publish it. Rendering the first for the second makes a deliberate
  // refusal read as breakage — which is exactly what it looked like on the
  // KPKONPI story before this.
  it("states WHY it is missing instead of the generic note", () => {
    render(
      <SummaryPair
        bg={null}
        en="Anton Slavchev got a payout."
        withheld={{ summary_bg: "altered_name" }}
      />,
    );
    expect(screen.getByText(/не се показва/)).toBeInTheDocument();
    expect(screen.queryByText("Липсва резюме на български.")).toBeNull();
  });

  it("keeps the generic note when nothing was withheld", () => {
    render(<SummaryPair bg={null} en="Anton Slavchev got a payout." />);
    expect(screen.getByText("Липсва резюме на български.")).toBeInTheDocument();
  });

  it("still renders the note when BOTH summaries are gone", () => {
    // Otherwise a record whose only summary was withheld renders nothing at
    // all, and the refusal is invisible again.
    render(
      <SummaryPair
        bg={null}
        en={null}
        withheld={{ summary_bg: "altered_name" }}
      />,
    );
    expect(screen.getByText(/не се показва/)).toBeInTheDocument();
  });

  it("falls back to the generic note on an UNKNOWN reason code", () => {
    // A code the app has no wording for must not render an empty paragraph.
    render(
      <SummaryPair bg={null} en="x" withheld={{ summary_bg: "future_code" }} />,
    );
    expect(screen.getByText("Липсва резюме на български.")).toBeInTheDocument();
  });

  it("says nothing when the Bulgarian summary is present", () => {
    render(
      <SummaryPair
        bg="Резюме."
        en="Summary."
        withheld={{ summary_en: "altered_name" }}
      />,
    );
    expect(screen.queryByText(/не се показва/)).toBeNull();
    expect(screen.queryByText("Липсва резюме на български.")).toBeNull();
  });
});
