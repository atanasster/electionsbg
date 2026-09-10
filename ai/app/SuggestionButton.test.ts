// @vitest-environment jsdom
import { createElement } from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SuggestionButton } from "./SuggestionButton";
afterEach(cleanup);
it("activates by native click without also submitting on mouse down", () => {
  const suggestion = {
    questionId: "budgetOverview",
    bg: "Бюджет",
    en: "Budget",
  };
  const onPick = vi.fn();
  const { getByRole } = render(
    createElement(SuggestionButton, { suggestion, lang: "en", onPick }),
  );
  const button = getByRole("button", { name: "Budget" });
  // Keyboard activation dispatches click without a mouse event.
  fireEvent.click(button);
  expect(onPick).toHaveBeenCalledExactlyOnceWith(suggestion);
  fireEvent.mouseDown(button);
  expect(onPick).toHaveBeenCalledTimes(1);
  fireEvent.click(button);
  expect(onPick).toHaveBeenCalledTimes(2);
});
