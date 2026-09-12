import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi, afterEach } from "vitest";
import { QuestionSelector } from "./QuestionSelector";
import { ROLLCALL_QUESTIONS, ROLLCALL_TEMPLATES } from "../contracts/rollcall";
import { QUESTION_CATALOG } from "../catalog";
import { toChatQuestionIntent } from "../../../../ai/app/questionAdapter";
import { matchRollcallTemplate } from "../contracts/rollcall";
afterEach(cleanup);
HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};
it.each(ROLLCALL_TEMPLATES)(
  "$id renders the starter in the selector and submits its visible parameter values",
  async (t) => {
    const q = ROLLCALL_QUESTIONS.find(
      (q) => q.id === "rollcall-query-" + t.id,
    )!;
    const values: Record<string, string | number> = {
      person: "Бойко Рашков",
      personA: "Бойко Рашков",
      personB: "Иван Иванов",
      councillor: "Иван Иванов",
      municipality: "Русе",
      assembly: 52,
      year: 2026,
      yearA: 2025,
      yearB: 2026,
      from: "2025-04-01",
      to: "2026-01-31",
      date: "2026-01-02",
      topic: "budget",
      party: "ГЕРБ-СДС",
      vote: "52:2026-01-02:1",
      resolution: "resolution-1",
    };
    const select = vi.fn();
    const user = userEvent.setup();
    render(
      <QuestionSelector
        compact
        catalog={{ ...QUESTION_CATALOG, questions: [q] }}
        surface="chat"
        lang="en"
        initialQuestionId={q.id}
        onSelect={select}
      />,
    );
    for (const p of q.parameters) {
      const input = screen.getByLabelText(p.label.en);
      fireEvent.change(input, { target: { value: String(values[p.id]) } });
    }
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(select).toHaveBeenCalled());
    const selected = select.mock.calls[0][0];
    const intent = toChatQuestionIntent(
      selected.questionId,
      "en",
      selected.parameters,
    );
    expect(intent.text).not.toMatch(/\{\w+\}/);
    expect(matchRollcallTemplate(intent.text)).not.toBeNull();
  },
);
