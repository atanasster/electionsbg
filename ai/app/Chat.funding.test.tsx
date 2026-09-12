import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { ModelEngine } from "../llm/useModelEngine";
import { validateFundingQuery } from "../../src/lib/fundingQuery";
import { CHAT_STORAGE_KEY } from "./chatStorage";
const dispatch = vi.hoisted(() => vi.fn());
vi.mock("./dispatchPrompt", () => ({ dispatchPrompt: dispatch }));
vi.mock("./useFundingCapabilities", () => ({
  useFundingCapabilities: (x: unknown) => x,
}));
vi.mock("./useProcurementCapabilities", () => ({
  useProcurementCapabilities: (x: unknown) => x,
}));
vi.mock("@/components/questions/useQuestionLookupAdapters", () => ({
  useQuestionLookupAdapters: () => ({}),
}));
vi.mock("@/lib/questions/selector", () => ({ QuestionSelector: () => null }));
vi.mock("./hero/EmptyHero", () => ({ EmptyHero: () => null }));
vi.mock("./InteractionNavigator", () => ({ InteractionNavigator: () => null }));
vi.mock("../render/AnswerView", () => ({ AnswerView: () => null }));
vi.mock("./ClarifyDialog", () => ({
  ClarifyDialog: ({ request }: { request?: { prompt: string } }) =>
    request ? <div role="dialog">{request.prompt}</div> : null,
}));
import { Chat } from "./Chat";
const engine = {
  providerId: "rules",
  provider: { id: "rules" },
  load: { phase: "ready" },
} as unknown as ModelEngine;
let slot: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  dispatch.mockReset();
  slot = document.createElement("div");
  document.body.appendChild(slot);
});
afterEach(() => slot.remove());
const mount = () =>
  render(<Chat engine={engine} lang="en" election="1990" actionSlot={slot} />);
const send = (text: string) => {
  fireEvent.change(
    screen.getByRole("textbox", { name: "Ask about the data…" }),
    { target: { value: text } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
};
it("H05 New chat invalidates pending funding answer and clarification", async () => {
  let finish!: (x: unknown) => void;
  dispatch.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  mount();
  send("ISUN signed in 2026");
  await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  await act(async () =>
    finish({
      text: "STALE ANSWER",
      env: { clarify: { prompt: "STALE CLARIFICATION", options: [] } },
      tool: "fundingQuestion",
      args: { question: "ISUN signed in 2026" },
    }),
  );
  expect(screen.queryByText("STALE ANSWER")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || "[]")).toEqual(
    [],
  );
});
it.each([false, true])(
  "H04 saved funding scope valid=%s restores or fails closed",
  async (invalid) => {
    const p = validateFundingQuery({
      corpus: "agriPayments",
      financialYears: ["2025"],
      schemeIds: ["S1"],
    });
    if (!p.ok) throw Error();
    localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify([
        {
          id: 1,
          role: "assistant",
          text: "Saved funding",
          tool: "fundingQuery",
          args: {},
          env: {
            tool: "fundingQuery",
            title: "Funding",
            kind: "scalar",
            viz: "none",
            facts: {},
            provenance: [],
            funding: {
              query: invalid ? { ...p.query, version: "future" } : p.query,
              result: { status: "success" },
            },
          },
        },
      ]),
    );
    dispatch.mockResolvedValue({ text: "done", env: null });
    mount();
    await screen.findByRole("button", { name: "New chat" });
    send("And by scheme?");
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    const context = dispatch.mock.calls[0][4].prev;
    expect(context.tool).toBe("fundingQuery");
    expect(context.args).toEqual(
      invalid ? { version: "invalid-saved-scope" } : p.query,
    );
  },
);
