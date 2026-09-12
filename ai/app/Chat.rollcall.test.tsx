import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { ModelEngine } from "../llm/useModelEngine";
import {
  validateRollcallQuery,
  encodeRollcallQuery,
} from "../../src/lib/rollcallQuery";
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
it("H05 New chat invalidates pending rollcall answer and clarification", async () => {
  let finish!: (x: unknown) => void;
  dispatch.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  mount();
  send("Last votes of Boyko Rashkov");
  await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  await act(async () =>
    finish({
      text: "STALE ANSWER",
      env: { clarify: { prompt: "STALE CLARIFICATION", options: [] } },
      tool: "rollcallQuestion",
      args: { question: "Last votes of Boyko Rashkov" },
    }),
  );
  expect(screen.queryByText("STALE ANSWER")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || "[]")).toEqual(
    [],
  );
});
it.each([false, true])(
  "H04 saved rollcall scope valid=%s restores or fails closed",
  async (invalid) => {
    const p = validateRollcallQuery({
      corpus: "parliamentCasts",
      seatIds: ["52:7"],
      from: "2026-01-01",
      toExclusive: "2027-01-01",
      expectedRevision: "saved-r",
    });
    if (!p.ok) throw Error();
    localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify([
        {
          id: 1,
          role: "assistant",
          text: "Saved rollcall",
          tool: "rollcallQuery",
          args: {},
          env: {
            tool: "rollcallQuery",
            title: "Rollcall",
            kind: "scalar",
            viz: "none",
            facts: {},
            provenance: [],
            rollcall: {
              query: invalid ? { ...p.query, version: "future" } : p.query,
              result: { status: "success", revision: "saved-r" },
            },
          },
        },
      ]),
    );
    dispatch.mockResolvedValue({ text: "done", env: null });
    mount();
    await screen.findByRole("button", { name: "New chat" });
    send("And by month?");
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    const context = dispatch.mock.calls[0][4].prev;
    expect(context.tool).toBe("rollcallQuery");
    expect(context.args).toEqual({
      query: invalid ? "invalid-saved-scope" : encodeRollcallQuery(p.query),
      records: "[]",
    });
  },
);
it("grouped answers never persist hidden raw records as ordinal focus", async () => {
  const p = validateRollcallQuery({
    corpus: "parliamentVotes",
    groupBy: "month",
    operation: "trend",
  });
  if (!p.ok) throw Error();
  localStorage.setItem(
    CHAT_STORAGE_KEY,
    JSON.stringify([
      {
        id: 1,
        role: "assistant",
        text: "Grouped answer",
        env: {
          tool: "rollcallQuery",
          title: "Months",
          kind: "table",
          viz: "none",
          facts: {},
          provenance: [],
          rows: [{ key: "2026-01" }, { key: "2026-02" }],
          rollcall: {
            query: p.query,
            result: {
              status: "success",
              revision: "r",
              rows: [{ key: "52:2026-01-01:1" }, { key: "52:2026-01-01:2" }],
            },
          },
        },
      },
    ]),
  );
  dispatch.mockResolvedValue({ text: "done", env: null });
  mount();
  await screen.findByRole("button", { name: "New chat" });
  send("Show everyone who voted on the second one.");
  await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
  expect(dispatch.mock.calls[0][4].prev.args.records).toBe("[]");
});
