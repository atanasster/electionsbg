import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AiVerification } from "./AiVerification";
import { verifyAiSession } from "../llm/session";

vi.mock("../llm/session", () => ({ verifyAiSession: vi.fn() }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function widget() {
  vi.stubEnv("VITE_AI_TURNSTILE_SITE_KEY", "test-only");
  const renderWidget = vi.fn<
    (host: HTMLElement, options: Record<string, unknown>) => string
  >(() => "widget");
  const remove = vi.fn();
  vi.stubGlobal("turnstile", { render: renderWidget, remove });
  return { renderWidget, remove };
}

it("shows expiry recovery and replaces the expired widget on retry", async () => {
  const { renderWidget, remove } = widget();
  const verified = vi.fn();
  render(<AiVerification lang="en" onVerified={verified} />);
  await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));
  const options = renderWidget.mock.calls[0][1] as Record<string, () => void>;
  act(() => options["expired-callback"]());
  expect(
    screen.getByText(/Verification is temporarily unavailable/),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(2));
  expect(remove).toHaveBeenCalledWith("widget");
  expect(verified).not.toHaveBeenCalled();
});

it("does not select AI after the user closes verification while its request is pending", async () => {
  const { renderWidget, remove } = widget();
  let finish!: () => void;
  vi.mocked(verifyAiSession).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const verified = vi.fn();
  const view = render(<AiVerification lang="en" onVerified={verified} />);
  await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));
  const options = renderWidget.mock.calls[0][1] as Record<
    string,
    (token: string) => void
  >;
  act(() => options.callback("controlled-test-token"));
  view.unmount();
  await act(async () => finish());
  expect(remove).toHaveBeenCalledWith("widget");
  expect(verified).not.toHaveBeenCalled();
});
