import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnstileWidget, type TurnstileState } from "./TurnstileWidget";

type Options = Parameters<NonNullable<typeof window.turnstile>["render"]>[1];

describe("TurnstileWidget", () => {
  let options: Options | null;
  let states: TurnstileState[];
  const reset = vi.fn();
  const remove = vi.fn();
  const token = vi.fn();

  beforeEach(() => {
    options = null;
    states = [];
    window.turnstile = {
      render: vi.fn((_host, next) => {
        options = next;
        return "widget-1";
      }),
      reset,
      remove,
    };
  });

  afterEach(() => {
    delete window.turnstile;
    vi.clearAllMocks();
  });

  it("renders explicitly and clears a single-use token on expiry", async () => {
    render(
      <TurnstileWidget
        siteKey="public-site-key"
        action="news-evaluation-submit"
        resetSignal={0}
        onToken={token}
        onStateChange={(state) => states.push(state)}
      />,
    );
    await act(async () => Promise.resolve());
    expect(window.turnstile?.render).toHaveBeenCalled();
    expect(options).toMatchObject({
      sitekey: "public-site-key",
      action: "news-evaluation-submit",
      theme: "auto",
      language: "bg",
      size: "flexible",
      "response-field": false,
    });
    act(() => options?.callback("one-use-token"));
    expect(token).toHaveBeenLastCalledWith("one-use-token");
    expect(screen.getByText("Проверката е завършена.")).toBeVisible();
    act(() => options?.["expired-callback"]());
    expect(token).toHaveBeenLastCalledWith(null);
    expect(screen.getByText(/Проверката изтече/)).toBeVisible();
  });

  it("fails closed when the public site key is missing", () => {
    render(
      <TurnstileWidget
        siteKey=""
        action="news-evaluation-submit"
        resetSignal={0}
        onToken={token}
        onStateChange={(state) => states.push(state)}
      />,
    );
    expect(
      screen.getByText(/Изпращането временно не е достъпно/),
    ).toBeVisible();
    expect(window.turnstile?.render).not.toHaveBeenCalled();
    expect(token).toHaveBeenCalledWith(null);
  });

  it("resets the widget after a submission attempt", async () => {
    const view = render(
      <TurnstileWidget
        siteKey="public-site-key"
        action="news-evaluation-submit"
        resetSignal={0}
        onToken={token}
        onStateChange={(state) => states.push(state)}
      />,
    );
    await act(async () => Promise.resolve());
    view.rerender(
      <TurnstileWidget
        siteKey="public-site-key"
        action="news-evaluation-submit"
        resetSignal={1}
        onToken={token}
        onStateChange={(state) => states.push(state)}
      />,
    );
    expect(reset).toHaveBeenCalledWith("widget-1");
    expect(token).toHaveBeenLastCalledWith(null);
  });
});
