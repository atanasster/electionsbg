import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ToolWorkspace } from "./ToolWorkspace";
import { Explorer } from "../Explorer";
import { runTool } from "../../tools/registry";
import type { ClarifyRequest, Envelope, ToolArgs } from "../../tools/types";
import type { WorkspaceState } from "./workspace";
vi.mock("../../tools/registry", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runTool: vi.fn(),
}));
vi.mock("../../render/AnswerView", () => ({
  AnswerView: ({
    env,
    onClarify,
  }: {
    env: Envelope;
    onClarify: (request: ClarifyRequest) => void;
  }) => (
    <div>
      {env.title}
      {env.clarify && (
        <button onClick={() => onClarify(env.clarify!)}>Choose match</button>
      )}
    </div>
  ),
}));
const envelope = (title: string): Envelope => ({
  tool: "contractSearch",
  kind: "table",
  title,
  rows: [{ value: 1 }],
  facts: {},
  provenance: ["fixture"],
  viz: "none",
});
const mocked = vi.mocked(runTool);
beforeEach(() => {
  mocked.mockReset();
  window.history.replaceState(null, "", "/tools");
  localStorage.clear();
});
function Harness({
  name = "contractSearch",
  draft = { company: "Example Ltd" },
  onOpenChat = vi.fn(),
}: {
  name?: string;
  draft?: ToolArgs;
  onOpenChat?: (intent: unknown) => void;
}) {
  const [state, onChange] = useState<WorkspaceState>({ draft });
  return (
    <ToolWorkspace
      name={name}
      lang="en"
      state={state}
      onChange={onChange}
      onOpenChat={onOpenChat}
    />
  );
}
it("blocks invalid required inputs and sends normalized settings to chat deliberately", () => {
  const open = vi.fn();
  render(<Harness draft={{}} onOpenChat={open} />);
  fireEvent.click(screen.getByRole("button", { name: "Show data" }));
  expect(mocked).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Check");
  const field = screen.getByRole("textbox");
  fireEvent.change(field, { target: { value: "  Acme Ltd  " } });
  fireEvent.click(screen.getByRole("button", { name: "Open in chat" }));
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({
      tool: "contractSearch",
      args: { company: "Acme Ltd", count: 12 },
      text: expect.stringContaining("Acme Ltd"),
    }),
  );
  expect(mocked).not.toHaveBeenCalled();
});
it("marks late results stale after edits, and a newer request wins", async () => {
  let resolveFirst!: (env: Envelope) => void;
  let resolveSecond!: (env: Envelope) => void;
  mocked
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFirst = r;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveSecond = r;
        }),
    );
  const { container } = render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Show data" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Second Ltd" },
  });
  // A second submission can arrive via keyboard while the button is disabled.
  fireEvent.submit(container.querySelector("form")!);
  await act(async () => resolveSecond(envelope("Second result")));
  expect(screen.getByText("Second result")).toBeInTheDocument();
  await act(async () => resolveFirst(envelope("Old result")));
  expect(screen.queryByText("Old result")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Third Ltd" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("Settings changed");
});
it("keeps an old clarification stale and preserves its trusted candidate pin", async () => {
  const request: ClarifyRequest = {
    prompt: "Which person?",
    options: [
      {
        label: "Candidate one",
        tool: "candidateResult",
        args: { name: "Alex", partyNum: 3 },
      },
    ],
  };
  mocked
    .mockResolvedValueOnce({ ...envelope("Ambiguous"), clarify: request })
    .mockResolvedValueOnce(envelope("Resolved candidate"));
  render(<Harness name="candidateResult" draft={{ name: "Alex" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Show data" }));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Different person" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Choose match" }));
  fireEvent.click(screen.getByRole("button", { name: "Candidate one" }));
  await screen.findByText("Resolved candidate");
  expect(mocked.mock.calls[1][1]).toEqual({ name: "Alex", partyNum: 3 });
  expect(screen.getByRole("status")).toHaveTextContent("Settings changed");
});
it("retains input on error, retries, and reports oversized sharing without throwing", async () => {
  mocked
    .mockRejectedValueOnce(new Error("Source unavailable"))
    .mockResolvedValueOnce(envelope("Recovered"));
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Show data" }));
  await screen.findByText("Source unavailable");
  expect(screen.getByRole("textbox")).toHaveValue("Example Ltd");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Recovered");
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Ж".repeat(2000) },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Share current settings" }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("too long for a link");
});
it("discovers tools, loads presets without running and ignores completion from an abandoned selection", async () => {
  let resolve!: (env: Envelope) => void;
  mocked.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<Explorer lang="en" onOpenChat={vi.fn()} />);
  const search = screen.getByRole("textbox", { name: "Search tools" });
  fireEvent.change(search, { target: { value: "contractSearch" } });
  fireEvent.click(
    screen.getByRole("button", {
      name: "A specific contractor's public-procurement contracts",
    }),
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: /Company|contractor/i }),
    { target: { value: "Example Ltd" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Show data" }));
  fireEvent.change(search, { target: { value: "budgetVariance" } });
  fireEvent.click(screen.getByRole("button", { name: "Budget deviations" }));
  await act(async () => resolve(envelope("Wrong owner")));
  expect(screen.queryByText("Wrong owner")).not.toBeInTheDocument();
  expect(mocked).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Budget deviations" }),
    ).toBeInTheDocument(),
  );
});
it("loads a structured welcome preset without executing and restores a draft after switching", () => {
  render(<Explorer lang="en" onOpenChat={vi.fn()} />);
  fireEvent.click(
    screen.getAllByRole("button", {
      name: /Results in Plovdiv|results in the municipality of Plovdiv/i,
    })[0],
  );
  expect(mocked).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: /Municipality/i })).toHaveValue(
    "plovdiv",
  );
  fireEvent.change(screen.getByRole("textbox", { name: /Municipality/i }), {
    target: { value: "Varna" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Search tools" }), {
    target: { value: "budgetVariance" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Budget deviations" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search tools" }), {
    target: { value: "municipalityResults" },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Results in one municipality",
    }),
  );
  expect(screen.getByRole("textbox", { name: /Municipality/i })).toHaveValue(
    "Varna",
  );
});
it("supports keyboard tab navigation to readable sources", async () => {
  mocked.mockResolvedValue(envelope("Keyboard result"));
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Show data" }));
  await screen.findByText("Keyboard result");
  const resultTab = screen.getByRole("tab", { name: "Result" });
  resultTab.focus();
  fireEvent.keyDown(resultTab, { key: "ArrowRight" });
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute(
      "aria-selected",
      "true",
    ),
  );
  expect(screen.getByRole("tabpanel", { name: "Sources" })).toHaveTextContent(
    "fixture",
  );
});
it("updates the stale notice on area-only history navigation for the same tool", async () => {
  window.history.replaceState(
    null,
    "",
    "/tools?v=1&tool=budgetVariance&area=68134",
  );
  mocked.mockResolvedValue(envelope("Area-bound result"));
  render(<Explorer lang="en" onOpenChat={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Show data" }));
  await screen.findByText("Area-bound result");
  expect(screen.getByText("Result ready.")).toBeInTheDocument();
  act(() => {
    window.history.pushState(
      null,
      "",
      "/tools?v=1&tool=budgetVariance&area=56784",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.getByText(/Settings changed/)).toBeInTheDocument();
});
